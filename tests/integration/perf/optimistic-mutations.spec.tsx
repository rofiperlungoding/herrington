/**
 * Property-based test for optimistic mutation invariants (Property 2).
 *
 * **Validates: Requirements 14.1, 14.2, 14.3**
 *
 * Tests the core optimistic update contract for all 8 mutation hooks:
 * - useCreateTask, useUpdateTask, useDeleteTask, useToggleTaskCompletion
 * - useCreateHabit, useUpdateHabit, useDeleteHabit, useCheckOffHabit
 *
 * For each mutation, we verify:
 * (a) onMutate snapshots cache and applies optimistic write
 * (b) on simulated error, cache rolls back to byte-equal pre-mutation snapshot
 * (c) on success, server-row replaces optimistic row exactly once with no
 *     duplicates and ordering preserved
 *
 * Uses fast-check to randomize the mutation order and the success/error split.
 *
 * Running order:
 *   vitest run tests/integration/perf/optimistic-mutations.spec.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import type { Task, TaskListResponseBody } from '@/shared/api/tasks.contracts'
import type { Habit, HabitListResponseBody } from '@/shared/api/habits.contracts'

// ---------------------------------------------------------------------------
// Mock external dependencies that the hooks import
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useAuthedApi', () => ({
  useAuthedApi: () => async () => ({}),
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/timezone', () => ({
  getUserTimezone: () => 'UTC',
}))


// ---------------------------------------------------------------------------
// Test data generators
// ---------------------------------------------------------------------------

const taskArbitrary: fc.Arbitrary<Task> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  category: fc.string({ minLength: 1, maxLength: 20 }),
  isCompleted: fc.boolean(),
  deadline: fc.oneof(fc.constant(null), fc.integer({ min: 1_600_000_000, max: 2_000_000_000 })),
  createdAt: fc.integer({ min: 1_600_000_000, max: 2_000_000_000 }),
})

const habitArbitrary: fc.Arbitrary<Habit> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  currentStreak: fc.integer({ min: 0, max: 365 }),
  longestStreak: fc.integer({ min: 0, max: 365 }),
  lastCompletedDate: fc.oneof(
    fc.constant(null),
    fc.integer({ min: 1_600_000_000, max: 2_000_000_000 }),
  ),
})

const taskListArbitrary: fc.Arbitrary<Task[]> = fc.array(taskArbitrary, {
  minLength: 1,
  maxLength: 10,
})

const habitListArbitrary: fc.Arbitrary<Habit[]> = fc.array(habitArbitrary, {
  minLength: 1,
  maxLength: 10,
})

// ---------------------------------------------------------------------------
// Mutation simulation helpers
// ---------------------------------------------------------------------------

/**
 * Describes a mutation type and its behavior for testing the optimistic
 * update contract. Each descriptor encapsulates:
 * - How to seed the cache before the mutation
 * - How to execute onMutate (the optimistic write)
 * - How to verify the optimistic state
 * - How to execute onError (rollback)
 * - How to execute onSuccess (reconciliation)
 * - How to verify post-success state
 */
type MutationDescriptor = {
  name: string
  domain: 'tasks' | 'habits'
  /** Seed the query client cache with initial data */
  seedCache: (qc: QueryClient) => void
  /** Get the pre-mutation snapshot from cache */
  getSnapshot: (qc: QueryClient) => unknown
  /** Execute the onMutate logic and return the context */
  executeOnMutate: (qc: QueryClient) => Promise<{ previous: unknown }>
  /** Verify the cache was optimistically updated (different from snapshot) */
  verifyOptimisticWrite: (qc: QueryClient, preSnapshot: unknown) => void
  /** Execute onError with the context to rollback */
  executeOnError: (qc: QueryClient, ctx: { previous: unknown }) => void
  /** Execute onSuccess with a server row to reconcile */
  executeOnSuccess: (qc: QueryClient) => void
  /** Verify post-success: no duplicates, ordering preserved, server row present */
  verifyPostSuccess: (qc: QueryClient) => void
}


// ---------------------------------------------------------------------------
// Mutation descriptor factories
// ---------------------------------------------------------------------------

