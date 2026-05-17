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
  TaskDTO,
  TaskListResponse,
  type CreateTaskRequestBody,
  type Task,
  type TaskListResponseBody,
  type UpdateTaskRequestBody,
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

/**
 * Mirror the server's tag normalization so optimistic tasks read the
 * same way as the eventual server response (no flicker between the
 * temp row and the real row).
 */
function normalizeTagsClient(input: string[] | undefined): string[] {
  if (!input) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    const tag = raw.trim().toLowerCase().slice(0, 24)
    if (!tag) continue
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 8) break
  }
  return out
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
 * Shared query options for the tasks list query. Used by both the route
 * loader (for prefetching via `ensureQueryData`) and the `useTasks` hook
 * so they share the same cache key and fetch function.
 */
export const tasksListQueryOptions = queryOptions({
  queryKey: queryKeys.tasks.list(),
  queryFn: () =>
    loaderApiFetch<TaskListResponseBody>('/api/tasks', {
      method: 'GET',
      schema: TaskListResponse,
    }),
})

/**
 * `GET /api/tasks` — returns the full list of tasks for the authenticated
 * user. Server-ordered shape (`{ tasks: Task[] }`) is preserved; the UI is
 * responsible for any client-side sort (Requirement 5.3, 5.4).
 */
export function useTasks() {
  return useQuery(tasksListQueryOptions)
}

/**
 * Context returned from `onMutate` for the create flow. Carries the pre-mutation
 * snapshot for `onError` rollback (Requirement 9.3) and the `tempId` so
 * `onSuccess` can swap the optimistic row for the authoritative server row
 * (Requirement 9.5).
 */
type CreateMutationContext = {
  previous: TaskListResponseBody | undefined
  tempId: string
}

/**
 * Optimistic create. Appends a `temp_`-prefixed placeholder task to the list
 * cache before the API responds, then reconciles with the server row on
 * success.
 */
export function useCreateTask() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Task, unknown, CreateTaskRequestBody, CreateMutationContext>({
    mutationFn: (body) =>
      api<Task>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
        schema: TaskDTO,
      }),
    onMutate: async (body) => {
      // 1. Cancel any in-flight task queries so they cannot overwrite our
      //    optimistic update.
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })

      // 2. Snapshot the current cache so `onError` can roll back.
      const previous = qc.getQueryData<TaskListResponseBody>(
        queryKeys.tasks.list(),
      )

      // 3. Build the optimistic task. `userId` is a placeholder because the
      //    server assigns it; the UI should not display it during the
      //    optimistic window.
      const tempId = `temp_${nanoid()}`
      const tempTask: Task = {
        id: tempId,
        userId: 'optimistic',
        title: body.title,
        category: body.category,
        isCompleted: false,
        deadline: body.deadline ?? null,
        createdAt: Math.floor(Date.now() / 1000),
        rescheduleCount: 0,
        tags: normalizeTagsClient(body.tags),
      }

      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => ({
        tasks: old ? [...old.tasks, tempTask] : [tempTask],
      }))

      return { previous, tempId }
    },
    onError: (err, _body, ctx) => {
      // Requirement 9.3: restore the exact pre-mutation snapshot.
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.tasks.list(), ctx.previous)
      }
      // Requirement 9.4: notify the user which action failed.
      toast.error(errorMessage(err, 'Failed to create task'))
    },
    onSuccess: (serverTask, _body, ctx) => {
      // Requirement 9.5: reconcile cache with the authoritative row.
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return { tasks: [serverTask] }
        return {
          tasks: old.tasks.map((t) =>
            t.id === ctx.tempId ? serverTask : t,
          ),
        }
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

type UpdateMutationVariables = {
  id: string
  updates: UpdateTaskRequestBody
}

type UpdateMutationContext = {
  previous: TaskListResponseBody | undefined
}

/**
 * Optimistic update. Merges the requested fields into the cached task
 * immediately, then replaces it with the server row on success.
 */
export function useUpdateTask() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Task, unknown, UpdateMutationVariables, UpdateMutationContext>({
    mutationFn: ({ id, updates }) =>
      api<Task>(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        schema: TaskDTO,
      }),
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })

      const previous = qc.getQueryData<TaskListResponseBody>(
        queryKeys.tasks.list(),
      )

      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return {
          tasks: old.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t,
          ),
        }
      })

      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.tasks.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to update task'))
    },
    onSuccess: (serverTask) => {
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return { tasks: [serverTask] }
        return {
          tasks: old.tasks.map((t) => (t.id === serverTask.id ? serverTask : t)),
        }
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

type DeleteMutationContext = {
  previous: TaskListResponseBody | undefined
}

/**
 * Optimistic delete. Removes the task from the cache immediately. The server
 * responds with 204, so no `onSuccess` reconciliation is required beyond the
 * `onSettled` invalidation.
 */
export function useDeleteTask() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<void, unknown, string, DeleteMutationContext>({
    mutationFn: (id) =>
      api<void>(`/api/tasks/${id}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })

      const previous = qc.getQueryData<TaskListResponseBody>(
        queryKeys.tasks.list(),
      )

      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return { tasks: old.tasks.filter((t) => t.id !== id) }
      })

      return { previous }
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.tasks.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to delete task'))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}


/**
 * Optimistic reschedule. Pushes the task's deadline forward by 24h on
 * the server and bumps `rescheduleCount`. The optimistic write mirrors
 * that math so the UI updates instantly.
 *
 * Frontend uses `task.rescheduleCount` after this completes to decide
 * whether to show an AI nudge (≥ 3 consecutive pushes).
 */
export function useRescheduleTask() {
  const api = useAuthedApi()
  const qc = useQueryClient()

  return useMutation<Task, unknown, string, UpdateMutationContext>({
    mutationFn: (id) =>
      api<Task>(`/api/tasks/${id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({}),
        schema: TaskDTO,
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      const previous = qc.getQueryData<TaskListResponseBody>(
        queryKeys.tasks.list(),
      )

      const ONE_DAY = 24 * 60 * 60
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return {
          tasks: old.tasks.map((t) => {
            if (t.id !== id) return t
            const baseSec = t.deadline ?? Math.floor(Date.now() / 1000)
            return {
              ...t,
              deadline: baseSec + ONE_DAY,
              rescheduleCount: t.rescheduleCount + 1,
            }
          }),
        }
      })

      return { previous }
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKeys.tasks.list(), ctx.previous)
      }
      toast.error(errorMessage(err, 'Failed to reschedule task'))
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
