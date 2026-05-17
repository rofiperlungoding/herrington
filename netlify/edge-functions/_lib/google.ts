/**
 * Google Workspace bridge.
 *
 * Forwards typed action requests from the chat tool-calling loop
 * to a Google Apps Script Web App that runs inside the user's own
 * Google account. The Apps Script (see `scripts/google-apps-script/`
 * for the source the user pastes into script.google.com) handles the
 * actual Gmail / Calendar / Drive operations using the user's
 * native auth — we never see Google OAuth tokens here, only an
 * arbitrary shared secret that gates the webhook.
 *
 * Architecture (post-multi-account refactor):
 *
 *   chat.ts (tool call)
 *     → workspace.ts (resolve account from session toggle state)
 *     → google.ts (this file: speak HTTP to one bridge)
 *     → GAS Web App
 *     → Gmail/Calendar/Drive
 *
 * Secrets are NOT loaded from environment here anymore — every call
 * accepts an explicit `{ url, secret }` config so the same edge
 * function can serve any number of users, each with their own
 * connection(s). This module is intentionally stateless.
 */

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super(
      'Google Workspace integration is not configured for this connection.',
    )
    this.name = 'GoogleNotConfiguredError'
  }
}

export class GoogleWebhookError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`Google webhook HTTP ${status}: ${detail}`)
    this.name = 'GoogleWebhookError'
  }
}

/**
 * Action discriminator that the Apps Script entry point switches on.
 * The shape is intentionally narrow: each action carries only the
 * fields it needs, and Mistral receives the same set as a JSON Schema
 * via the tool-definition list in `chat.ts`.
 */
export type GoogleAction =
  | {
      kind: 'list_unread_emails'
      /** How many to return. Capped server-side at 10. */
      max?: number
    }
  | {
      kind: 'search_emails'
      /** Gmail search query (e.g. "from:stripe subject:invoice"). */
      query: string
      /** Max threads to return. Capped server-side at 10. */
      max?: number
    }
  | {
      kind: 'check_calendar_availability'
      /** Unix-seconds start of the window (inclusive). */
      startSec: number
      /** Unix-seconds end of the window (exclusive). */
      endSec: number
    }
  | {
      kind: 'create_calendar_event'
      title: string
      /** Unix-seconds start. */
      startSec: number
      /** Unix-seconds end. If omitted, defaults to start + 60min. */
      endSec?: number
      /** Optional description / agenda body. */
      description?: string
    }
  | {
      kind: 'create_doc'
      title: string
      /** Markdown or plain-text body. */
      body: string
      /** Optional Drive folder ID. When omitted, lands in the root. */
      folderId?: string
    }

/**
 * Generic envelope the GAS Web App returns. The `ok` flag plus
 * action-shaped `data` keeps every action consistent on the wire.
 */
export interface GoogleResult<T = unknown> {
  ok: boolean
  data?: T
  /** Human-readable reason on `ok === false`. */
  error?: string
}

export interface ConnectionConfig {
  /** Full HTTPS URL of the deployed GAS Web App. */
  url: string
  /** Plain-text shared secret. Encrypted at rest in the DB. */
  secret: string
}

const REQUEST_TIMEOUT_MS = 12_000

/**
 * Dispatch a single Google Workspace action through one specific GAS
 * bridge. Times out after 12 seconds so a hung Apps Script run cannot
 * stall the chat reply.
 */
export async function callGoogleAction<T = unknown>(
  action: GoogleAction,
  config: ConnectionConfig,
): Promise<GoogleResult<T>> {
  const { url, secret } = config
  if (!url || !secret) {
    throw new GoogleNotConfiguredError()
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  // Apps Script's `doPost(e)` does NOT expose custom HTTP headers — the
  // runtime strips everything except a curated set. We pass the secret
  // as a query parameter instead, which `e.parameter.secret` reliably
  // surfaces. The webhook URL is HTTPS so the secret stays inside TLS.
  const sep = url.includes('?') ? '&' : '?'
  const fullUrl = `${url}${sep}secret=${encodeURIComponent(secret)}`

  let res: Response
  try {
    res = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(action),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new GoogleWebhookError(res.status, detail.slice(0, 300))
  }

  const text = await res.text()
  // Apps Script can fall back to text/html on errors. We try JSON
  // first and fall back to wrapping the raw text as an error envelope
  // so the chat loop never crashes on a malformed response.
  try {
    const parsed = JSON.parse(text) as GoogleResult<T>
    return parsed
  } catch {
    return {
      ok: false,
      error: text.slice(0, 300) || 'Apps Script returned a non-JSON response',
    }
  }
}
