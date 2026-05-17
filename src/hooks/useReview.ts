import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { createApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken, useSession } from '@/lib/authStore'
import { getUserTimezone } from '@/lib/timezone'

/**
 * Weekly Review hook.
 *
 * Server returns a single rolled-up payload covering the last 7 days
 * of the user's activity. We treat it as read-only — the page never
 * mutates this data, just visualizes it.
 */

const ReviewResponse = z.object({
  window: z.object({
    startSec: z.number(),
    endSec: z.number(),
    timezone: z.string(),
  }),
  tasks: z.object({
    createdThisWeek: z.number(),
    completedThisWeek: z.number(),
    completionRate: z.number().nullable(),
    totalReschedules: z.number(),
    topReschedules: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        count: z.number(),
      }),
    ),
    tagBreakdown: z.array(
      z.object({
        tag: z.string(),
        count: z.number(),
      }),
    ),
  }),
  habits: z.object({
    completionRate: z.number().nullable(),
    totalCheckoffs: z.number(),
    totalPossible: z.number(),
    mostSkipped: z
      .object({
        id: z.string(),
        title: z.string(),
        currentStreak: z.number(),
        longestStreak: z.number(),
        checkoffs: z.number(),
        possible: z.number(),
        skipRate: z.number(),
      })
      .nullable(),
    breakdown: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        currentStreak: z.number(),
        longestStreak: z.number(),
        checkoffs: z.number(),
        possible: z.number(),
        skipRate: z.number(),
      }),
    ),
  }),
  focus: z.object({
    totalSec: z.number(),
    sessionCount: z.number(),
    topTasks: z.array(
      z.object({
        taskId: z.string(),
        title: z.string(),
        seconds: z.number(),
      }),
    ),
  }),
})

export type ReviewData = z.infer<typeof ReviewResponse>

const apiFetch = createApiFetch(getCachedAccessToken)

export const reviewQueryOptions = queryOptions({
  queryKey: ['review', 'weekly'] as const,
  queryFn: () => {
    const tz = encodeURIComponent(getUserTimezone())
    return apiFetch<ReviewData>(`/api/review?timezone=${tz}`, {
      method: 'GET',
      schema: ReviewResponse,
    })
  },
  staleTime: 60_000,
})

export function useReview() {
  const { ready, session } = useSession()
  return useQuery({
    ...reviewQueryOptions,
    enabled: ready && !!session,
  })
}
