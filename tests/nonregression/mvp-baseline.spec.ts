import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// MVP-critical pure modules. Imported directly so this test fails the build
// the moment any of these files is renamed, deleted, or has its public
// surface changed by the redesign work.
import {
  computeNextStreak,
  type StreakState,
  type StreakTransition,
} from '@/shared/streak/computeNextStreak'

import {
  TaskDTO,
  TaskListResponse,
  CreateTaskRequest,
  UpdateTaskRequest,
  ToggleCompletionRequest,
} from '@/shared/api/tasks.contracts'

import {
  HabitDTO,
  HabitListResponse,
  CreateHabitRequest,
  UpdateHabitRequest,
  CheckOffRequest,
  isValidIanaZone,
} from '@/shared/api/habits.contracts'

// Edge-function route matchers. These are pure, side-effect-free helpers
// (they only inspect `method` + `pathname`), so importing the modules is
// safe in jsdom — `Deno.env` is read lazily inside `createDrizzleClient`,
// which we never invoke from this test.
import {
  matchRoute as matchTaskRoute,
  type TaskRoute,
} from '../../netlify/edge-functions/tasks'
import {
  matchRoute as matchHabitRoute,
  type HabitRoute,
} from '../../netlify/edge-functions/habits'

// Optimistic-mutation hook modules. We intentionally import only the public
// hook names — invoking them would require a React + QueryClient harness,
// which is out of scope for a structural non-regression check.
import * as TasksHook from '@/hooks/useTasks'
import * as HabitsHook from '@/hooks/useHabits'
import * as ToggleTaskHook from '@/hooks/useToggleTaskCompletion'
import * as CheckOffHabitHook from '@/hooks/useCheckOffHabit'

/**
 * **Validates: Requirements 14.5, 14.6, 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 16.8**
 *
 * Property 25: Non-regression with the life-management-mvp baseline.
 *
 * The redesign spec promises (Requirement 16) that no API endpoint, Zod
 * contract, optimistic-mutation hook, streak transition, or auth-guard
 * helper is altered. The MVP-level integration and unit tests are the
 * authoritative behavioural baseline; this spec is a structural smoke
 * test that pins the *shape* of every MVP-critical export so the build
 * fails fast if a rename, deletion, or signature change slips through
 * without the MVP suites being executable in this repository yet.
 *
 * The properties below intentionally test things `tsc` already protects
 * (export presence, Zod field names, route enum membership) so that the
 * redesign cannot inadvertently relax those guarantees through a
 * permissive cast or a `// @ts-expect-error` while skipping a public
 * surface check.
 */

const SECONDS_PER_DAY = 86400

// ---------------------------------------------------------------------------
// 1. Module-presence smoke checks (Requirement 16.1, 16.2, 16.3, 16.4, 16.5)
// ---------------------------------------------------------------------------

