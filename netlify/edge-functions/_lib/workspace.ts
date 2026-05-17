/**
 * Workspace connections — database helpers and tool dispatcher.
 *
 * This module is the single source of truth for "given a user and an
 * optional account hint, run an action against their connected GAS
 * bridge(s)". Higher layers (chat.ts) call into here and get back a
 * typed `WorkspaceDispatchResult`; nobody else touches the
 * `workspace_connections` table directly.
 *
 * Design summary:
 *
 *   - `loadConnections(userId)` returns every active connection for
 *     the user, decrypted secrets included. Heavy cost (decryption
 *     per row), so call once per chat turn and pass the array down.
 *
 *   - `dispatch(action, options)` resolves which connection(s) to use
 *     and executes:
 *       - `account: 'all'` → fan out across `enabled` set, return one
 *         result per connection. Read-only tools should accept this;
 *         write tools should reject early.
 *       - `account: 'work'` (or any label string) → exact-match label
 *         within enabled set; if not enabled, return a soft error.
 *       - `account: undefined` (default) → use the user's primary
 *         connection if it's in the enabled set, otherwise the first
 *         enabled connection.
 *
 *   - The "enabled set" is computed by the caller (chat.ts) from the
 *     chat session's `activeConnectionIds` CSV and passed in as
 *     `enabledIds`. Empty set = explicitly disabled all accounts for
 *     this thread, dispatch returns an explicit "no connections enabled"
 *     soft error so the assistant can ask the user to enable one.
 */

import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  callGoogleAction,
  GoogleNotConfiguredError,
  GoogleWebhookError,
  type GoogleAction,
  type GoogleResult,
} from './google.ts'
import { workspaceConnections } from '../../../src/shared/db/schema.ts'
import { decryptSecret, encryptSecret } from './crypto.ts'

export interface ConnectionRecord {
  id: string
  userId: string
  label: string
  webhookUrl: string
  /** Decrypted plain-text secret. */
  secret: string
  isDefault: boolean
  connectedAt: Date
  lastTestAt: Date | null
  lastTestOk: boolean | null
  lastUsedAt: Date | null
}

export interface ConnectionPublic {
  id: string
  label: string
  isDefault: boolean
  connectedAt: number
  lastTestAt: number | null
  lastTestOk: boolean | null
  lastUsedAt: number | null
}

export class NoConnectionsError extends Error {
  constructor() {
    super(
      'No Workspace connections enabled for this conversation. Add one in Settings or enable an account from the conversation panel.',
    )
    this.name = 'NoConnectionsError'
  }
}

export class UnknownLabelError extends Error {
  constructor(public readonly label: string) {
    super(`No enabled Workspace connection labelled "${label}".`)
    this.name = 'UnknownLabelError'
  }
}

export class WriteFanoutError extends Error {
  constructor() {
    super(
      'Write actions can target only one account at a time. Specify the account label explicitly.',
    )
    this.name = 'WriteFanoutError'
  }
}

/**
 * Read every connection a user has, decrypted, sorted with default first.
 * Designed to be cheap: one indexed query, one decrypt per row.
 */
export async function loadConnections(
  db: { select: (...args: unknown[]) => unknown },
  userId: string,
): Promise<ConnectionRecord[]> {
  // The drizzle types here are loose because the db client comes from
  // a function-level call site (`createDrizzleClient()`) — we'd lose
  // ergonomics threading the precise generic through. Runtime shape is
  // verified by the schema.
  // deno-lint-ignore no-explicit-any
  const rows = await (db as any)
    .select()
    .from(workspaceConnections)
    .where(eq(workspaceConnections.userId, userId))
    .all() as Array<{
      id: string
      userId: string
      label: string
      webhookUrl: string
      secretEncrypted: string
      isDefault: boolean
      connectedAt: Date
      lastTestAt: Date | null
      lastTestOk: boolean | null
      lastUsedAt: Date | null
    }>

  const out: ConnectionRecord[] = []
  for (const row of rows) {
    let plain: string
    try {
      plain = await decryptSecret(row.secretEncrypted)
    } catch (err) {
      // Tampered or wrong key — log and skip the row. The user will
      // see this as "connection not working", they can re-paste.
      console.error(
        `[workspace] failed to decrypt connection ${row.id}:`,
        err instanceof Error ? err.message : err,
      )
      continue
    }
    out.push({
      id: row.id,
      userId: row.userId,
      label: row.label,
      webhookUrl: row.webhookUrl,
      secret: plain,
      isDefault: row.isDefault,
      connectedAt: row.connectedAt,
      lastTestAt: row.lastTestAt,
      lastTestOk: row.lastTestOk,
      lastUsedAt: row.lastUsedAt,
    })
  }
  // Default first, then alphabetical so the order is stable in pickers.
  out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  return out
}

