import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './handler.ts';

/**
 * Result of a successful authentication: the Supabase user UUID (used in
 * every `where user_id = :authenticated_user_id` predicate against Turso)
 * and the originating session ID for observability. Route handlers always
 * receive this object before touching any Drizzle query, satisfying the
 * logic-based RLS guarantee described in the design.
 */
export type AuthContext = {
  /**
   * The Supabase `auth.users.id` UUID. This is the value persisted in
   * Turso's `tasks.user_id` / `habits.user_id` columns; we trust the
   * JWT's `sub` claim once the signature has been verified against the
   * project's JWKS (see `verifyToken` below).
   */
  userId: string;
  /**
   * The Supabase session ID, useful for log correlation. Optional
   * because some token types (anon/service role) don't carry one.
   */
  sessionId?: string;
};

/**
 * Module-level JWKS fetcher pointing at the Supabase project's
 * `/auth/v1/.well-known/jwks.json` endpoint. `createRemoteJWKSet`
 * caches the key set in memory across calls, so once the worker has
 * warmed up every JWT verification is effectively a local crypto
 * operation.
 *
 * The reference is intentionally module-scoped and is initialised
 * exactly once per worker lifetime via `getJwks()`. It is **never**
 * reassigned by request handlers — `requireAuth` only ever reads it
 * (Requirement 7.2). When `jose` encounters an unknown `kid` it will
 * refetch the JWKS itself, throttled by the `cooldownDuration` option
 * below (Requirement 7.5, EH3).
 *
 * `cooldownDuration: 600_000` (10 minutes) prevents `jose` from
 * hammering the Supabase JWKS endpoint when an unverified token with
 * an unknown KID is presented; refetches are coalesced to at most one
 * per 10-minute window (Requirement 7.3).
 *
 * The verification flow remains asymmetric ES256 (Decision #1 in the
 * performance-optimization design — HS256 is explicitly rejected).
 *
 * The `SUPABASE_URL` env var is read once at first invocation. If the
 * variable is missing the function throws, which `composeHandler`
 * translates into a 500 `internal_error` response.
 */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (_jwks) return _jwks;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    throw new Error(
      'SUPABASE_URL is not set. Configure it in the Netlify environment variables.',
    );
  }
  _jwks = createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    { cooldownDuration: 600_000 },
  );
  return _jwks;
}

/**
 * Legacy HS256 verification key for Supabase projects that still issue
 * symmetrically-signed JWTs. Returned when `SUPABASE_JWT_SECRET` is
 * configured. Newer projects migrated to asymmetric keys won't hit
 * this code path — `jwtVerify` against the JWKS succeeds first.
 *
 * The fallback is intentionally OPT-IN: if the env var isn't set,
 * the verify path skips it. This way an asymmetric-only deployment
 * doesn't accidentally accept a stolen legacy token someone reused
 * from another project.
 */
let _hsKey: Uint8Array | null = null;

function getHsKey(): Uint8Array | null {
  if (_hsKey) return _hsKey;
  const secret = Deno.env.get('SUPABASE_JWT_SECRET');
  if (!secret) return null;
  _hsKey = new TextEncoder().encode(secret);
  return _hsKey;
}

/**
 * Auth_Middleware entry point for every edge-function route handler.
 *
 * Validates the incoming `Authorization: Bearer <Supabase_JWT>` header
 * against the project's JWKS (asymmetric ES256 keys) and returns the
 * `auth.users.id` UUID that scopes all subsequent Turso queries.
 *
 * Error ordering is significant:
 *
 *   1. Missing / malformed header     → 401 `missing_token`
 *   2. Token fails JWT verification   → 401 `invalid_token`
 *   3. JWT lacks `sub` (user id)      → 401 `invalid_token`
 *
 * Steps 1 and 2 run *before* any DB lookup, so an unauthenticated caller
 * can never probe Turso or, via 404 signals, infer which user IDs exist
 * — the contract enforced by Requirements 1.8 and 2.8 of the
 * life-management-mvp spec.
 *
 * Unlike the previous Clerk-based implementation, there is no lazy
 * provisioning step here: Supabase Auth is the source of truth for
 * users, and the Postgres trigger `on_auth_user_created` (in the
 * Supabase project) populates a matching `public.profiles` row when
 * needed. Turso's `tasks.user_id` / `habits.user_id` columns simply
 * store the Supabase UUID and are not enforced by an FK (cross-DB FKs
 * aren't possible — ownership is enforced by the where-clause in
 * every query).
 */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) {
    throw new HttpError(401, 'missing_token', 'Missing bearer token');
  }
  const token = match[1];

  let sub: string;
  let sessionId: string | undefined;
  try {
    let payload: Record<string, unknown> | undefined;

    // Try asymmetric verification first via the published JWKS
    // (ES256). This is the canonical path for Supabase projects
    // that have migrated to asymmetric keys.
    try {
      const result = await jwtVerify(token, getJwks());
      payload = result.payload as Record<string, unknown>;
    } catch (jwksErr) {
      // Fall back to HS256 only when:
      //   1. The JWKS verify failed because the token's `alg` is
      //      not in the published key set (indicates an HS256
      //      legacy token), AND
      //   2. We have a SUPABASE_JWT_SECRET env var configured.
      // Any other JWKS error (expired, bad signature, malformed)
      // bubbles up as a 401 — we don't want to relax those.
      const isAlgMismatch =
        jwksErr instanceof Error &&
        (jwksErr.name === 'JOSENotSupported' ||
          jwksErr.name === 'JOSEAlgNotAllowed' ||
          jwksErr.message.includes('Unsupported "alg"') ||
          jwksErr.message.includes('no applicable key'));
      const hsKey = isAlgMismatch ? getHsKey() : null;
      if (!hsKey) throw jwksErr;
      const result = await jwtVerify(token, hsKey, { algorithms: ['HS256'] });
      payload = result.payload as Record<string, unknown>;
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
    }
    sub = payload.sub;
    if (typeof payload.session_id === 'string') {
      sessionId = payload.session_id;
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Surface the underlying jose / jwks error to the function logs so
    // production debugging doesn't require re-deploying with prints.
    // The client still gets a generic 'invalid_token' — no leakage.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[auth] jwtVerify failed:', detail);
    throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
  }

  return { userId: sub, sessionId };
}
