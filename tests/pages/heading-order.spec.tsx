import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'

import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ListItem } from '@/components/ui/list-item'
import { TaskItemSkeleton, HabitItemSkeleton } from '@/components/ui/skeleton'

/**
 * **Validates: Requirement 11.10**
 *
 * Property 23: Heading order is monotonically non-skipping.
 *
 * Requirement 11.10 (ui-redesign-google-style) requires Tasks_Page and
 * Habits_Page to "preserve a logical document heading order (`h1` for page
 * title, `h2` for section headings) without skipping levels". The design
 * document phrases it formally:
 *
 *   *For any* render of `Tasks_Page` or `Habits_Page` in any Feedback_State
 *   (loading, empty, error, populated), the sequence of heading levels
 *   produced by walking the document in document order starts at `1` and
 *   never increases by more than one at a time.
 *
 * The two routes — `src/routes/_authed.tasks.tsx` and
 * `src/routes/_authed.habits.tsx` — compose four heading-emitting primitives
 * from the Component_Library and nothing else:
 *
 *   - `<PageHeader>` renders the page `<h1>` (always present).
 *   - `<EmptyState>` renders one `<h2>` (only in the empty state).
 *   - `<ErrorState>` renders one `<h2>` (only in the error state).
 *   - `<TaskItemSkeleton>` / `<HabitItemSkeleton>` / `<ListItem>` render no
 *     heading elements (loading and populated states never add to the
 *     heading walk).
 *
 * Because the routes compose only those primitives plus the create-forms
 * (`TaskCreateForm`, `HabitCreateForm`) and item rows (`TaskItem`,
 * `HabitItem`) — none of which emit headings — the page-level heading walk
 * is fully determined by the active Feedback_State.
 *
 * Rendering the real route components in jsdom would drag in Clerk +
 * TanStack Router + TanStack Query providers, every backend mock the route
 * pulls in via `useTasks` / `useHabits`, and would obscure the geometric
 * invariant we care about. Instead this test renders the same primitive
 * composition the route renders for each Feedback_State, walks the
 * resulting DOM for `<h1>..<h6>` openers, and asserts the sequence:
 *
 *   1. is non-empty (every page render has at least the page-title `<h1>`),
 *   2. starts at `1` (the page title is an `<h1>`, not an `<h2>`), and
 *   3. never jumps forward by more than one level (no `<h1>` → `<h3>` skip).
 *
 * The omitted create-forms and item rows are statically verified to declare
 * zero `<h\d>` openers in their source, so excluding them from the rendered
 * composition cannot mask a future regression.
 */

const ROOT = resolve(__dirname, '../..')

const FEEDBACK_STATES = ['loading', 'empty', 'error', 'populated'] as const
type FeedbackState = (typeof FEEDBACK_STATES)[number]

/**
 * Walk a container in document order and return the heading levels of every
 * `<h1>..<h6>` element. `querySelectorAll` is documented to return matches in
 * tree (document) order, so the resulting list is exactly the sequence a
 * screen-reader would announce while traversing the page.
 */
function extractHeadingLevels(container: HTMLElement): number[] {
  const nodes = container.querySelectorAll<HTMLHeadingElement>(
    'h1, h2, h3, h4, h5, h6',
  )
  return Array.from(nodes).map((el) => parseInt(el.tagName.slice(1), 10))
}

/**
 * Decide whether a heading-level sequence satisfies Requirement 11.10:
 *   - non-empty (a page render must include at least the page-title `<h1>`),
 *   - first level is `1` (page title is an `<h1>`, not an `<h2>`+),
 *   - consecutive forward deltas never exceed `1` (no `h1 → h3` skip).
 *
 * Decreases (`h2 → h1` when a sibling section closes, etc.) are always
 * allowed — Requirement 11.10 only forbids *skipping* forward.
 */
function checkMonotonic(
  levels: readonly number[],
): { ok: true } | { ok: false; reason: string } {
  if (levels.length === 0) {
    return { ok: false, reason: 'no headings rendered (page-title h1 missing)' }
  }
  if (levels[0] !== 1) {
    return {
      ok: false,
      reason: `first heading must be <h1>, got <h${levels[0]}>`,
    }
  }
  for (let i = 1; i < levels.length; i++) {
    const delta = levels[i] - levels[i - 1]
    if (delta > 1) {
      return {
        ok: false,
        reason: `heading at position ${i} jumps from <h${levels[i - 1]}> to <h${levels[i]}> (skips a level)`,
      }
    }
  }
  return { ok: true }
}

