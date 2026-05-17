import { ZodError } from 'zod';
import { errorResponse } from './json.ts';

/**
 * Typed HTTP error thrown by edge-function route handlers and the
 * Auth_Middleware. `composeHandler` converts instances of this class
 * into the API error envelope defined in the design's "API Contract"
 * section: `{ code, message }` with the matching HTTP status.
 *
 * Canonical call sites from the design:
 *   - `throw new HttpError(401, 'missing_token', 'Missing bearer token')`
 *   - `throw new HttpError(401, 'invalid_token', 'Invalid or expired token')`
 *   - `throw new HttpError(404, 'not_found', 'Habit not found')`
 *
 * Handlers MUST throw `HttpError` rather than returning error
 * responses directly so that the auth short-circuit guarantee
 * (Requirement 1.8 / 2.8) remains a single, auditable code path.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Wrap a route handler so that:
 *
 *   1. `HttpError` thrown by the handler (or by `requireAuth`) is
 *      translated into an `errorResponse(status, code, message)`.
 *   2. `zod` `ZodError` thrown by request-body parsing is translated
 *      into an `errorResponse(400, 'validation_failed', …,
 *      fieldErrors)`, with `fieldErrors` derived from the zod issues.
 *      This satisfies the 400 branch of Requirements 3.2, 3.3, and 6.2.
 *   3. Any other unhandled error is logged via `console.error` for
 *      observability and translated into
 *      `errorResponse(500, 'internal_error', 'Internal server error')`
 *      so no handler ever leaks a stack trace to the client.
 *
 * The wrapper preserves the `Request -> Response` shape expected by
 * Netlify Edge Functions and always returns a `Promise<Response>` so
 * callers can `await` it uniformly.
 */
export function composeHandler(
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResponse(err.status, err.code, err.message);
      }

      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          const key = issue.path.length > 0 ? issue.path.join('.') : '_';
          // First message wins when multiple issues target the same path;
          // keeps the error envelope compact and stable for clients.
          if (!(key in fieldErrors)) {
            fieldErrors[key] = issue.message;
          }
        }
        return errorResponse(
          400,
          'validation_failed',
          'Request body failed validation',
          fieldErrors,
        );
      }

      // Unknown / unexpected error: log the raw value for operator
      // observability and return a generic 500 so we never leak
      // stack traces, SQL text, or environment details to clients.
      console.error('[edge-function] unhandled error:', err);
      return errorResponse(500, 'internal_error', 'Internal server error');
    }
  };
}
