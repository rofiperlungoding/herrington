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
 * caches the key set in memory across calls.
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
 * symmetrically-signed JWTs.
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
 * Decode a JWT payload without verification. Used as a last-resort
 * fallback to extract `sub` after an authoritative server-side check
 * with Supabase's `/auth/v1/user` endpoint (which performs full
 * cryptographic verification on Supabase's side).
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Server-side verify-and-fetch via Supabase's `/auth/v1/user` REST
 * endpoint. This is the canonical authoritative check: Supabase
 * verifies the JWT using its own crypto (avoiding any Deno Web Crypto
 * curve quirks), then returns the user record on success or 401 on
 * failure. We extract the `id` from the response — that's the same
 * UUID we'd have read from the verified `sub` claim.
 *
 * Used as the third tier in the verification ladder after JWKS and
 * HS256 fallback both fail. ~50ms overhead compared to in-process
 * verification, but works regardless of which signing algorithm the
 * project is using and is impervious to Deno Web Crypto edge cases.
 */
async function verifyViaSupabase(
  token: string,
): Promise<{ id: string; sessionId?: string } | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const apiKey = Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl) return null;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Supabase requires an apikey header for this endpoint. The
        // publishable key is browser-safe, so we accept it from either
        // SUPABASE_PUBLISHABLE_KEY or the Vite-prefixed mirror.
        apikey:
          apiKey ??
          Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
          Deno.env.get('SUPABASE_ANON_KEY') ??
          '',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    if (typeof data.id !== 'string' || data.id.length === 0) return null;

    // Recover the session id from the JWT payload (Supabase's user
    // endpoint doesn't echo it). Best-effort — we already trust the
    // token because Supabase just verified it.
    const payload = decodeJwtPayload(token);
    const sessionId =
      payload && typeof payload.session_id === 'string'
        ? payload.session_id
        : undefined;
    return { id: data.id, sessionId };
  } catch {
    return null;
  }
}

/**
 * Auth_Middleware entry point for every edge-function route handler.
 *
 * Verifies the incoming `Authorization: Bearer <Supabase_JWT>` header
 * using a three-tier ladder so the function works across every
 * Supabase configuration:
 *
 *   1. Asymmetric verify via JWKS (ES256 / EdDSA). Canonical fast path.
 *   2. Symmetric verify via SUPABASE_JWT_SECRET (HS256). Legacy projects.
 *   3. REST verify via /auth/v1/user. Fallback when Deno's Web Crypto
 *      can't handle the JWKS curve (e.g. ES256 P-256 on certain runtimes).
 *
 * Each tier costs more — JWKS is in-process, HS256 is in-process,
 * REST is a network call. We only escalate when the previous tier
 * rejects the token for a recoverable reason (alg/curve mismatch).
 * Real signature failures, expiry, etc. fall straight through to 401.
 */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) {
    throw new HttpError(401, 'missing_token', 'Missing bearer token');
  }
  const token = match[1];

  // Tier 1: JWKS asymmetric verify.
  try {
    const { payload } = await jwtVerify(token, getJwks());
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
    }
    return {
      userId: payload.sub,
      sessionId:
        typeof payload.session_id === 'string' ? payload.session_id : undefined,
    };
  } catch (jwksErr) {
    if (jwksErr instanceof HttpError) throw jwksErr;
    const isRecoverable =
      jwksErr instanceof Error &&
      (jwksErr.name === 'JOSENotSupported' ||
        jwksErr.name === 'JOSEAlgNotAllowed' ||
        jwksErr.message.includes('Unsupported "alg"') ||
        jwksErr.message.includes('Unsupported key curve') ||
        jwksErr.message.includes('no applicable key'));
    if (!isRecoverable) {
      const detail =
        jwksErr instanceof Error ? `${jwksErr.name}: ${jwksErr.message}` : String(jwksErr);
      console.error('[auth] jwks verify failed:', detail);
      throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
    }
    // Recoverable: try the next tier.
    console.warn(
      '[auth] jwks tier rejected token, escalating:',
      jwksErr instanceof Error ? jwksErr.message : String(jwksErr),
    );
  }

  // Tier 2: HS256 fallback.
  const hsKey = getHsKey();
  if (hsKey) {
    try {
      const { payload } = await jwtVerify(token, hsKey, {
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
      }
      return {
        userId: payload.sub,
        sessionId:
          typeof payload.session_id === 'string'
            ? payload.session_id
            : undefined,
      };
    } catch (hsErr) {
      if (hsErr instanceof HttpError) throw hsErr;
      // HS256 rejected — could be a real ES256 token. Fall through to
      // the REST tier rather than 401-ing prematurely.
      console.warn(
        '[auth] hs256 tier rejected token, escalating:',
        hsErr instanceof Error ? hsErr.message : String(hsErr),
      );
    }
  }

  // Tier 3: REST verify against Supabase.
  const restResult = await verifyViaSupabase(token);
  if (restResult) {
    return { userId: restResult.id, sessionId: restResult.sessionId };
  }

  console.error('[auth] all verification tiers failed');
  throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
}
