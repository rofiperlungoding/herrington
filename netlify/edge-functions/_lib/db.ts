import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql/web';
import * as schema from '../../../src/shared/db/schema.ts';

/**
 * Module-scoped memoization cache for the Drizzle client.
 *
 * Per design S5.4 (and Requirement 7.1), the libSQL HTTP client is stateless,
 * so the wrapped Drizzle instance can safely be reused across requests served
 * by the same edge worker. We lazily initialise it on first call and reuse
 * the same instance on every subsequent call within the worker's lifetime.
 *
 * The cache lives in module scope so it is preserved across requests for as
 * long as the worker stays warm. If the first call fails (e.g. missing env
 * vars), `_client` stays `null` and a later call will retry initialisation —
 * meaning the missing-config error path is preserved.
 */
let _client: ReturnType<typeof drizzle> | null = null;

/**
 * Create a Drizzle client bound to the Turso database for the current request.
 *
 * Runs inside the Deno-based Netlify Edge runtime, so we use the `/web`
 * entry point of `@libsql/client` (no Node built-ins) and read credentials
 * from `Deno.env`. The Drizzle wrapper is given the shared schema so the
 * query builder has full type information and relation awareness.
 *
 * The first call reads env vars and constructs the client; subsequent calls
 * within the same warm worker return the cached instance directly.
 *
 * Required environment variables (configured on the Netlify site):
 *  - TURSO_DATABASE_URL  libSQL URL, e.g. `libsql://<db>-<org>.turso.io`
 *  - TURSO_AUTH_TOKEN    JWT issued by Turso for the database
 */
export function createDrizzleClient() {
  if (_client) return _client;

  const url = Deno.env.get('TURSO_DATABASE_URL');
  const authToken = Deno.env.get('TURSO_AUTH_TOKEN');

  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Configure it in the Netlify environment variables.',
    );
  }
  if (!authToken) {
    throw new Error(
      'TURSO_AUTH_TOKEN is not set. Configure it in the Netlify environment variables.',
    );
  }

  const client = createClient({ url, authToken });
  _client = drizzle(client, { schema });
  return _client;
}