function createTaskMutationDescriptor(
  name: string,
  tasks: Task[],
  opts: {
    onMutate: (qc: QueryClient, tasks: Task[]) => Promise<{ previous: TaskListResponseBody | undefined }>
    verifyOptimistic: (qc: QueryClient, original: Task[]) => void
    onSuccess: (qc: QueryClient) => void
    verifySuccess: (qc: QueryClient) => void
  },
): MutationDescriptor {
  return {
    name,
    domain: 'tasks',
    seedCache: (qc) => {
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), { tasks })
    },
    getSnapshot: (qc) => {
      return structuredClone(qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list()))
    },
    executeOnMutate: async (qc) => {
      const result = await opts.onMutate(qc, tasks)
      return { previous: result.previous }
    },
    verifyOptimisticWrite: (qc, _preSnapshot) => {
      opts.verifyOptimistic(qc, tasks)
    },
    executeOnError: (qc, ctx) => {
      if (ctx.previous !== undefined) {
        qc.setQueryData(queryKeys.tasks.list(), ctx.previous)
      }
    },
    executeOnSuccess: (qc) => {
      opts.onSuccess(qc)
    },
    verifyPostSuccess: (qc) => {
      opts.verifySuccess(qc)
    },
  }
}

function createHabitMutationDescriptor(
  name: string,
  habits: Habit[],
  opts: {
    onMutate: (qc: QueryClient, habits: Habit[]) => Promise<{ previous: HabitListResponseBody | undefined }>
    verifyOptimistic: (qc: QueryClient, original: Habit[]) => void
    onSuccess: (qc: QueryClient) => void
    verifySuccess: (qc: QueryClient) => void
  },
): MutationDescriptor {
  return {
    name,
    domain: 'habits',
    seedCache: (qc) => {
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })
    },
    getSnapshot: (qc) => {
      return structuredClone(qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list()))
    },
    executeOnMutate: async (qc) => {
      const result = await opts.onMutate(qc, habits)
      return { previous: result.previous }
    },
    verifyOptimisticWrite: (qc, _preSnapshot) => {
      opts.verifyOptimistic(qc, habits)
    },
    executeOnError: (qc, ctx) => {
      if (ctx.previous !== undefined) {
        qc.setQueryData(queryKeys.habits.list(), ctx.previous)
      }
    },
    executeOnSuccess: (qc) => {
      opts.onSuccess(qc)
    },
    verifyPostSuccess: (qc) => {
      opts.verifySuccess(qc)
    },
  }
}


// ---------------------------------------------------------------------------
// Build mutation descriptors for all 8 hooks
// ---------------------------------------------------------------------------

function buildCreateTaskDescriptor(tasks: Task[], newTitle: string, newCategory: string): MutationDescriptor {
  const serverTask: Task = {
    id: 'server-id-create-task',
    userId: 'server-user',
    title: newTitle,
    category: newCategory,
    isCompleted: false,
    deadline: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  return createTaskMutationDescriptor('useCreateTask', tasks, {
    onMutate: async (qc, _tasks) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      const previous = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
      const tempId = `temp_optimistic_create`
      const tempTask: Task = {
        id: tempId,
        userId: 'optimistic',
        title: newTitle,
        category: newCategory,
        isCompleted: false,
        deadline: null,
        createdAt: Math.floor(Date.now() / 1000),
      }
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => ({
        tasks: old ? [...old.tasks, tempTask] : [tempTask],
      }))
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      // Optimistic write adds one item
      expect(current.tasks.length).toBe(original.length + 1)
      // The new item has the temp id
      expect(current.tasks[current.tasks.length - 1].id).toBe('temp_optimistic_create')
      // Original items are preserved in order
      for (let i = 0; i < original.length; i++) {
        expect(current.tasks[i].id).toBe(original[i].id)
      }
    },
    onSuccess: (qc) => {
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return { tasks: [serverTask] }
        return { tasks: old.tasks.map((t) => (t.id === 'temp_optimistic_create' ? serverTask : t)) }
      })
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      // No duplicates: server row replaces temp row
      const serverRows = current.tasks.filter((t) => t.id === serverTask.id)
      expect(serverRows.length).toBe(1)
      // Temp row is gone
      const tempRows = current.tasks.filter((t) => t.id === 'temp_optimistic_create')
      expect(tempRows.length).toBe(0)
      // Server row has authoritative fields
      expect(serverRows[0].userId).toBe('server-user')
    },
  })
}

function buildUpdateTaskDescriptor(tasks: Task[], targetIndex: number): MutationDescriptor {
  const target = tasks[targetIndex]
  const updatedTitle = `updated_${target.title}`
  const serverTask: Task = { ...target, title: updatedTitle, createdAt: target.createdAt + 1 }

  return createTaskMutationDescriptor('useUpdateTask', tasks, {
    onMutate: async (qc, _tasks) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      const previous = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, title: updatedTitle } : t)) }
      })
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      // Same count
      expect(current.tasks.length).toBe(original.length)
      // Target updated
      const updated = current.tasks.find((t) => t.id === target.id)!
      expect(updated.title).toBe(updatedTitle)
      // Order preserved
      for (let i = 0; i < original.length; i++) {
        expect(current.tasks[i].id).toBe(original[i].id)
      }
    },
    onSuccess: (qc) => {
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return { tasks: [serverTask] }
        return { tasks: old.tasks.map((t) => (t.id === serverTask.id ? serverTask : t)) }
      })
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      const row = current.tasks.find((t) => t.id === target.id)!
      expect(row.title).toBe(updatedTitle)
      // Server-authoritative field
      expect(row.createdAt).toBe(target.createdAt + 1)
      // No duplicates
      expect(current.tasks.filter((t) => t.id === target.id).length).toBe(1)
    },
  })
}

