/**
 * JSON response helpers for Netlify Edge Functions.
 *
 * Canonical implementation of the two response primitives every
 * edge-function route handler (and `composeHandler` in `./handler.ts`)
 * uses to emit responses. Keeping them centralized guarantees that:
 *
 *   - Every success and error response carries
 *     `content-type: application/json`, matching the "API Contract"
 *     section of the design.
 *   - Every error response conforms to the envelope
 *     `{ code, message, fieldErrors? }` defined in the design, and the
 *     `fieldErrors` key is only serialized when it contains at least
 *     one entry so clients can reliably distinguish "no field-level
 *     details" from "empty object".
 *
 * Contract:
 *
 *   - `jsonResponse(status, body)` — returns a `Response` whose body is
 *     `JSON.stringify(body)` and whose `content-type` is
 *     `application/json`.
 *   - `errorResponse(status, code, message, fieldErrors?)` — returns a
 *     `Response` whose body is the API error envelope. `fieldErrors`
 *     is optional; when provided and non-empty it is attached to the
 *     envelope, otherwise it is omitted entirely.
 */

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string>,
): Response {
  const envelope: { code: string; message: string; fieldErrors?: Record<string, string> } = {
    code,
    message,
  };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) {
    envelope.fieldErrors = fieldErrors;
  }
  return jsonResponse(status, envelope);
}
