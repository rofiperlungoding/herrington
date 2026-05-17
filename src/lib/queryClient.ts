/**
 * Shared TanStack Query client for the app.
 *
 * Defaults are tuned for a small productivity app:
 *  - `staleTime: 30s` keeps queries fresh enough for snappy navigation without
 *    hammering the edge functions.
 *  - `gcTime: 5m` keeps unused caches around for a short while so returning to
 *    a screen feels instant.
 *  - `refetchOnWindowFocus: false` avoids surprise re-fetches when the user
 *    tabs back; explicit invalidations in mutation hooks drive freshness.
 *  - Query `retry` only retries once, and never on 4xx client errors (those
 *    are deterministic — e.g. 404 "not found", 400 "bad input" — so retrying
 *    just masks bugs).
 *  - Mutation `retry: 0` because mutations may have side effects; optimistic
 *    updates already handle the rollback path on failure.
 */
import { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from './apiFetch'
import { supabase } from './supabaseClient'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          return false
        }
        return failureCount < 1
      },
    },
    mutations: {
      retry: 0,
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          // Session expired or revoked. Sign out via Supabase so the
          // `_authed` route's `onAuthStateChange` listener flips us to
          // `/sign-in`, then clear cached queries (we don't want stale
          // data from the previous user to flash to the next).
          void supabase.auth.signOut()
          queryClient.clear()
          toast.error('Session expired. Please sign in again.')
        }
      },
    },
  },
})