/**
 * The Tasks_Page header in its canonical configuration. Title, description,
 * and a primary CTA are passed in as the route does, so the rendered DOM
 * matches the route surface.
 */
function TasksHeader() {
  return (
    <PageHeader
      title="Tasks"
      description="Manage your tasks and deadlines"
      action={<button type="button">New task</button>}
    />
  )
}

function HabitsHeader() {
  return (
    <PageHeader
      title="Habits"
      description="Build consistency with daily habits. Check off each day to grow your streak."
      action={<button type="button">New habit</button>}
    />
  )
}

/**
 * Render the same primitive composition the Tasks_Page route renders for the
 * given Feedback_State. The TaskCreateForm slot is intentionally omitted —
 * the source-scan test below proves it emits zero heading elements, so its
 * exclusion from this composition cannot hide a heading-order regression.
 */
function renderTasksPage(state: FeedbackState) {
  return render(
    <div>
      <TasksHeader />
      {state === 'loading' && (
        <ul aria-busy="true" aria-label="Loading tasks">
          <TaskItemSkeleton />
          <TaskItemSkeleton />
        </ul>
      )}
      {state === 'error' && (
        <ErrorState
          title="Failed to load tasks"
          description="Something went wrong. Please try again."
          action={<button type="button">Retry</button>}
        />
      )}
      {state === 'empty' && (
        <EmptyState
          title="No tasks yet"
          description="Create your first task to get started."
          action={<button type="button">Create task</button>}
        />
      )}
      {state === 'populated' && (
        <ul>
          <ListItem title={<span>Sample task</span>} />
          <ListItem title={<span>Another task</span>} />
        </ul>
      )}
    </div>,
  )
}

function renderHabitsPage(state: FeedbackState) {
  return render(
    <div>
      <HabitsHeader />
      {state === 'loading' && (
        <ul aria-busy="true" aria-label="Loading habits">
          <HabitItemSkeleton />
          <HabitItemSkeleton />
        </ul>
      )}
      {state === 'error' && (
        <ErrorState
          title="Failed to load habits"
          description="An unexpected error occurred. Please try again."
          action={<button type="button">Retry</button>}
        />
      )}
      {state === 'empty' && (
        <EmptyState
          title="No habits yet"
          description="Create your first habit to start building streaks."
          action={<button type="button">Create a habit</button>}
        />
      )}
      {state === 'populated' && (
        <ul>
          <ListItem title={<span>Drink water</span>} />
          <ListItem title={<span>Stretch for 5 minutes</span>} />
        </ul>
      )}
    </div>,
  )
}

/**
 * Files in the page tree that are NOT expected to declare a heading element
 * of their own. The route files compose `PageHeader`, `EmptyState`, and
 * `ErrorState` (the only heading-emitting primitives) and never inline an
 * `<h*>` themselves; the create-forms, item rows, skeletons, and the
 * `ListItem` primitive are likewise heading-free. If any of these files
 * grows a stray `<h*>` opener the heading walk could pick up a level that
 * skips, and the rendered composition above would no longer mirror the real
 * page.
 */
const HEADING_FREE_FILES = [
  'src/routes/_authed.tasks.tsx',
  'src/routes/_authed.habits.tsx',
  'src/components/tasks/TaskItem.tsx',
  'src/components/tasks/TaskCreateForm.tsx',
  'src/components/habits/HabitItem.tsx',
  'src/components/habits/HabitCreateForm.tsx',
  'src/components/ui/skeleton.tsx',
  'src/components/ui/list-item.tsx',
] as const