describe('Property 25 — MVP module presence', () => {
  it('computeNextStreak is exported as a function', () => {
    expect(typeof computeNextStreak).toBe('function')
  })

  it('every MVP Zod contract is exported as a ZodObject with a .shape', () => {
    const schemas = {
      TaskDTO,
      TaskListResponse,
      CreateTaskRequest,
      UpdateTaskRequest,
      ToggleCompletionRequest,
      HabitDTO,
      HabitListResponse,
      CreateHabitRequest,
      UpdateHabitRequest,
      CheckOffRequest,
    } as const
    for (const [name, schema] of Object.entries(schemas)) {
      expect(typeof schema, `${name} must be importable`).toBe('object')
      expect(typeof schema.parse, `${name}.parse must exist`).toBe('function')
      expect(typeof (schema as { shape?: unknown }).shape, `${name}.shape must exist`).toBe(
        'object',
      )
    }
  })

  it('isValidIanaZone helper is exported as a function', () => {
    expect(typeof isValidIanaZone).toBe('function')
  })

  it('both edge-function matchRoute helpers are exported as functions', () => {
    expect(typeof matchTaskRoute).toBe('function')
    expect(typeof matchHabitRoute).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 2. Zod schema shape snapshots (Requirement 16.2)
// ---------------------------------------------------------------------------

/**
 * Read the field names from a Zod object schema. zod v3/v4 expose `.shape`
 * as a record from field name → ZodType. Sorting normalizes the assertion
 * so reordering fields in the source file does not falsely fail the check.
 */
function shapeKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort()
}

describe('Property 25 — Zod contract field-shape snapshots', () => {
  it('TaskDTO has the canonical MVP field set', () => {
    expect(shapeKeys(TaskDTO)).toEqual(
      ['category', 'createdAt', 'deadline', 'id', 'isCompleted', 'title', 'userId'].sort(),
    )
  })

  it('TaskListResponse wraps tasks under a single "tasks" key', () => {
    expect(shapeKeys(TaskListResponse)).toEqual(['tasks'])
  })

  it('CreateTaskRequest accepts title, category, deadline only', () => {
    expect(shapeKeys(CreateTaskRequest)).toEqual(['category', 'deadline', 'title'])
  })

  it('UpdateTaskRequest accepts title, category, deadline only', () => {
    expect(shapeKeys(UpdateTaskRequest)).toEqual(['category', 'deadline', 'title'])
  })

  it('ToggleCompletionRequest exposes only isCompleted', () => {
    expect(shapeKeys(ToggleCompletionRequest)).toEqual(['isCompleted'])
  })

  it('HabitDTO has the canonical MVP field set', () => {
    expect(shapeKeys(HabitDTO)).toEqual(
      ['currentStreak', 'id', 'lastCompletedDate', 'longestStreak', 'title', 'userId'].sort(),
    )
  })

  it('HabitListResponse wraps habits under a single "habits" key', () => {
    expect(shapeKeys(HabitListResponse)).toEqual(['habits'])
  })

  it('CreateHabitRequest exposes only title', () => {
    expect(shapeKeys(CreateHabitRequest)).toEqual(['title'])
  })

  it('UpdateHabitRequest exposes only title', () => {
    expect(shapeKeys(UpdateHabitRequest)).toEqual(['title'])
  })

  it('CheckOffRequest exposes only timezone', () => {
    expect(shapeKeys(CheckOffRequest)).toEqual(['timezone'])
  })
})

// ---------------------------------------------------------------------------
// 3. computeNextStreak property tests (Requirement 16.4)
// ---------------------------------------------------------------------------

type BranchKind = StreakTransition['kind']

const ALL_BRANCH_KINDS: readonly BranchKind[] = [
  'first',
  'idempotent',
  'increment',
  'reset',
] as const


/**
 * Generate a `Local_Today` candidate roughly within the year-2000-to-2100
 * window. Multiplying by `SECONDS_PER_DAY` and adding the unix-second base
 * for 2000-01-01 keeps the value snapped to a midnight-UTC integer, matching
 * the contract `localDayStartSeconds` produces in the running system.
 */
const localTodayArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 36500 }) // ~100 years of days from epoch base
  .map((days) => 946684800 + days * SECONDS_PER_DAY) // 2000-01-01T00:00:00Z

/**
 * Build a previous-state arbitrary that exercises every branch of the
 * `computeNextStreak` state machine. The branch tag is fed to the property
 * so the assertion can verify the expected transition kind.
 */
function prevStateArb(
  localToday: number,
  branch: BranchKind,
): fc.Arbitrary<StreakState> {
  const positiveStreak = fc.integer({ min: 1, max: 10000 })
  const longest = fc.integer({ min: 0, max: 10000 })

  switch (branch) {
    case 'first':
      // Never checked off before — `lastCompletedDate` is null.
      return fc.tuple(fc.integer({ min: 0, max: 10000 }), longest).map(
        ([curr, lng]) => ({
          currentStreak: curr,
          longestStreak: lng,
          lastCompletedDate: null,
        }),
      )
    case 'idempotent':
      // Last completion was today.
      return fc.tuple(positiveStreak, longest).map(([curr, lng]) => ({
        currentStreak: curr,
        longestStreak: Math.max(curr, lng),
        lastCompletedDate: localToday,
      }))
    case 'increment':
      // Last completion was exactly yesterday.
      return fc.tuple(positiveStreak, longest).map(([curr, lng]) => ({
        currentStreak: curr,
        longestStreak: Math.max(curr, lng),
        lastCompletedDate: localToday - SECONDS_PER_DAY,
      }))
    case 'reset': {
      // Last completion was 2+ days ago.
      const olderOffset = fc.integer({ min: 2, max: 365 })
      return fc.tuple(positiveStreak, longest, olderOffset).map(
        ([curr, lng, off]) => ({
          currentStreak: curr,
          longestStreak: Math.max(curr, lng),
          lastCompletedDate: localToday - off * SECONDS_PER_DAY,
        }),
      )
    }
  }
}

describe('Property 25 — computeNextStreak state-machine invariants (Requirement 16.4)', () => {
  it('returns a transition whose kind is one of the four MVP branches', () => {
    fc.assert(
      fc.property(
        localTodayArb,
        fc.constantFrom(...ALL_BRANCH_KINDS),
        (localToday, branch) => {
          return fc.assert(
            fc.property(prevStateArb(localToday, branch), (prev) => {
              const result = computeNextStreak(prev, localToday)
              expect(ALL_BRANCH_KINDS).toContain(result.kind)
              expect(result.kind).toBe(branch)
              return true
            }),
            { numRuns: 25 },
          )
        },
      ),
      { numRuns: 40 },
    )
  })

  it('non-idempotent transitions yield currentStreak >= 1', () => {
    fc.assert(
      fc.property(
        localTodayArb,
        fc.constantFrom('first' as const, 'increment' as const, 'reset' as const),
        (localToday, branch) => {
          return fc.assert(
            fc.property(prevStateArb(localToday, branch), (prev) => {
              const { next } = computeNextStreak(prev, localToday)
              expect(next.currentStreak).toBeGreaterThanOrEqual(1)
              return true
            }),
            { numRuns: 25 },
          )
        },
      ),
      { numRuns: 30 },
    )
  })

  it('longestStreak is monotonically non-decreasing across every transition', () => {
    fc.assert(
      fc.property(
        localTodayArb,
        fc.constantFrom(...ALL_BRANCH_KINDS),
        (localToday, branch) => {
          return fc.assert(
            fc.property(prevStateArb(localToday, branch), (prev) => {
              const { next } = computeNextStreak(prev, localToday)
              expect(next.longestStreak).toBeGreaterThanOrEqual(prev.longestStreak)
              return true
            }),
            { numRuns: 25 },
          )
        },
      ),
      { numRuns: 40 },
    )
  })

  it('lastCompletedDate.next equals localToday for every non-idempotent transition', () => {
    fc.assert(
      fc.property(
        localTodayArb,
        fc.constantFrom('first' as const, 'increment' as const, 'reset' as const),
        (localToday, branch) => {
          return fc.assert(
            fc.property(prevStateArb(localToday, branch), (prev) => {
              const { next } = computeNextStreak(prev, localToday)
              expect(next.lastCompletedDate).toBe(localToday)
              return true
            }),
            { numRuns: 25 },
          )
        },
      ),
      { numRuns: 30 },
    )
  })

  it('idempotent transitions leave the previous state untouched', () => {
    fc.assert(
      fc.property(localTodayArb, (localToday) => {
        return fc.assert(
          fc.property(prevStateArb(localToday, 'idempotent'), (prev) => {
            const result = computeNextStreak(prev, localToday)
            expect(result.kind).toBe('idempotent')
            expect(result.next).toEqual(prev)
            expect(result.next.lastCompletedDate).toBe(prev.lastCompletedDate)
            return true
          }),
          { numRuns: 25 },
        )
      }),
      { numRuns: 30 },
    )
  })
})

// ---------------------------------------------------------------------------
// 4. matchRoute property tests (Requirement 16.1, 16.7)
// ---------------------------------------------------------------------------

const ID_ARB = fc
  .stringMatching(/^[A-Za-z0-9_-]{1,12}$/)
  // Drop empty strings just in case the regex grammar admits them.
  .filter((s) => s.length > 0)

type TaskRouteCase = {
  method: string
  path: (id: string) => string
  expected: (id: string) => TaskRoute
}

const TASK_ROUTE_TABLE: readonly TaskRouteCase[] = [
  { method: 'GET', path: () => '/api/tasks', expected: () => ({ type: 'list' }) },
  { method: 'POST', path: () => '/api/tasks', expected: () => ({ type: 'create' }) },
  {
    method: 'PATCH',
    path: (id) => `/api/tasks/${id}`,
    expected: (id) => ({ type: 'update', id }),
  },
  {
    method: 'DELETE',
    path: (id) => `/api/tasks/${id}`,
    expected: (id) => ({ type: 'delete', id }),
  },
  {
    method: 'PATCH',
    path: (id) => `/api/tasks/${id}/completion`,
    expected: (id) => ({ type: 'toggle_completion', id }),
  },
]

type HabitRouteCase = {
  method: string
  path: (id: string) => string
  expected: (id: string) => HabitRoute
}

const HABIT_ROUTE_TABLE: readonly HabitRouteCase[] = [
  { method: 'GET', path: () => '/api/habits', expected: () => ({ type: 'list' }) },
  { method: 'POST', path: () => '/api/habits', expected: () => ({ type: 'create' }) },
  {
    method: 'PATCH',
    path: (id) => `/api/habits/${id}`,
    expected: (id) => ({ type: 'update', id }),
  },
  {
    method: 'DELETE',
    path: (id) => `/api/habits/${id}`,
    expected: (id) => ({ type: 'delete', id }),
  },
  {
    method: 'POST',
    path: (id) => `/api/habits/${id}/check-off`,
    expected: (id) => ({ type: 'check_off', id }),
  },
]

describe('Property 25 — Tasks edge-function matchRoute (Requirement 16.1)', () => {
  it('every documented (method, pathname) pair returns the expected TaskRoute', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TASK_ROUTE_TABLE),
        ID_ARB,
        (route, id) => {
          const result = matchTaskRoute(route.method, route.path(id))
          expect(result).toEqual(route.expected(id))
          return true
        },
      ),
      { numRuns: 40 },
    )
  })

  it('unknown method/pathname combinations return null', () => {
    const unknownPaths = [
      '/api/unknown',
      '/api/tasks/123/unknown',
      '/api/tasks/123/completion/extra',
      '/tasks',
      '/api',
      '/',
    ]
    const unknownMethods = ['OPTIONS', 'HEAD', 'PUT', 'TRACE']
    fc.assert(
      fc.property(
        fc.constantFrom(...unknownMethods),
        fc.constantFrom(...unknownPaths),
        (method, path) => {
          expect(matchTaskRoute(method, path)).toBeNull()
          return true
        },
      ),
      { numRuns: 25 },
    )
  })

  it('wrong methods on known pathnames return null', () => {
    expect(matchTaskRoute('PUT', '/api/tasks')).toBeNull()
    expect(matchTaskRoute('GET', '/api/tasks/abc/completion')).toBeNull()
    expect(matchTaskRoute('POST', '/api/tasks/abc')).toBeNull()
  })
})

