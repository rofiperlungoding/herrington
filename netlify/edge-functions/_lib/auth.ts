import { jwtVerify } from 'jose';
import { HttpError } from './handler.ts';

/**
 * Result of a successful authentication: the user UUID (used in
 * every `where user_id = :authenticated_user_id` predicate against Turso)
 * and the originating session ID for observability. Route handlers always
 * receive this object before touching any Drizzle query.
 */
export type AuthContext = {
  /**
   * The `users.id` UUID from Turso. We trust the JWT's `sub` claim
   * once the signature has been verified.
   */
  userId: string;
  /**
   * The session ID from Turso (`sessions.id`).
   */
  sessionId?: string;
};

/**
 * Cached HS256 verification key.
 */
let _hsKey: Uint8Array | null = null;

function getHsKey(): Uint8Array {
  if (_hsKey) return _hsKey;
  const secret = Deno.env.get('AUTH_JWT_SECRET');
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET is not set. Configure it in the Netlify environment variables.');
  }
  _hsKey = new TextEncoder().encode(secret);
  return _hsKey;
}

/**
 * Auth_Middleware entry point for every edge-function route handler.
 *
 * Verifies the incoming `Authorization: Bearer <JWT>` header
 * using the shared AUTH_JWT_SECRET (HS256).
 */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) {
    throw new HttpError(401, 'missing_token', 'Missing bearer token');
  }
  const token = match[1];

  try {
    const { payload } = await jwtVerify(token, getHsKey(), {
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
    }
    return {
      userId: payload.sub,
      sessionId:
        typeof payload.sid === 'string'
          ? payload.sid
          : undefined,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[auth] verify failed:', err instanceof Error ? err.message : String(err));
    throw new HttpError(401, 'invalid_token', 'Invalid or expired token');
  }
}