/** Convert a record to the safe-to-return-over-the-wire shape. */
export function toPublic(c: ConnectionRecord): ConnectionPublic {
  return {
    id: c.id,
    label: c.label,
    isDefault: c.isDefault,
    connectedAt: Math.floor(c.connectedAt.getTime() / 1000),
    lastTestAt: c.lastTestAt ? Math.floor(c.lastTestAt.getTime() / 1000) : null,
    lastTestOk: c.lastTestOk,
    lastUsedAt: c.lastUsedAt ? Math.floor(c.lastUsedAt.getTime() / 1000) : null,
  }
}

export interface DispatchOptions {
  /** All connections owned by the user, decrypted. */
  all: ConnectionRecord[]
  /**
   * The set of connection IDs that are enabled for the current chat
   * thread. When undefined (e.g. fresh session), we treat the default
   * connection as the implicit single-element enabled set.
   */
  enabledIds?: ReadonlyArray<string>
  /**
   * `'all'` → fan-out (read-only tools only).
   * Any other string → match by label.
   * `undefined` → primary connection within enabled set.
   */
  account?: string
  /** Whether this action mutates state. Affects fan-out validation. */
  isWrite: boolean
}

export interface PerAccountResult {
  connectionId: string
  accountLabel: string
  result: GoogleResult<unknown>
}

/**
 * Resolve which connections to dispatch against and run the action.
 *
 * Returns one entry per connection that was hit. For `'all'` fan-outs,
 * results come back in the same order as the resolved connections
 * (default first). Errors per-connection are returned as `{ ok: false }`
 * envelopes so a partial failure doesn't poison the rest.
 */
export async function dispatch(
  action: GoogleAction,
  options: DispatchOptions,
): Promise<PerAccountResult[]> {
  const { all, enabledIds, account, isWrite } = options

  // Build the enabled set. Undefined `enabledIds` defaults to "primary
  // only" — the assistant should not pick from non-default accounts
  // unless the user opts in via the panel.
  let enabled: ConnectionRecord[]
  if (enabledIds === undefined) {
    const def = all.find((c) => c.isDefault) ?? all[0]
    enabled = def ? [def] : []
  } else {
    const idSet = new Set(enabledIds)
    enabled = all.filter((c) => idSet.has(c.id))
  }

  if (enabled.length === 0) {
    throw new NoConnectionsError()
  }

  // 'all' fan-out
  if (account === 'all') {
    if (isWrite) throw new WriteFanoutError()
    return Promise.all(
      enabled.map(async (c) => ({
        connectionId: c.id,
        accountLabel: c.label,
        result: await runOnConnection(action, c),
      })),
    )
  }

  // Specific label
  if (typeof account === 'string' && account.length > 0) {
    const target = enabled.find(
      (c) => c.label.toLowerCase() === account.toLowerCase(),
    )
    if (!target) throw new UnknownLabelError(account)
    return [
      {
        connectionId: target.id,
        accountLabel: target.label,
        result: await runOnConnection(action, target),
      },
    ]
  }

  // Default — primary within enabled, falling back to first enabled.
  const target = enabled.find((c) => c.isDefault) ?? enabled[0]
  return [
    {
      connectionId: target.id,
      accountLabel: target.label,
      result: await runOnConnection(action, target),
    },
  ]
}

async function runOnConnection(
  action: GoogleAction,
  conn: ConnectionRecord,
): Promise<GoogleResult<unknown>> {
  try {
    return await callGoogleAction(action, {
      url: conn.webhookUrl,
      secret: conn.secret,
    })
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) {
      return {
        ok: false,
        error:
          'This connection is missing its webhook URL or secret. Reconnect it from Settings.',
      }
    }
    if (err instanceof GoogleWebhookError) {
      return {
        ok: false,
        error: `Apps Script returned HTTP ${err.status}.`,
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown bridge error.',
    }
  }
}

/**
 * Helper used by the connection endpoints when a user adds or replaces
 * a connection. Generates a fresh row id and pre-encrypts the secret.
 */
export async function buildConnectionRow(input: {
  userId: string
  label: string
  webhookUrl: string
  secret: string
  isDefault: boolean
}): Promise<{
  id: string
  userId: string
  label: string
  provider: string
  webhookUrl: string
  secretEncrypted: string
  isDefault: boolean
  connectedAt: Date
  lastTestAt: Date | null
  lastTestOk: boolean | null
  lastUsedAt: Date | null
}> {
  const cipher = await encryptSecret(input.secret)
  return {
    id: nanoid(),
    userId: input.userId,
    label: input.label.trim().slice(0, 80),
    provider: 'google_gas',
    webhookUrl: input.webhookUrl.trim(),
    secretEncrypted: cipher,
    isDefault: input.isDefault,
    connectedAt: new Date(),
    lastTestAt: null,
    lastTestOk: null,
    lastUsedAt: null,
  }
}

/**
 * Parse a CSV-encoded connection ID list back into a string array.
 * Empty string ⇒ empty list (user disabled all). Null ⇒ undefined
 * (use defaults).
 */
export function parseEnabledIds(
  csv: string | null,
): string[] | undefined {
  if (csv === null) return undefined
  if (csv.trim().length === 0) return []
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function serializeEnabledIds(ids: string[]): string {
  return ids.join(',')
}
