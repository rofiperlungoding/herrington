import { useMemo } from 'react'
import { createApiFetch, type ApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'

/**
 * React hook that binds `createApiFetch` to the cached Supabase access token.
 *
 * Uses `getCachedAccessToken()` — a synchronous read from the Zustand auth
 * store — instead of the previous `await supabase.auth.getSession()` per
 * request. The store is kept fresh by the module-level `onAuthStateChange`
 * listener in `authStore.ts`, which updates the token on SIGNED_IN,
 * TOKEN_REFRESHED, and SIGNED_OUT events.
 *
 * This eliminates the per-request Promise overhead, which is especially
 * beneficial during burst mutations (e.g., toggling multiple tasks quickly).
 *
 * Design: S3.2 | Requirements: 10.3, 10.4
 */
export function useAuthedApi(): ApiFetch {
  return useMemo(() => createApiFetch(getCachedAccessToken), [])
}
