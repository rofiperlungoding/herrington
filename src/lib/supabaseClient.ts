import { AuthClient } from '@supabase/auth-js'

/**
 * Lightweight browser-side Supabase Auth client.
 *
 * Performance optimization (Design S1.3, Requirements 2.1, 2.4, 3.4):
 * The app only uses Supabase Auth (getSession, signIn, signUp, signOut,
 * onAuthStateChange). The full `@supabase/supabase-js` `createClient`
 * unconditionally imports and instantiates RealtimeClient, StorageClient,
 * PostgrestClient, and FunctionsClient — none of which are used. By
 * importing `@supabase/auth-js` directly we eliminate ~150 KB raw / ~40 KB
 * gzip of unused Realtime, Storage, PostgREST, and Functions code from the
 * client bundle.
 *
 * - Reads the project URL and publishable key from `import.meta.env`. These
 *   are the new-style sb_publishable_... keys (preferred over the legacy
 *   anon JWT) per Supabase's API key migration.
 * - Persists the session in `localStorage` and auto-refreshes the access
 *   token in the background; React subscribes to changes via
 *   `supabase.auth.onAuthStateChange` from the `_authed` layout route.
 * - Used by:
 *     1. The sign-in route to call `signInWithPassword` / `signUp`.
 *     2. `useAuthedApi` to grab the current access token (a Supabase JWT
 *        signed with the project's asymmetric ES256 key) and forward it
 *        to the Netlify Edge Functions as `Authorization: Bearer <jwt>`.
 *
 * Why a single module-level instance instead of per-call creation:
 * the underlying GoTrue client owns the session refresh timer and the
 * `onAuthStateChange` subscription registry. Multiple instances would
 * each refresh independently and fight over `localStorage`.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url) {
  throw new Error('VITE_SUPABASE_URL is required')
}
if (!key) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is required')
}

/**
 * Auth-only client wrapping `@supabase/auth-js` AuthClient directly.
 *
 * Exposes the same `.auth` interface that the rest of the app consumes,
 * without pulling in Realtime, Storage, PostgREST, or Functions.
 */
const authClient = new AuthClient({
  url: `${url}/auth/v1`,
  headers: {
    Authorization: `Bearer ${key}`,
    apikey: key,
  },
  storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
})

/**
 * Lightweight Supabase client exposing only the `auth` subsystem.
 *
 * All app code accesses `supabase.auth.*` — this object provides that
 * interface while keeping the bundle free of unused Supabase sub-modules.
 */
export const supabase = { auth: authClient } as const
