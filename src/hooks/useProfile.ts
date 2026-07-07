import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { z } from 'zod'

import { createApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'
import { useAuthedApi } from '@/hooks/useAuthedApi'
import { useSession } from '@/lib/authStore'

/**
 * User profile + UI preferences.
 *
 * The single profile row drives:
 *   - Greeting on the dashboard (preferred name)
 *   - Avatar in sidebar / dashboard hero
 *   - Accent color preset
 *   - Per-tile dashboard toggles (markets, weather)
 *
 * Lazy-created on the server: GET always succeeds. PATCH does a partial
 * update — only fields you include get changed.
 */

const Profile = z.object({
  displayName: z.string().nullable(),
  preferredName: z.string().nullable(),
  headline: z.string().nullable(),
  avatarEmoji: z.string().nullable(),
  avatarColor: z.string().nullable(),
  locationLabel: z.string().nullable(),
  focusAreas: z.string().nullable(),
  theme: z.enum(['auto', 'light', 'dark']),
  accent: z.enum(['default', 'blue', 'green', 'amber', 'rose', 'violet', 'mono']),
  dateFormat: z.enum(['long', 'short', 'iso']),
  showMarkets: z.boolean(),
  showWeather: z.boolean(),
  updatedAt: z.number(),
})
export type Profile = z.infer<typeof Profile>
export type ThemeKey = Profile['theme']
export type AccentKey = Profile['accent']

const apiFetch = createApiFetch(getCachedAccessToken)

export const profileQueryOptions = queryOptions({
  queryKey: ['profile'] as const,
  queryFn: () =>
    apiFetch('/api/profile', { method: 'GET', schema: Profile }),
  staleTime: 5 * 60_000,
})

export function useProfile() {
  // Gate the query on auth readiness so we don't fire `/api/profile` with
  // a stale `null` token during the initial session restore (which would
  // 401). Once the auth store is ready, the cached token is populated and
  // the query runs normally.
  const { ready, session } = useSession()
  return useQuery({
    ...profileQueryOptions,
    enabled: ready && !!session,
  })
}

export type ProfilePatch = Partial<{
  displayName: string | null
  preferredName: string | null
  headline: string | null
  avatarEmoji: string | null
  avatarColor: string | null
  locationLabel: string | null
  focusAreas: string | null
  theme: ThemeKey
  accent: AccentKey
  dateFormat: 'long' | 'short' | 'iso'
  showMarkets: boolean
  showWeather: boolean
}>

export function useUpdateProfile() {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: ProfilePatch) =>
      api<Profile>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(patch),
        schema: Profile,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(profileQueryOptions.queryKey, updated)
    },
  })
}