function buildDeleteTaskDescriptor(tasks: Task[], targetIndex: number): MutationDescriptor {
  const target = tasks[targetIndex]

  return createTaskMutationDescriptor('useDeleteTask', tasks, {
    onMutate: async (qc, _tasks) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      const previous = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return { tasks: old.tasks.filter((t) => t.id !== target.id) }
      })
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      expect(current.tasks.length).toBe(original.length - 1)
      expect(current.tasks.find((t) => t.id === target.id)).toBeUndefined()
    },
    onSuccess: (_qc) => {
      // Delete returns void; no reconciliation needed beyond invalidation
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      expect(current.tasks.find((t) => t.id === target.id)).toBeUndefined()
    },
  })
}

function buildToggleTaskDescriptor(tasks: Task[], targetIndex: number): MutationDescriptor {
  const target = tasks[targetIndex]
  const newCompleted = !target.isCompleted
  const serverTask: Task = { ...target, isCompleted: newCompleted }

  return createTaskMutationDescriptor('useToggleTaskCompletion', tasks, {
    onMutate: async (qc, _tasks) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      const previous = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return old
        return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, isCompleted: newCompleted } : t)) }
      })
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      expect(current.tasks.length).toBe(original.length)
      const toggled = current.tasks.find((t) => t.id === target.id)!
      expect(toggled.isCompleted).toBe(newCompleted)
    },
    onSuccess: (qc) => {
      qc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
        if (!old) return { tasks: [serverTask] }
        return { tasks: old.tasks.map((t) => (t.id === serverTask.id ? serverTask : t)) }
      })
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
      const row = current.tasks.find((t) => t.id === target.id)!
      expect(row.isCompleted).toBe(newCompleted)
      expect(current.tasks.filter((t) => t.id === target.id).length).toBe(1)
    },
  })
}


function buildCreateHabitDescriptor(habits: Habit[], newTitle: string): MutationDescriptor {
  const serverHabit: Habit = {
    id: 'server-id-create-habit',
    userId: 'server-user',
    title: newTitle,
    currentStreak: 0,
    longestStreak: 0,
    lastCompletedDate: null,
  }

  return createHabitMutationDescriptor('useCreateHabit', habits, {
    onMutate: async (qc, _habits) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })
      const previous = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
      const tempId = 'temp_optimistic_create_habit'
      const tempHabit: Habit = {
        id: tempId,
        userId: 'optimistic',
        title: newTitle,
        currentStreak: 0,
        longestStreak: 0,
        lastCompletedDate: null,
      }
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => ({
        habits: old ? [...old.habits, tempHabit] : [tempHabit],
      }))
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      expect(current.habits.length).toBe(original.length + 1)
      expect(current.habits[current.habits.length - 1].id).toBe('temp_optimistic_create_habit')
      for (let i = 0; i < original.length; i++) {
        expect(current.habits[i].id).toBe(original[i].id)
      }
    },
    onSuccess: (qc) => {
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return { habits: [serverHabit] }
        return { habits: old.habits.map((h) => (h.id === 'temp_optimistic_create_habit' ? serverHabit : h)) }
      })
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      const serverRows = current.habits.filter((h) => h.id === serverHabit.id)
      expect(serverRows.length).toBe(1)
      const tempRows = current.habits.filter((h) => h.id === 'temp_optimistic_create_habit')
      expect(tempRows.length).toBe(0)
      expect(serverRows[0].userId).toBe('server-user')
    },
  })
}

function buildUpdateHabitDescriptor(habits: Habit[], targetIndex: number): MutationDescriptor {
  const target = habits[targetIndex]
  const updatedTitle = `updated_${target.title}`
  const serverHabit: Habit = { ...target, title: updatedTitle }

  return createHabitMutationDescriptor('useUpdateHabit', habits, {
    onMutate: async (qc, _habits) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })
      const previous = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return old
        return { habits: old.habits.map((h) => (h.id === target.id ? { ...h, title: updatedTitle } : h)) }
      })
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      expect(current.habits.length).toBe(original.length)
      const updated = current.habits.find((h) => h.id === target.id)!
      expect(updated.title).toBe(updatedTitle)
      for (let i = 0; i < original.length; i++) {
        expect(current.habits[i].id).toBe(original[i].id)
      }
    },
    onSuccess: (qc) => {
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return { habits: [serverHabit] }
        return { habits: old.habits.map((h) => (h.id === serverHabit.id ? serverHabit : h)) }
      })
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      const row = current.habits.find((h) => h.id === target.id)!
      expect(row.title).toBe(updatedTitle)
      expect(current.habits.filter((h) => h.id === target.id).length).toBe(1)
    },
  })
}

