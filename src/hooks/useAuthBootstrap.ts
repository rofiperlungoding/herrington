import { useCallback, useEffect, useState } from 'react'
import { useAuthStore, bootstrapAuth } from '@/lib/authStore'

/**
 * Tracks the Supabase auth bootstrap state and races it against a 10-second
 * timeout so the app can render an authentication-error retry panel
 * (Requirement 1.6 from `life-management-mvp`). When Supabase finishes
 * restoring the session the `timedOut` flag flips back to `false`
 * (Requirement 1.7).
 *
 * This hook now delegates session state to the Zustand `authStore`
 * (Design S2.4). The store subscribes to `onAuthStateChange` at module load,
 * so `getSession()` is never called here — the store's `ready` flag is set
 * by the `INITIAL_SESSION` event from the listener.
 *
 * The 10-second deadline is still enforced locally: if the store hasn't
 * become `ready` within 10 seconds of mount, `timedOut` is set to `true`
 * in the store. This preserves Property 3 (auth bootstrap deadline).
 *
 * Behaviour:
 *
 * - `ready` becomes `true` after the auth store receives `INITIAL_SESSION`.
 *   Once `true` it stays `true` for the lifetime of the component.
 * - `timedOut` becomes `true` only if 10 seconds elapse before the store
 *   becomes ready. This drives the retry panel in `__root.tsx`.
 * - `retry()` resets the flag and re-attempts session restoration via
 *   `supabase.auth.getSession()`.
 */
export interface AuthBootstrapState {
  /** True once Supabase has finished its initial session-restore attempt. */
  ready: boolean
  /** True if 10 seconds elapsed without session resolving. */
  timedOut: boolean
  /** Resets the timeout and re-attempts the bootstrap. */
  retry: () => void
}

const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000

export function useAuthBootstrap(): AuthBootstrapState {
  const ready = useAuthStore((s) => s.ready)
  const timedOut = useAuthStore((s) => s.timedOut)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // If the store is already ready (e.g., fast session restore), skip the timer.
    if (useAuthStore.getState().ready) return

    const timer = window.setTimeout(() => {
      // Only set timedOut if still not ready when the deadline fires.
      if (!useAuthStore.getState().ready) {
        useAuthStore.getState()._setTimedOut()
      }
    }, AUTH_BOOTSTRAP_TIMEOUT_MS)

    // Watch for the store becoming ready so we can clear the timer early.
    const unsub = useAuthStore.subscribe((state) => {
      if (state.ready) {
        window.clearTimeout(timer)
        unsub()
      }
    })

    return () => {
      window.clearTimeout(timer)
      unsub()
    }
  }, [attempt])

  const retry = useCallback(() => {
    // Reset store state for a fresh attempt (ready=false, timedOut=false).
    useAuthStore.getState()._resetForRetry()

    // Re-trigger session restore. On retry, `INITIAL_SESSION` won't fire
    // again, so we manually resolve the session from `getSession()` and
    // update the store directly.
    bootstrapAuth()

    setAttempt((a) => a + 1)
  }, [])

  return { ready, timedOut, retry }
}
