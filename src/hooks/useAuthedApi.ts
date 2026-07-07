import { useMemo } from 'react'
import { createApiFetch, type ApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'

/**
 * React hook that binds `createApiFetch` to the cached access token.
 *
 * Uses `getCachedAccessToken()` — a synchronous read from the Zustand auth
 * store. The store is kept fresh by the module-level session logic
 * in `authStore.ts`, which updates the token on boot, refresh, and login events.
 *
 * This eliminates the per-request Promise overhead, which is especially
 * beneficial during burst mutations (e.g., toggling multiple tasks quickly).
 *
 * Design: S3.2 | Requirements: 10.3, 10.4
 */
export function useAuthedApi(): ApiFetch {
  return useMemo(() => createApiFetch(getCachedAccessToken), [])
}
