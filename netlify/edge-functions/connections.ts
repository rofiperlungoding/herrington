import { z } from 'zod'
import { and, eq } from 'drizzle-orm'

import { composeHandler, HttpError } from './_lib/handler.ts'
import { requireAuth } from './_lib/auth.ts'
import { createDrizzleClient } from './_lib/db.ts'
import { jsonResponse } from './_lib/json.ts'
import {
  buildConnectionRow,
  loadConnections,
  toPublic,
  type ConnectionRecord,
} from './_lib/workspace.ts'
import { encryptSecret } from './_lib/crypto.ts'
import { callGoogleAction } from './_lib/google.ts'
import { workspaceConnections } from '../../src/shared/db/schema.ts'

/**
 * Workspace connections REST API.
 *
 *   GET    /api/connections           — list user's connections (no secrets)
 *   POST   /api/connections           — add new (validates + tests)
 *   PATCH  /api/connections/:id       — rename, set default, replace creds
 *   DELETE /api/connections/:id       — disconnect
 *   POST   /api/connections/:id/test  — re-run live test
 *
 * Secrets are encrypted before storage. Webhook URL is plaintext.
 * Test = `list_unread_emails` with `max=1` — proof that the bridge
 * accepts our secret and the user's GAS deployment is reachable.
 */

const CreateBody = z.object({
  label: z.string().trim().min(1).max(80),
  webhookUrl: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('https://script.google.com/'),
      'Webhook URL must point to script.google.com.',
    ),
  secret: z.string().min(8).max(2048),
  /** When true (or when this is the first connection), make this the default. */
  setAsDefault: z.boolean().optional(),
})

const PatchBody = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  webhookUrl: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('https://script.google.com/'),
      'Webhook URL must point to script.google.com.',
    )
    .optional(),
  secret: z.string().min(8).max(2048).optional(),
  isDefault: z.literal(true).optional(),
})

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth = await requireAuth(req)
  const db = createDrizzleClient()
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api','connections',...]

  if (segments[0] !== 'api' || segments[1] !== 'connections') {
    throw new HttpError(404, 'route_not_found', 'Route not found')
  }

  // /api/connections
  if (segments.length === 2) {
    if (req.method === 'GET') return list(db, auth.userId)
    if (req.method === 'POST') return create(req, db, auth.userId)
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed')
  }

  // /api/connections/:id  or  /api/connections/:id/test
  const id = segments[2]
  const tail = segments[3]

  if (!tail) {
    if (req.method === 'PATCH') return update(req, db, auth.userId, id)
    if (req.method === 'DELETE') return remove(db, auth.userId, id)
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed')
  }

  if (tail === 'test' && segments.length === 4) {
    if (req.method === 'POST') return test(db, auth.userId, id)
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed')
  }

  throw new HttpError(404, 'route_not_found', 'Route not found')
})

// ─── GET ───────────────────────────────────────────────────────────────────

async function list(
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
): Promise<Response> {
  const connections = await loadConnections(db, userId)
  return jsonResponse(200, {
    connections: connections.map(toPublic),
  })
}

// ─── POST (create) ─────────────────────────────────────────────────────────

async function create(
  req: Request,
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
): Promise<Response> {
  const body = CreateBody.parse(await req.json())
  const existing = await loadConnections(db, userId)

  // Prevent duplicate label
  if (existing.some((c) => c.label.toLowerCase() === body.label.toLowerCase())) {
    throw new HttpError(
      409,
      'duplicate_label',
      `You already have a connection labelled "${body.label}".`,
    )
  }

  // Test the credentials BEFORE persisting. We don't want to keep a
  // bad row around and surface a confusing error later.
  const testRes = await callGoogleAction(
    { kind: 'list_unread_emails', max: 1 },
    { url: body.webhookUrl, secret: body.secret },
  ).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : 'Connection test failed.',
  }))

  if (!testRes.ok) {
    throw new HttpError(
      400,
      'connection_test_failed',
      testRes.error ??
        "Couldn't reach your Apps Script. Check the URL and secret.",
    )
  }

  const isFirst = existing.length === 0
  const wantsDefault = body.setAsDefault === true || isFirst

  // If this connection should be the default, flip every existing
  // default off in the same write batch.
  if (wantsDefault && !isFirst) {
    await db
      .update(workspaceConnections)
      .set({ isDefault: false })
      .where(eq(workspaceConnections.userId, userId))
      .run()
  }

  const row = await buildConnectionRow({
    userId,
    label: body.label,
    webhookUrl: body.webhookUrl,
    secret: body.secret,
    isDefault: wantsDefault,
  })
  // Stamp the successful test we just ran.
  row.lastTestAt = new Date()
  row.lastTestOk = true

  await db.insert(workspaceConnections).values(row).run()

  // Return the freshly-created connection. We re-load via loadConnections
  // so the public shape matches the GET response exactly.
  const updated = await loadConnections(db, userId)
  const created = updated.find((c) => c.id === row.id)
  if (!created) {
    throw new HttpError(500, 'create_failed', 'Connection saved but could not be retrieved.')
  }
  return jsonResponse(201, { connection: toPublic(created) })
}

