import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuthedApi } from '@/hooks/useAuthedApi'
import { queryKeys } from '@/lib/queryKeys'
import { ApiError } from '@/lib/apiFetch'
import { localDayStartSeconds } from '@/lib/date'
import { getUserTimezone } from '@/lib/timezone'
import {
  HabitDTO,
  type CheckOffRequestBody,
  type Habit,
  type HabitListResponseBody,
} from '@/shared/api/habits.contracts'
import { computeNextStreak } from '@/shared/streak/computeNextStreak'

/**
 * Extract a user-friendly error message from an unknown error, preferring
 * `ApiError.message` when available so server-provided validation text (e.g.,
 * `invalid timezone`) reaches the toast (Requirement 9.4).
 */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

type CheckOffMutationVariables = {
  id: string
}

type CheckOffMutationContext = {
  previous: HabitListResponseBody | undefined
}

/**
 * Optimistic `POST /api/habits/:id/check-off` mutation
 * (Requirements 7.5, 7.7, 7.8, 9.2, 9.3, 9.4).
 *
 * The five-step optimistic pattern is applied with one twist: the predicted
 * next state is computed by the **same** pure `computeNextStreak` function the
 * server uses (see `src/shared/streak/computeNextStreak.ts`). Because client
 * and server compute `Local_Today` with identical midnight-UTC encoding via
 * `localDayStartSeconds`, the optimistic values match the authoritative server
 * response in the happy path, making the `onSuccess` reconciliation a no-op
 * diff.
 *
 * 1. `onMutate` (Requirement 7.7, 9.2):
 *    - Cancels in-flight habit queries so they cannot overwrite the prediction.
 *    - Snapshots the list cache for rollback.
 *    - Derives `Local_Today` from `Date.now()` and the browser's IANA zone.
 *    - Runs `computeNextStreak` against the cached habit and merges the
 *      predicted `currentStreak` / `longestStreak` / `lastCompletedDate`
 *      straight into the cached row so the UI updates immediately.
 *
 * 2. `mutationFn` (Requirement 7.5): issues
 *    `POST /api/habits/:id/check-off` with the browser's IANA `timezone` in
 *    the body, parsing the response as `HabitDTO`.
 *
 * 3. `onError` (Requirement 7.8, 9.3, 9.4):
 *    - Restores the exact pre-mutation snapshot, covering both 4xx/5xx
 *      responses and zod-parse failures thrown by `apiFetch` (Requirement 9.6).
 *    - Surfaces a toast identifying the failed action.
 *
 * 4. `onSuccess` (Requirement 9.5): replaces the predicted row with the
 *    authoritative server row. In the happy path this is structurally
 *    identical to the optimistic value; in the rare case where the server
 *    computed a different `Local_Today` (e.g., the user crossed a day
 *    boundary mid-flight), this keeps the cache consistent with the DB.
 *
 * 5. `onSettled`: invalidates the habits query to reconcile against any
 *    changes made by other clients.
 */
export function useCheckOffHabit() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Habit, unknown, CheckOffMutationVariables, CheckOffMutationContext>({
    mutationFn: ({ id }) => {
      const body: CheckOffRequestBody = { timezone: getUserTimezone() }
      return api<Habit>(`/api/habits/${id}/check-off`, {
        method: 'POST',
        body: JSON.stringify(body),
        schema: HabitDTO,
      })
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })

      const previous = qc.getQueryData<HabitListResponseBody>(
        queryKeys.habits.list(),
      )

      // Compute the predicted next streak using the same helpers the server
      // uses. `localDayStartSeconds` accepts milliseconds; `Date.now()` is ms.
      const localToday = localDayStartSeconds(Date.now(), getUserTimezone())

      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return old
        return {
          habits: old.habits.map((h) => {
            if (h.id !== id) return h
            const { next } = computeNextStreak(
              {
                currentStreak: h.currentStreak,
                longestStreak: h.longestStreak,
                lastCompletedDate: h.lastCompletedDate,
              },
              localToday,
            )
            return { ...h, ...next }
          }),
        }
      })

      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.habits.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to check off habit'))
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
