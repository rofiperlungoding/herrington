import { create } from 'zustand'
import type { Session } from '@supabase/auth-js'
import { supabase } from '@/lib/supabaseClient'

/**
 * Single-source auth store backed by Zustand.
 *
 * Consolidates auth state that was previously scattered across
 * `useAuthBootstrap` (ready/timedOut) and `_authed.tsx` (session + listener).
 *
 * The store subscribes to `supabase.auth.onAuthStateChange` exactly once at
 * module load so the access token is available synchronously before any API
 * call fires. This eliminates the per-request `await getSession()` overhead
 * in `useAuthedApi`.
 *
 * Design: S2.4, S3.2 | Requirements: 10.1, 10.2, 10.3, 10.4
 */

// ─── Store shape ────────────────────────────────────────────────────────────

interface AuthState {
  /** The current Supabase session, or null if signed out / not yet loaded. */
  session: Session | null
  /** The current access token string for synchronous reads. */
  accessToken: string | null
  /** True once the initial session restore has completed (success or failure). */
  ready: boolean
  /** True if the 10-second bootstrap deadline elapsed before session resolved. */
  timedOut: boolean
}

interface AuthActions {
  /** Internal: set session + token from auth state change events. */
  _setSession: (session: Session | null) => void
  /** Internal: mark bootstrap as ready. */
  _setReady: () => void
  /** Internal: mark bootstrap as timed out. */
  _setTimedOut: () => void
  /** Internal: reset timedOut (used when session finally resolves after timeout). */
  _clearTimedOut: () => void
  /** Internal: reset ready + timedOut for retry attempts. */
  _resetForRetry: () => void
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  session: null,
  accessToken: null,
  ready: false,
  timedOut: false,

  _setSession: (session) =>
    set({
      session,
      accessToken: session?.access_token ?? null,
    }),

  _setReady: () => set({ ready: true }),
  _setTimedOut: () => set({ timedOut: true }),
  _clearTimedOut: () => set({ timedOut: false }),
  _resetForRetry: () => set({ ready: false, timedOut: false }),
}))

// ─── Module-level subscription (runs once on import) ────────────────────────

/**
 * Subscribe to auth state changes at module load. This ensures the token
 * cache is populated before any component mounts or API call fires.
 *
 * Events handled:
 * - INITIAL_SESSION: first session restore from localStorage
 * - SIGNED_IN: user just signed in
 * - SIGNED_OUT: user signed out
 * - TOKEN_REFRESHED: background token refresh completed
 */
supabase.auth.onAuthStateChange((event, session) => {
  const { _setSession, _setReady, _clearTimedOut } = useAuthStore.getState()

  switch (event) {
    case 'INITIAL_SESSION':
      _setSession(session)
      _setReady()
      _clearTimedOut()
      break
    case 'SIGNED_IN':
    case 'TOKEN_REFRESHED':
      _setSession(session)
      break
    case 'SIGNED_OUT':
      _setSession(null)
      break
  }
})

/**
 * Catch-all for invalid / revoked refresh tokens.
 *
 * When localStorage carries a stale Supabase session — e.g. the user
 * blew away the project, the token row was wiped server-side, or the
 * refresh expired — supabase-js fires a 400 from `/auth/v1/token` and
 * leaves the store in a half-broken state where `getSession()` returns
 * the stale row but every API call 401s. We intercept the error,
 * clear local storage, and force a sign-out so the app drops cleanly
 * back to `/sign-in` instead of looping.
 *
 * The error event is fired from inside auth-js for any auth-side
 * failure; we filter to refresh-token issues so legitimate sign-in
 * errors still surface to the sign-in form.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e.reason?.message ?? e.reason ?? '')
    if (
      msg.includes('Invalid Refresh Token') ||
      msg.includes('Refresh Token Not Found') ||
      msg.includes('refresh_token_not_found')
    ) {
      console.warn('[auth] stale refresh token — signing out', msg)
      supabase.auth.signOut().catch(() => undefined)
      // Belt + suspenders: clear the supabase storage entry so
      // a stuck cookie/localStorage row doesn't reseed the bad
      // refresh token on next reload.
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('sb-')) localStorage.removeItem(key)
        }
      } catch {
        // localStorage can throw in private browsing — ignore.
      }
      e.preventDefault()
    }
  })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * React hook to read auth session state.
 *
 * Returns `{ session, ready, timedOut }`. Each field is selected with its
 * own `useAuthStore` call so Zustand uses referential equality on
 * primitives / stable session references, avoiding the
 * "getSnapshot should be cached" infinite-loop warning that occurs when
 * a selector returns a fresh object literal on every render.
 *
 * Usage:
 * ```ts
 * const { session, ready, timedOut } = useSession()
 * ```
 */
export function useSession() {
  const session = useAuthStore((s) => s.session)
  const ready = useAuthStore((s) => s.ready)
  const timedOut = useAuthStore((s) => s.timedOut)
  return { session, ready, timedOut }
}

/**
 * Synchronous read of the current access token.
 *
 * Designed for use in `createApiFetch` token getter — avoids the async
 * `supabase.auth.getSession()` call per request. The value is kept fresh
 * by the module-level `onAuthStateChange` listener above.
 *
 * Design: S3.2 | Requirements: 10.3, 10.4
 */
export function getCachedAccessToken(): string | null {
  return useAuthStore.getState().accessToken
}
