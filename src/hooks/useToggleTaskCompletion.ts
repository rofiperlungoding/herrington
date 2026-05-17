import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuthedApi } from '@/hooks/useAuthedApi'
import { queryKeys } from '@/lib/queryKeys'
import { ApiError } from '@/lib/apiFetch'
import {
  TaskDTO,
  type Task,
  type TaskListResponseBody,
  type ToggleCompletionRequestBody,
} from '@/shared/api/tasks.contracts'

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

type ToggleMutationVariables = {
  id: string
  isCompleted: boolean
}

type ToggleMutationContext = {
  previous: TaskListResponseBody | undefined
}

/**
 * Optimistic completion toggle for tasks (Requirements 4.3, 4.4, 9.1, 9.3, 9.4).
 *
 * The hook follows the standard five-step optimistic pattern:
 *
 * 1. `onMutate` cancels in-flight queries, snapshots the list cache, and
 *    flips `isCompleted` for the target row so the UI updates immediately
 *    (Requirement 4.3, 9.1).
 * 2. `mutationFn` issues `PATCH /api/tasks/:id/completion` with the
 *    `{ isCompleted }` body, parsing the response as `TaskDTO`.
 * 3. `onError` restores the exact pre-mutation snapshot — covering both
 *    4xx/5xx responses (Requirement 4.4) and zod-parse failures thrown by
 *    `apiFetch` (Requirement 9.6) — and surfaces a toast (Requirement 9.4).
 * 4. `onSuccess` replaces the optimistic row with the authoritative server
 *    row so `userId`, `createdAt`, and any other server-owned fields stay
 *    accurate (Requirement 9.5).
 * 5. `onSettled` invalidates the tasks query to reconcile against any
 *    changes made by other clients.
 */
export function useToggleTaskCompletion() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Task, unknown, ToggleMutationVariables, ToggleMutationContext>({
    mutationFn: ({ id, isCompleted }) => {
      const body: ToggleCompletionRequestBody = { isCompleted }
      return api<Task>(`/api/tasks/${id}/completion`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        schema: TaskDTO,
      })
    },
    onMutate: async ({ id, isCompleted }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })

      const previous = qc.getQueryData<TaskListResponseBody>(
        queryKeys.tasks.list(),
      )

      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return {
          tasks: old.tasks.map((t) =>
            t.id === id ? { ...t, isCompleted } : t,
          ),
        }
      })

      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.tasks.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to update task completion'))
    },
    onSuccess: (serverTask) => {
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return { tasks: [serverTask] }
        return {
          tasks: old.tasks.map((t) =>
            t.id === serverTask.id ? serverTask : t,
          ),
        }
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}