// ─── PATCH (rename / replace / set default) ────────────────────────────────

async function update(
  req: Request,
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
  id: string,
): Promise<Response> {
  const body = PatchBody.parse(await req.json())
  const existing = await loadConnections(db, userId)
  const row = existing.find((c) => c.id === id)
  if (!row) throw new HttpError(404, 'not_found', 'Connection not found')

  // Build the patch object incrementally.
  const patch: Record<string, unknown> = {}

  if (body.label && body.label.toLowerCase() !== row.label.toLowerCase()) {
    if (
      existing.some(
        (c) => c.id !== id && c.label.toLowerCase() === body.label!.toLowerCase(),
      )
    ) {
      throw new HttpError(
        409,
        'duplicate_label',
        `You already have a connection labelled "${body.label}".`,
      )
    }
    patch.label = body.label.trim()
  }

  // Credential rotation: webhook URL or secret changed → re-test before save.
  if (body.webhookUrl || body.secret) {
    const newUrl = body.webhookUrl ?? row.webhookUrl
    const newSecret = body.secret ?? row.secret
    const testRes = await callGoogleAction(
      { kind: 'list_unread_emails', max: 1 },
      { url: newUrl, secret: newSecret },
    ).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : 'Connection test failed.',
    }))
    if (!testRes.ok) {
      throw new HttpError(
        400,
        'connection_test_failed',
        testRes.error ?? "Couldn't reach your Apps Script with the new credentials.",
      )
    }
    if (body.webhookUrl) patch.webhookUrl = body.webhookUrl.trim()
    if (body.secret) patch.secretEncrypted = await encryptSecret(body.secret)
    patch.lastTestAt = new Date()
    patch.lastTestOk = true
  }

  // Promote to default — same atomic flip-others trick as create.
  if (body.isDefault === true && !row.isDefault) {
    await db
      .update(workspaceConnections)
      .set({ isDefault: false })
      .where(eq(workspaceConnections.userId, userId))
      .run()
    patch.isDefault = true
  }

  if (Object.keys(patch).length === 0) {
    return jsonResponse(200, { connection: toPublic(row) })
  }

  await db
    .update(workspaceConnections)
    .set(patch)
    .where(
      and(
        eq(workspaceConnections.userId, userId),
        eq(workspaceConnections.id, id),
      ),
    )
    .run()

  const refreshed = await loadConnections(db, userId)
  const updated = refreshed.find((c) => c.id === id)
  return jsonResponse(200, { connection: updated ? toPublic(updated) : null })
}

// ─── DELETE ───────────────────────────────────────────────────────────────

async function remove(
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
  id: string,
): Promise<Response> {
  const existing = await loadConnections(db, userId)
  const target = existing.find((c) => c.id === id)
  if (!target) throw new HttpError(404, 'not_found', 'Connection not found')

  await db
    .delete(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.userId, userId),
        eq(workspaceConnections.id, id),
      ),
    )
    .run()

  // Auto-promote first remaining if we just deleted the default.
  if (target.isDefault) {
    const remaining = existing.filter((c) => c.id !== id)
    if (remaining.length > 0) {
      const firstId = remaining[0].id
      await db
        .update(workspaceConnections)
        .set({ isDefault: true })
        .where(eq(workspaceConnections.id, firstId))
        .run()
    }
  }

  return new Response(null, { status: 204 })
}

// ─── POST /:id/test ────────────────────────────────────────────────────────

async function test(
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
  id: string,
): Promise<Response> {
  const existing = await loadConnections(db, userId)
  const conn = existing.find((c: ConnectionRecord) => c.id === id)
  if (!conn) throw new HttpError(404, 'not_found', 'Connection not found')

  const testRes = await callGoogleAction(
    { kind: 'list_unread_emails', max: 1 },
    { url: conn.webhookUrl, secret: conn.secret },
  ).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : 'Connection test failed.',
  }))

  await db
    .update(workspaceConnections)
    .set({
      lastTestAt: new Date(),
      lastTestOk: testRes.ok,
    })
    .where(eq(workspaceConnections.id, id))
    .run()

  return jsonResponse(200, {
    ok: testRes.ok,
    error: testRes.ok ? undefined : testRes.error,
    testedAt: Math.floor(Date.now() / 1000),
  })
}
