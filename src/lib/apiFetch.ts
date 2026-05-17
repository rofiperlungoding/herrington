import { z } from 'zod'

/**
 * Normalized client-side API error.
 *
 * Thrown by `createApiFetch` for:
 *  - missing/unavailable access token (`status = 401`, `code = 'no_token'`)
 *  - non-2xx responses (status mirrors HTTP status; code/message come from the
 *    response body when available, otherwise fall back to `'unknown'` and the
 *    HTTP status text)
 *  - response body that fails the caller-provided zod schema
 *    (`status = 500`, `code = 'schema_mismatch'`) — Requirement 9.6
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Typed fetch function produced by `createApiFetch`. Callers pass a zod schema
 * describing the expected response shape; the returned promise resolves to the
 * parsed value or rejects with `ApiError`.
 */
export type ApiFetch = <T>(
  path: string,
  init: RequestInit & { schema: z.ZodType<T> },
) => Promise<T>

/**
 * Token provider type — can be synchronous or asynchronous.
 *
 * Sync providers (e.g., `getCachedAccessToken`) avoid the Promise overhead
 * on burst mutations. Async providers are still supported for backward
 * compatibility.
 */
export type TokenGetter = () => string | null | Promise<string | null>

/**
 * Build an `ApiFetch` bound to a token provider.
 *
 * The token getter can be synchronous (preferred — avoids per-request Promise
 * overhead) or asynchronous (legacy path via `supabase.auth.getSession()`).
 *
 * The returned function:
 *
 *  1. Attaches `Authorization: Bearer <token>` and a JSON content-type header.
 *  2. Parses the response body as JSON (tolerating empty bodies and 204s).
 *  3. Throws `ApiError` on non-2xx responses, using `code`/`message` from the
 *     body when present.
 *  4. Validates the success body against `init.schema` and throws
 *     `ApiError(500, 'schema_mismatch', ...)` on a mismatch — Requirement 9.6.
 *
 * 204 No Content responses are handled by parsing `undefined` against the
 * schema, so callers for DELETE-style endpoints can use `z.void()` /
 * `z.undefined()`.
 */
export function createApiFetch(
  getToken: TokenGetter,
): ApiFetch {
  return async <T>(
    path: string,
    init: RequestInit & { schema: z.ZodType<T> },
  ): Promise<T> => {
    const { schema, headers, ...rest } = init

    const token = await getToken()
    if (!token) {
      throw new ApiError(401, 'no_token', 'Not authenticated')
    }

    const res = await fetch(path, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...headers,
        authorization: `Bearer ${token}`,
      },
    })

    // 204 No Content has no body — parse `undefined` so callers can use
    // `z.void()` / `z.undefined()` for endpoints like DELETE.
    if (res.status === 204) {
      if (!res.ok) {
        throw new ApiError(res.status, 'unknown', res.statusText)
      }
      const parsed = schema.safeParse(undefined)
      if (!parsed.success) {
        throw new ApiError(
          500,
          'schema_mismatch',
          'Response failed schema validation',
        )
      }
      return parsed.data
    }

    const raw = await res.json().catch(() => null)

    if (!res.ok) {
      const code =
        raw && typeof raw === 'object' && typeof (raw as { code?: unknown }).code === 'string'
          ? (raw as { code: string }).code
          : 'unknown'
      const message =
        raw &&
        typeof raw === 'object' &&
        typeof (raw as { message?: unknown }).message === 'string'
          ? (raw as { message: string }).message
          : res.statusText
      throw new ApiError(res.status, code, message)
    }

    // Requirement 9.6: schema parse failure is a hard error so optimistic
    // mutations roll back via the query client `onError` path.
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      throw new ApiError(
        500,
        'schema_mismatch',
        'Response failed schema validation',
      )
    }
    return parsed.data
  }
}