/**
 * Strip JSX `{/* ... *\/}`, JS block, and JS line comments so commented-out
 * `<h*>` snippets inside JSDoc don't pollute the static scan.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const HEADING_FREE_SOURCES = HEADING_FREE_FILES.map((p) => ({
  path: p,
  source: readFileSync(resolve(ROOT, p), 'utf-8'),
}))

describe('Property 23: Heading order is monotonically non-skipping', () => {
  it('PageHeader emits exactly one <h1> (the page-title role)', () => {
    const { container, unmount } = render(<TasksHeader />)
    try {
      expect(extractHeadingLevels(container)).toEqual([1])
    } finally {
      unmount()
    }
  })

  it('EmptyState emits exactly one <h2> (a section-heading role under the page <h1>)', () => {
    const { container, unmount } = render(
      <EmptyState
        title="Nothing here"
        description="A description"
        action={<button type="button">Action</button>}
      />,
    )
    try {
      expect(extractHeadingLevels(container)).toEqual([2])
    } finally {
      unmount()
    }
  })

  it('ErrorState emits exactly one <h2> (a section-heading role under the page <h1>)', () => {
    const { container, unmount } = render(
      <ErrorState
        title="It broke"
        description="A description"
        action={<button type="button">Retry</button>}
      />,
    )
    try {
      expect(extractHeadingLevels(container)).toEqual([2])
    } finally {
      unmount()
    }
  })

  it('TaskItemSkeleton, HabitItemSkeleton, and ListItem emit zero heading elements', () => {
    const taskSkeleton = render(<TaskItemSkeleton />)
    try {
      expect(extractHeadingLevels(taskSkeleton.container)).toEqual([])
    } finally {
      taskSkeleton.unmount()
    }

    const habitSkeleton = render(<HabitItemSkeleton />)
    try {
      expect(extractHeadingLevels(habitSkeleton.container)).toEqual([])
    } finally {
      habitSkeleton.unmount()
    }

    const listItem = render(<ListItem title={<span>row</span>} />)
    try {
      expect(extractHeadingLevels(listItem.container)).toEqual([])
    } finally {
      listItem.unmount()
    }
  })

  it('the route files, create-forms, item rows, skeletons, and list-item primitive declare zero inline <h*> openers', () => {
    // The only heading-emitting primitives Tasks_Page and Habits_Page
    // compose are PageHeader (h1), EmptyState (h2), and ErrorState (h2). If
    // any file in this list grows a stray <h*> opener it could either skip
    // a level (e.g. the route inlines an <h3> next to PageHeader) or insert
    // a sibling heading the rendered composition above doesn't account for.
    for (const f of HEADING_FREE_SOURCES) {
      const stripped = stripComments(f.source)
      const matches = stripped.match(/<h[1-6]\b/g)
      expect(
        matches,
        `${f.path} must not introduce inline heading elements; the only ` +
          `heading-emitting primitives are PageHeader (h1), EmptyState (h2), ` +
          `and ErrorState (h2). Found: ${matches?.join(', ') ?? 'none'}`,
      ).toBeNull()
    }
  })

  it('for any Feedback_State, the Tasks_Page heading walk starts at <h1> and never skips a level (property test)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FEEDBACK_STATES), (state) => {
        const { container, unmount } = renderTasksPage(state)
        try {
          const levels = extractHeadingLevels(container)
          const result = checkMonotonic(levels)
          if (!result.ok) {
            throw new Error(
              `Tasks_Page (${state}) heading order [${levels.join(', ')}]: ${result.reason}`,
            )
          }
          return true
        } finally {
          unmount()
        }
      }),
      // 50 runs sample each of the four states with overwhelming probability,
      // so the property is exercised across the full Feedback_State set.
      { numRuns: 50 },
    )
  })

  it('for any Feedback_State, the Habits_Page heading walk starts at <h1> and never skips a level (property test)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FEEDBACK_STATES), (state) => {
        const { container, unmount } = renderHabitsPage(state)
        try {
          const levels = extractHeadingLevels(container)
          const result = checkMonotonic(levels)
          if (!result.ok) {
            throw new Error(
              `Habits_Page (${state}) heading order [${levels.join(', ')}]: ${result.reason}`,
            )
          }
          return true
        } finally {
          unmount()
        }
      }),
      { numRuns: 50 },
    )
  })

  it('every Feedback_State is exercised at least once (deterministic enumeration backstop)', () => {
    // Belt-and-braces: the property test above samples randomly. Iterate
    // each state explicitly so a regression in one Feedback_State cannot
    // hide behind unfavourable sampling.
    for (const state of FEEDBACK_STATES) {
      const tasks = renderTasksPage(state)
      try {
        const tLevels = extractHeadingLevels(tasks.container)
        const tResult = checkMonotonic(tLevels)
        expect(
          tResult.ok,
          `Tasks_Page (${state}) heading order [${tLevels.join(', ')}]: ${
            tResult.ok ? '' : tResult.reason
          }`,
        ).toBe(true)
      } finally {
        tasks.unmount()
      }

      const habits = renderHabitsPage(state)
      try {
        const hLevels = extractHeadingLevels(habits.container)
        const hResult = checkMonotonic(hLevels)
        expect(
          hResult.ok,
          `Habits_Page (${state}) heading order [${hLevels.join(', ')}]: ${
            hResult.ok ? '' : hResult.reason
          }`,
        ).toBe(true)
      } finally {
        habits.unmount()
      }
    }
  })
})