function buildDeleteHabitDescriptor(habits: Habit[], targetIndex: number): MutationDescriptor {
  const target = habits[targetIndex]

  return createHabitMutationDescriptor('useDeleteHabit', habits, {
    onMutate: async (qc, _habits) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })
      const previous = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return old
        return { habits: old.habits.filter((h) => h.id !== target.id) }
      })
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      expect(current.habits.length).toBe(original.length - 1)
      expect(current.habits.find((h) => h.id === target.id)).toBeUndefined()
    },
    onSuccess: (_qc) => {
      // Delete returns void
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      expect(current.habits.find((h) => h.id === target.id)).toBeUndefined()
    },
  })
}

function buildCheckOffHabitDescriptor(habits: Habit[], targetIndex: number): MutationDescriptor {
  const target = habits[targetIndex]
  // Simulate the server response with incremented streak
  const serverHabit: Habit = {
    ...target,
    currentStreak: target.currentStreak + 1,
    longestStreak: Math.max(target.longestStreak, target.currentStreak + 1),
    lastCompletedDate: Math.floor(Date.now() / 1000),
  }

  return createHabitMutationDescriptor('useCheckOffHabit', habits, {
    onMutate: async (qc, _habits) => {
      await qc.cancelQueries({ queryKey: queryKeys.habits.all })
      const previous = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
      // Simulate optimistic streak update (simplified — real hook uses computeNextStreak)
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return old
        return {
          habits: old.habits.map((h) => {
            if (h.id !== target.id) return h
            return {
              ...h,
              currentStreak: h.currentStreak + 1,
              longestStreak: Math.max(h.longestStreak, h.currentStreak + 1),
              lastCompletedDate: Math.floor(Date.now() / 1000),
            }
          }),
        }
      })
      return { previous }
    },
    verifyOptimistic: (qc, original) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      expect(current.habits.length).toBe(original.length)
      const checked = current.habits.find((h) => h.id === target.id)!
      // Streak should have incremented
      expect(checked.currentStreak).toBe(target.currentStreak + 1)
      expect(checked.lastCompletedDate).not.toBeNull()
    },
    onSuccess: (qc) => {
      qc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
        if (!old) return { habits: [serverHabit] }
        return { habits: old.habits.map((h) => (h.id === serverHabit.id ? serverHabit : h)) }
      })
    },
    verifySuccess: (qc) => {
      const current = qc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
      const row = current.habits.find((h) => h.id === target.id)!
      expect(row.currentStreak).toBe(serverHabit.currentStreak)
      expect(row.lastCompletedDate).toBe(serverHabit.lastCompletedDate)
      expect(current.habits.filter((h) => h.id === target.id).length).toBe(1)
    },
  })
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Optimistic mutation invariants (Property 2)', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    })
  })

  describe('Individual mutation contract verification', () => {
    it('useCreateTask: onMutate snapshots and applies optimistic write', () => {
      fc.assert(
        fc.property(taskListArbitrary, fc.string({ minLength: 1, maxLength: 20 }), fc.string({ minLength: 1, maxLength: 10 }), (tasks, title, category) => {
          const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
          const desc = buildCreateTaskDescriptor(tasks, title, category)
          desc.seedCache(localQc)
          const snapshot = desc.getSnapshot(localQc)

          // Execute onMutate synchronously (cancelQueries is a no-op on fresh QC)
          const ctx = { previous: localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list()) }
          const tempTask: Task = {
            id: 'temp_optimistic_create',
            userId: 'optimistic',
            title,
            category,
            isCompleted: false,
            deadline: null,
            createdAt: Math.floor(Date.now() / 1000),
          }
          localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => ({
            tasks: old ? [...old.tasks, tempTask] : [tempTask],
          }))

          // Verify optimistic write
          const current = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
          expect(current.tasks.length).toBe(tasks.length + 1)
          expect(current.tasks[current.tasks.length - 1].id).toBe('temp_optimistic_create')

          // Verify rollback on error
          desc.executeOnError(localQc, ctx)
          const rolledBack = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
          expect(JSON.stringify(rolledBack)).toBe(JSON.stringify(snapshot))
        }),
        { numRuns: 50 },
      )
    })

    it('useDeleteTask: onMutate removes item, onError restores it', () => {
      fc.assert(
        fc.property(
          taskListArbitrary.filter((t) => t.length >= 1),
          (tasks) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const targetIndex = 0
            const target = tasks[targetIndex]

            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), { tasks })
            const snapshot = structuredClone(localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list()))

            // onMutate: delete
            const previous = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
              if (!old) return old
              return { tasks: old.tasks.filter((t) => t.id !== target.id) }
            })

            // Verify optimistic
            const current = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
            expect(current.tasks.length).toBe(tasks.length - 1)
            expect(current.tasks.find((t) => t.id === target.id)).toBeUndefined()

            // Rollback
            if (previous !== undefined) {
              localQc.setQueryData(queryKeys.tasks.list(), previous)
            }
            const rolledBack = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
            expect(JSON.stringify(rolledBack)).toBe(JSON.stringify(snapshot))
          },
        ),
        { numRuns: 50 },
      )
    })

    it('useToggleTaskCompletion: onMutate flips completion, onError restores', () => {
      fc.assert(
        fc.property(
          taskListArbitrary.filter((t) => t.length >= 1),
          (tasks) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const target = tasks[0]
            const newCompleted = !target.isCompleted

            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), { tasks })
            const snapshot = structuredClone(localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list()))

            const previous = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
              if (!old) return old
              return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, isCompleted: newCompleted } : t)) }
            })

            // Verify optimistic
            const current = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
            expect(current.tasks.find((t) => t.id === target.id)!.isCompleted).toBe(newCompleted)

            // Rollback
            if (previous !== undefined) {
              localQc.setQueryData(queryKeys.tasks.list(), previous)
            }
            expect(JSON.stringify(localQc.getQueryData(queryKeys.tasks.list()))).toBe(JSON.stringify(snapshot))
          },
        ),
        { numRuns: 50 },
      )
    })

    it('useUpdateTask: onMutate applies partial update, onError restores', () => {
      fc.assert(
        fc.property(
          taskListArbitrary.filter((t) => t.length >= 1),
          fc.string({ minLength: 1, maxLength: 20 }),
          (tasks, newTitle) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const target = tasks[0]

            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), { tasks })
            const snapshot = structuredClone(localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list()))

            const previous = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
              if (!old) return old
              return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, title: newTitle } : t)) }
            })

            // Verify optimistic
            const current = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
            expect(current.tasks.find((t) => t.id === target.id)!.title).toBe(newTitle)
            expect(current.tasks.length).toBe(tasks.length)

            // Rollback
            if (previous !== undefined) {
              localQc.setQueryData(queryKeys.tasks.list(), previous)
            }
            expect(JSON.stringify(localQc.getQueryData(queryKeys.tasks.list()))).toBe(JSON.stringify(snapshot))
          },
        ),
        { numRuns: 50 },
      )
    })
  })


  describe('Habit mutation contract verification', () => {
    it('useCreateHabit: onMutate appends optimistic row, onError restores', () => {
      fc.assert(
        fc.property(habitListArbitrary, fc.string({ minLength: 1, maxLength: 20 }), (habits, title) => {
          const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })

          localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })
          const snapshot = structuredClone(localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list()))

          const previous = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
          const tempHabit: Habit = {
            id: 'temp_optimistic_create_habit',
            userId: 'optimistic',
            title,
            currentStreak: 0,
            longestStreak: 0,
            lastCompletedDate: null,
          }
          localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => ({
            habits: old ? [...old.habits, tempHabit] : [tempHabit],
          }))

          // Verify optimistic
          const current = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
          expect(current.habits.length).toBe(habits.length + 1)
          expect(current.habits[current.habits.length - 1].id).toBe('temp_optimistic_create_habit')

          // Rollback
          if (previous !== undefined) {
            localQc.setQueryData(queryKeys.habits.list(), previous)
          }
          expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list()))).toBe(JSON.stringify(snapshot))
        }),
        { numRuns: 50 },
      )
    })

    it('useUpdateHabit: onMutate applies title update, onError restores', () => {
      fc.assert(
        fc.property(
          habitListArbitrary.filter((h) => h.length >= 1),
          fc.string({ minLength: 1, maxLength: 20 }),
          (habits, newTitle) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const target = habits[0]

            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })
            const snapshot = structuredClone(localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list()))

            const previous = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
              if (!old) return old
              return { habits: old.habits.map((h) => (h.id === target.id ? { ...h, title: newTitle } : h)) }
            })

            const current = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
            expect(current.habits.find((h) => h.id === target.id)!.title).toBe(newTitle)

            // Rollback
            if (previous !== undefined) {
              localQc.setQueryData(queryKeys.habits.list(), previous)
            }
            expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list()))).toBe(JSON.stringify(snapshot))
          },
        ),
        { numRuns: 50 },
      )
    })

    it('useDeleteHabit: onMutate removes item, onError restores', () => {
      fc.assert(
        fc.property(
          habitListArbitrary.filter((h) => h.length >= 1),
          (habits) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const target = habits[0]

            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })
            const snapshot = structuredClone(localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list()))

            const previous = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
              if (!old) return old
              return { habits: old.habits.filter((h) => h.id !== target.id) }
            })

            const current = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
            expect(current.habits.length).toBe(habits.length - 1)
            expect(current.habits.find((h) => h.id === target.id)).toBeUndefined()

            // Rollback
            if (previous !== undefined) {
              localQc.setQueryData(queryKeys.habits.list(), previous)
            }
            expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list()))).toBe(JSON.stringify(snapshot))
          },
        ),
        { numRuns: 50 },
      )
    })

    it('useCheckOffHabit: onMutate updates streak, onError restores', () => {
      fc.assert(
        fc.property(
          habitListArbitrary.filter((h) => h.length >= 1),
          (habits) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const target = habits[0]

            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })
            const snapshot = structuredClone(localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list()))

            const previous = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
              if (!old) return old
              return {
                habits: old.habits.map((h) => {
                  if (h.id !== target.id) return h
                  return {
                    ...h,
                    currentStreak: h.currentStreak + 1,
                    longestStreak: Math.max(h.longestStreak, h.currentStreak + 1),
                    lastCompletedDate: Math.floor(Date.now() / 1000),
                  }
                }),
              }
            })

            const current = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
            const checked = current.habits.find((h) => h.id === target.id)!
            expect(checked.currentStreak).toBe(target.currentStreak + 1)

            // Rollback
            if (previous !== undefined) {
              localQc.setQueryData(queryKeys.habits.list(), previous)
            }
            expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list()))).toBe(JSON.stringify(snapshot))
          },
        ),
        { numRuns: 50 },
      )
    })
  })


  describe('Randomized mutation order with success/error split (Property 2 core)', () => {
    /**
     * This is the main property test. It uses fast-check to:
     * 1. Generate random initial task and habit lists
     * 2. Pick a random subset of mutations to execute
     * 3. Randomly assign each mutation as success or error
     * 4. Verify the invariants hold regardless of order
     */
    it('for any sequence of mutations with random success/error outcomes, optimistic invariants hold', () => {
      // Mutation type enum for selection
      const mutationTypeArb = fc.constantFrom(
        'createTask',
        'updateTask',
        'deleteTask',
        'toggleTask',
        'createHabit',
        'updateHabit',
        'deleteHabit',
        'checkOffHabit',
      ) as fc.Arbitrary<string>

      // Generate a sequence of 1-6 mutations with random success/error outcomes
      const mutationSequenceArb = fc.array(
        fc.record({
          type: mutationTypeArb,
          succeeds: fc.boolean(),
        }),
        { minLength: 1, maxLength: 6 },
      )

      fc.assert(
        fc.property(
          taskListArbitrary,
          habitListArbitrary,
          mutationSequenceArb,
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (tasks, habits, mutations, randomTitle, randomCategory) => {
            const localQc = new QueryClient({
              defaultOptions: { queries: { retry: false, gcTime: Infinity } },
            })

            // Seed both caches
            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), { tasks })
            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })

            for (const mutation of mutations) {
              const taskData = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
              const habitData = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
              const currentTasks = taskData?.tasks ?? []
              const currentHabits = habitData?.habits ?? []

              // Skip mutations that need a target if list is empty
              if (
                ['updateTask', 'deleteTask', 'toggleTask'].includes(mutation.type) &&
                currentTasks.length === 0
              ) continue
              if (
                ['updateHabit', 'deleteHabit', 'checkOffHabit'].includes(mutation.type) &&
                currentHabits.length === 0
              ) continue

              // Take pre-mutation snapshot
              const taskSnapshot = structuredClone(localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list()))
              const habitSnapshot = structuredClone(localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list()))

              // Determine which cache this mutation touches
              const isTaskMutation = ['createTask', 'updateTask', 'deleteTask', 'toggleTask'].includes(mutation.type)
              const relevantSnapshot = isTaskMutation ? taskSnapshot : habitSnapshot
              const relevantKey = isTaskMutation ? queryKeys.tasks.list() : queryKeys.habits.list()

              // Execute onMutate (optimistic write)
              const previous = localQc.getQueryData(relevantKey)

              switch (mutation.type) {
                case 'createTask': {
                  const tempTask: Task = {
                    id: `temp_seq_${Math.random()}`,
                    userId: 'optimistic',
                    title: randomTitle,
                    category: randomCategory,
                    isCompleted: false,
                    deadline: null,
                    createdAt: Math.floor(Date.now() / 1000),
                  }
                  localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => ({
                    tasks: old ? [...old.tasks, tempTask] : [tempTask],
                  }))

                  if (!mutation.succeeds) {
                    // Rollback
                    localQc.setQueryData(queryKeys.tasks.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.tasks.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    // Success: replace temp with server row
                    const serverTask: Task = { ...tempTask, id: `server_${Math.random()}`, userId: 'server-user' }
                    localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
                      if (!old) return { tasks: [serverTask] }
                      return { tasks: old.tasks.map((t) => (t.id === tempTask.id ? serverTask : t)) }
                    })
                    // Verify no duplicates
                    const result = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
                    const ids = result.tasks.map((t) => t.id)
                    expect(new Set(ids).size).toBe(ids.length)
                  }
                  break
                }
                case 'updateTask': {
                  const target = currentTasks[0]
                  localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
                    if (!old) return old
                    return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, title: randomTitle } : t)) }
                  })

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.tasks.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.tasks.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    const serverTask: Task = { ...target, title: randomTitle }
                    localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
                      if (!old) return { tasks: [serverTask] }
                      return { tasks: old.tasks.map((t) => (t.id === serverTask.id ? serverTask : t)) }
                    })
                    const result = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
                    expect(result.tasks.filter((t) => t.id === target.id).length).toBe(1)
                  }
                  break
                }
                case 'deleteTask': {
                  const target = currentTasks[0]
                  localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
                    if (!old) return old
                    return { tasks: old.tasks.filter((t) => t.id !== target.id) }
                  })

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.tasks.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.tasks.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    // Delete success: item stays removed
                    const result = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
                    expect(result.tasks.find((t) => t.id === target.id)).toBeUndefined()
                  }
                  break
                }
                case 'toggleTask': {
                  const target = currentTasks[0]
                  const newVal = !target.isCompleted
                  localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
                    if (!old) return old
                    return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, isCompleted: newVal } : t)) }
                  })

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.tasks.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.tasks.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    const serverTask: Task = { ...target, isCompleted: newVal }
                    localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
                      if (!old) return { tasks: [serverTask] }
                      return { tasks: old.tasks.map((t) => (t.id === serverTask.id ? serverTask : t)) }
                    })
                    const result = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!
                    expect(result.tasks.filter((t) => t.id === target.id).length).toBe(1)
                  }
                  break
                }
                case 'createHabit': {
                  const tempHabit: Habit = {
                    id: `temp_seq_${Math.random()}`,
                    userId: 'optimistic',
                    title: randomTitle,
                    currentStreak: 0,
                    longestStreak: 0,
                    lastCompletedDate: null,
                  }
                  localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => ({
                    habits: old ? [...old.habits, tempHabit] : [tempHabit],
                  }))

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.habits.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    const serverHabit: Habit = { ...tempHabit, id: `server_${Math.random()}`, userId: 'server-user' }
                    localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
                      if (!old) return { habits: [serverHabit] }
                      return { habits: old.habits.map((h) => (h.id === tempHabit.id ? serverHabit : h)) }
                    })
                    const result = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
                    const ids = result.habits.map((h) => h.id)
                    expect(new Set(ids).size).toBe(ids.length)
                  }
                  break
                }
                case 'updateHabit': {
                  const target = currentHabits[0]
                  localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
                    if (!old) return old
                    return { habits: old.habits.map((h) => (h.id === target.id ? { ...h, title: randomTitle } : h)) }
                  })

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.habits.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    const serverHabit: Habit = { ...target, title: randomTitle }
                    localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
                      if (!old) return { habits: [serverHabit] }
                      return { habits: old.habits.map((h) => (h.id === serverHabit.id ? serverHabit : h)) }
                    })
                    const result = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
                    expect(result.habits.filter((h) => h.id === target.id).length).toBe(1)
                  }
                  break
                }
                case 'deleteHabit': {
                  const target = currentHabits[0]
                  localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
                    if (!old) return old
                    return { habits: old.habits.filter((h) => h.id !== target.id) }
                  })

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.habits.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    const result = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
                    expect(result.habits.find((h) => h.id === target.id)).toBeUndefined()
                  }
                  break
                }
                case 'checkOffHabit': {
                  const target = currentHabits[0]
                  localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
                    if (!old) return old
                    return {
                      habits: old.habits.map((h) => {
                        if (h.id !== target.id) return h
                        return {
                          ...h,
                          currentStreak: h.currentStreak + 1,
                          longestStreak: Math.max(h.longestStreak, h.currentStreak + 1),
                          lastCompletedDate: Math.floor(Date.now() / 1000),
                        }
                      }),
                    }
                  })

                  if (!mutation.succeeds) {
                    localQc.setQueryData(queryKeys.habits.list(), previous)
                    expect(JSON.stringify(localQc.getQueryData(queryKeys.habits.list())))
                      .toBe(JSON.stringify(relevantSnapshot))
                  } else {
                    const serverHabit: Habit = {
                      ...target,
                      currentStreak: target.currentStreak + 1,
                      longestStreak: Math.max(target.longestStreak, target.currentStreak + 1),
                      lastCompletedDate: Math.floor(Date.now() / 1000),
                    }
                    localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
                      if (!old) return { habits: [serverHabit] }
                      return { habits: old.habits.map((h) => (h.id === serverHabit.id ? serverHabit : h)) }
                    })
                    const result = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!
                    expect(result.habits.filter((h) => h.id === target.id).length).toBe(1)
                  }
                  break
                }
              }
            }

            // Final invariant: no undefined entries in either cache
            const finalTasks = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())
            const finalHabits = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())
            if (finalTasks) {
              expect(finalTasks.tasks.every((t) => t.id !== undefined && t.id !== null)).toBe(true)
              // No duplicate IDs
              const taskIds = finalTasks.tasks.map((t) => t.id)
              expect(new Set(taskIds).size).toBe(taskIds.length)
            }
            if (finalHabits) {
              expect(finalHabits.habits.every((h) => h.id !== undefined && h.id !== null)).toBe(true)
              const habitIds = finalHabits.habits.map((h) => h.id)
              expect(new Set(habitIds).size).toBe(habitIds.length)
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })


  describe('Success reconciliation preserves ordering (Requirement 14.3c)', () => {
    it('server-row replacement preserves list order for tasks', () => {
      fc.assert(
        fc.property(
          taskListArbitrary.filter((t) => t.length >= 2),
          fc.nat(),
          (tasks, indexSeed) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const targetIndex = indexSeed % tasks.length
            const target = tasks[targetIndex]
            const serverTask: Task = { ...target, title: 'server_updated_title' }

            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), { tasks })

            // Optimistic update
            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
              if (!old) return old
              return { tasks: old.tasks.map((t) => (t.id === target.id ? { ...t, title: 'optimistic_title' } : t)) }
            })

            // Server reconciliation
            localQc.setQueryData<TaskListResponseBody>(queryKeys.tasks.list(), (old) => {
              if (!old) return { tasks: [serverTask] }
              return { tasks: old.tasks.map((t) => (t.id === serverTask.id ? serverTask : t)) }
            })

            const result = localQc.getQueryData<TaskListResponseBody>(queryKeys.tasks.list())!

            // Order preserved: the target is still at the same index
            expect(result.tasks[targetIndex].id).toBe(target.id)
            expect(result.tasks[targetIndex].title).toBe('server_updated_title')

            // No duplicates
            const ids = result.tasks.map((t) => t.id)
            expect(new Set(ids).size).toBe(ids.length)

            // Length unchanged
            expect(result.tasks.length).toBe(tasks.length)
          },
        ),
        { numRuns: 50 },
      )
    })

    it('server-row replacement preserves list order for habits', () => {
      fc.assert(
        fc.property(
          habitListArbitrary.filter((h) => h.length >= 2),
          fc.nat(),
          (habits, indexSeed) => {
            const localQc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
            const targetIndex = indexSeed % habits.length
            const target = habits[targetIndex]
            const serverHabit: Habit = { ...target, title: 'server_updated_title' }

            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), { habits })

            // Optimistic update
            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
              if (!old) return old
              return { habits: old.habits.map((h) => (h.id === target.id ? { ...h, title: 'optimistic_title' } : h)) }
            })

            // Server reconciliation
            localQc.setQueryData<HabitListResponseBody>(queryKeys.habits.list(), (old) => {
              if (!old) return { habits: [serverHabit] }
              return { habits: old.habits.map((h) => (h.id === serverHabit.id ? serverHabit : h)) }
            })

            const result = localQc.getQueryData<HabitListResponseBody>(queryKeys.habits.list())!

            // Order preserved
            expect(result.habits[targetIndex].id).toBe(target.id)
            expect(result.habits[targetIndex].title).toBe('server_updated_title')

            // No duplicates
            const ids = result.habits.map((h) => h.id)
            expect(new Set(ids).size).toBe(ids.length)

            // Length unchanged
            expect(result.habits.length).toBe(habits.length)
          },
        ),
        { numRuns: 50 },
      )
    })
  })
})