describe('Property 25 — Habits edge-function matchRoute (Requirement 16.1)', () => {
  it('every documented (method, pathname) pair returns the expected HabitRoute', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HABIT_ROUTE_TABLE),
        ID_ARB,
        (route, id) => {
          const result = matchHabitRoute(route.method, route.path(id))
          expect(result).toEqual(route.expected(id))
          return true
        },
      ),
      { numRuns: 40 },
    )
  })

  it('unknown method/pathname combinations return null', () => {
    const unknownPaths = [
      '/api/unknown',
      '/api/habits/123/unknown',
      '/api/habits/123/check-off/extra',
      '/habits',
      '/api',
      '/',
    ]
    const unknownMethods = ['OPTIONS', 'HEAD', 'PUT', 'TRACE']
    fc.assert(
      fc.property(
        fc.constantFrom(...unknownMethods),
        fc.constantFrom(...unknownPaths),
        (method, path) => {
          expect(matchHabitRoute(method, path)).toBeNull()
          return true
        },
      ),
      { numRuns: 25 },
    )
  })

  it('wrong methods on known pathnames return null', () => {
    expect(matchHabitRoute('PUT', '/api/habits')).toBeNull()
    expect(matchHabitRoute('GET', '/api/habits/abc/check-off')).toBeNull()
    expect(matchHabitRoute('PATCH', '/api/habits/abc/check-off')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. Optimistic-mutation hook export presence (Requirement 16.3, 14.5, 14.6)
// ---------------------------------------------------------------------------

describe('Property 25 — Optimistic-mutation hooks remain exported', () => {
  it('useTasks module exports useTasks, useCreateTask, useUpdateTask, useDeleteTask', () => {
    expect(typeof TasksHook.useTasks).toBe('function')
    expect(typeof TasksHook.useCreateTask).toBe('function')
    expect(typeof TasksHook.useUpdateTask).toBe('function')
    expect(typeof TasksHook.useDeleteTask).toBe('function')
  })

  it('useHabits module exports useHabits, useCreateHabit, useUpdateHabit, useDeleteHabit', () => {
    expect(typeof HabitsHook.useHabits).toBe('function')
    expect(typeof HabitsHook.useCreateHabit).toBe('function')
    expect(typeof HabitsHook.useUpdateHabit).toBe('function')
    expect(typeof HabitsHook.useDeleteHabit).toBe('function')
  })

  it('useToggleTaskCompletion is exported as a function', () => {
    expect(typeof ToggleTaskHook.useToggleTaskCompletion).toBe('function')
  })

  it('useCheckOffHabit is exported as a function', () => {
    expect(typeof CheckOffHabitHook.useCheckOffHabit).toBe('function')
  })
})
