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
import {
  PomodoroListResponse,
  PomodoroSessionDTO,
  type LogPomodoroRequestBody,
  type PomodoroListResponseBody,
  type PomodoroSession,
} from '@/shared/api/pomodoro.contracts'

const loaderApiFetch = createApiFetch(getCachedAccessToken)

/**
 * Pomodoro session data fetching + mutation.
 *
 * The API is intentionally tiny — just "list" and "log". The Weekly
 * Review screen will eventually consume the same `/api/pomodoro/sessions`
 * endpoint with a date range query param, but for now the per-task
 * filter is enough to power the "X min spent" line under each task.
 */

// ─── List ──────────────────────────────────────────────────────────────────

export const allPomodorosQueryOptions = queryOptions({
  queryKey: ['pomodoro', 'all'] as const,
  queryFn: () =>
    loaderApiFetch<PomodoroListResponseBody>('/api/pomodoro/sessions', {
      method: 'GET',
      schema: PomodoroListResponse,
    }),
  staleTime: 30_000,
})

export function usePomodoroSessions() {
  const { ready, session } = useSession()
  return useQuery({
    ...allPomodorosQueryOptions,
    enabled: ready && !!session,
  })
}

/**
 * Aggregate `seconds spent` per task id from the global session list.
 * Computed on the client to avoid a second round-trip per task; the
 * data is small (one row per session) and the rollup is O(n).
 */
export function useTaskTimeMap(): Map<string, number> {
  const list = usePomodoroSessions()
  const map = new Map<string, number>()
  if (!list.data) return map
  for (const s of list.data.sessions) {
    if (!s.taskId) continue
    map.set(s.taskId, (map.get(s.taskId) ?? 0) + s.durationSec)
  }
  return map
}

// ─── Log a session ─────────────────────────────────────────────────────────

export function useLogPomodoro() {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LogPomodoroRequestBody) =>
      api<PomodoroSession>('/api/pomodoro/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
        schema: PomodoroSessionDTO,
      }),
    onSuccess: () => {
      // Invalidate so the list query refetches with the new row + total.
      qc.invalidateQueries({ queryKey: ['pomodoro'] })
    },
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Compact "1h 23m" / "23m" / "45s" duration formatter. Used in the task
 * row meta line and the floating timer's elapsed display.
 */
export function formatDurationShort(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// re-export so consumers can import the type from one place
export type { PomodoroSession }

// keep zod exports private; consumers should import the types only
export const __schemas = { PomodoroSessionDTO, PomodoroListResponse, _z: z }
