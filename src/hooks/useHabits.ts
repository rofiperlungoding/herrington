import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { useAuthedApi } from '@/hooks/useAuthedApi'
import { queryKeys } from '@/lib/queryKeys'
import { createApiFetch, ApiError } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'
import {
  HabitDTO,
  HabitListResponse,
  type CreateHabitRequestBody,
  type Habit,
  type HabitListResponseBody,
  type UpdateHabitRequestBody,
} from '@/shared/api/habits.contracts'

/**
 * Extract a user-friendly error message from an unknown error, preferring the
 * `ApiError.message` when available so server-provided validation text reaches
 * the toast (Requirement 9.4).
 */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

/**
 * Standalone apiFetch instance for use outside React component context
 * (e.g., route loaders). Reads the current access token synchronously from
 * the Zustand auth store, avoiding the async `getSession()` overhead.
 *
 * Design: S3.2 | Requirements: 10.3, 10.4
 */
const loaderApiFetch = createApiFetch(getCachedAccessToken)

/**
 * Shared query options for the habits list query. Used by both the route
 * loader (for prefetching via `ensureQueryData`) and the `useHabits` hook
 * so they share the same cache key and fetch function.
 */
export const habitsListQueryOptions = queryOptions({
  queryKey: queryKeys.habits.list(),
  queryFn: () =>
    loaderApiFetch<HabitListResponseBody>('/api/habits', {
      method: 'GET',
      schema: HabitListResponse,
    }),
})

/**
 * `GET /api/habits` — returns the full list of habits for the authenticated
 * user. Server-ordered shape (`{ habits: Habit[] }`) is preserved; the UI is
 * responsible for any client-side sort.
 */
export function useHabits() {
  return useQuery(habitsListQueryOptions)
}

/**
 * Context returned from `onMutate` for the create flow. Carries the pre-mutation
 * snapshot for `onError` rollback (Requirement 9.3) and the `tempId` so
 * `onSuccess` can swap the optimistic row for the authoritative server row
 * (Requirement 9.5).
 */
type CreateMutationContext = {
  previous: HabitListResponseBody | undefined
  tempId: string
}

/**
 * Optimistic create. Appends a `temp_`-prefixed placeholder habit to the list
 * cache before the API responds, then reconciles with the server row on
 * success. New habits start with zeroed streak fields and no last-completed
 * date.
 */
export function useCreateHabit() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Habit, unknown, CreateHabitRequestBody, CreateMutationContext>({
    mutationFn: (body) =>
      api<Habit>('/api/habits', {
        method: 'POST',
        body: JSON.stringify(body),
        schema: HabitDTO,
      }),
    onMutate: async (body) => {
      // 1. Cancel any in-flight habit queries so they cannot overwrite our
      //    optimistic update.
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })

      // 2. Snapshot the current cache so `onError` can roll back.
      const previous = qc.getQueryData<HabitListResponseBody>(
        queryKeys.habits.list(),
      )

      // 3. Build the optimistic habit. `userId` is a placeholder because the
      //    server assigns it; the UI should not display it during the
      //    optimistic window.
      const tempId = `temp_${nanoid()}`
      const tempHabit: Habit = {
        id: tempId,
        userId: 'optimistic',
        title: body.title,
        kind: body.kind ?? 'daily',
        currentStreak: 0,
        longestStreak: 0,
        lastCompletedDate: null,
      }

      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => ({
        habits: old ? [...old.habits, tempHabit] : [tempHabit],
      }))

      return { previous, tempId }
    },
    onError: (err, _body, ctx) => {
      // Requirement 9.3: restore the exact pre-mutation snapshot.
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.habits.list(), ctx.previous)
      }
      // Requirement 9.4: notify the user which action failed.
      toast.error(errorMessage(err, 'Failed to create habit'))
    },
    onSuccess: (serverHabit, _body, ctx) => {
      // Requirement 9.5: reconcile cache with the authoritative row.
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return { habits: [serverHabit] }
        return {
          habits: old.habits.map((h) =>
            h.id === ctx.tempId ? serverHabit : h,
          ),
        }
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.habits.all })
    },
  })
}

type UpdateMutationVariables = {
  id: string
  updates: UpdateHabitRequestBody
}

type UpdateMutationContext = {
  previous: HabitListResponseBody | undefined
}

/**
 * Optimistic update. Merges the requested fields into the cached habit
 * immediately, then replaces it with the server row on success. Only `title`
 * is editable here — streak fields are owned by the check-off flow.
 */
export function useUpdateHabit() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Habit, unknown, UpdateMutationVariables, UpdateMutationContext>({
    mutationFn: ({ id, updates }) =>
      api<Habit>(`/api/habits/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        schema: HabitDTO,
      }),
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })

      const previous = qc.getQueryData<HabitListResponseBody>(
        queryKeys.habits.list(),
      )

      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return old
        return {
          habits: old.habits.map((h) =>
            h.id === id ? { ...h, ...updates } : h,
          ),
        }
      })

      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.habits.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to update habit'))
    },
    onSuccess: (serverHabit) => {
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return { habits: [serverHabit] }
        return {
          habits: old.habits.map((h) =>
            h.id === serverHabit.id ? serverHabit : h,
          ),
        }
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.habits.all })
    },
  })
}

type DeleteMutationContext = {
  previous: HabitListResponseBody | undefined
}

/**
 * Optimistic delete. Removes the habit from the cache immediately. The server
 * responds with 204, so no `onSuccess` reconciliation is required beyond the
 * `onSettled` invalidation.
 */
export function useDeleteHabit() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<void, unknown, string, DeleteMutationContext>({
    mutationFn: (id) =>
      api<void>(`/api/habits/${id}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })

      const previous = qc.getQueryData<HabitListResponseBody>(
        queryKeys.habits.list(),
      )

      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return old
        return { habits: old.habits.filter((h) => h.id !== id) }
      })

      return { previous }
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.habits.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to delete habit'))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.habits.all })
    },
  })
}


/**
 * Read the last-N-days completion history for a single habit. Used by
 * the GitHub-style heatmap on each habit row. Server returns an array
 * of day-keys (days since unix epoch) — the component bucket-checks
 * each rendered cell against a Set built from this list.
 */
const HabitCompletionsResponse = z.object({
  dates: z.array(z.number().int()),
})

export function useHabitCompletions(habitId: string, enabled: boolean = true) {
  const api = useAuthedApi()
  return useQuery({
    queryKey: ['habits', habitId, 'completions'] as const,
    queryFn: () =>
      api(`/api/habits/${habitId}/completions`, {
        method: 'GET',
        schema: HabitCompletionsResponse,
      }),
    enabled,
    staleTime: 60_000,
  })
}
