import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Plus, Flame, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { HabitItemSkeleton } from '@/components/ui/skeleton'
import { HabitCreateForm } from '@/components/habits/HabitCreateForm'
import { HabitItem } from '@/components/habits/HabitItem'
import { useHabits, habitsListQueryOptions } from '@/hooks/useHabits'

/**
 * Habit Tracker page (`/habits`).
 *
 * File-based child of the `_authed` layout route, so the Supabase sign-in
 * guard in `_authed.tsx` runs before this component mounts and the
 * shared `<AppShell>` (Sidebar on >= 768px, BottomNav below) wraps the
 * rendered output.
 *
 * Re-skinned to use Design_System primitives: `PageHeader`, `EmptyState`,
 * `ErrorState`, and `HabitItemSkeleton`. Mirrors the Tasks_Page structure
 * for cross-page consistency (Requirement 13.1).
 *
 * Streak display behavior and Local_Today semantics are preserved — those
 * live in `HabitItem` and `useCheckOffHabit`, untouched by this re-skin.
 */
export const Route = createFileRoute('/_authed/habits')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(habitsListQueryOptions).catch(() => {
      // Allow the component to mount and render <ErrorState> via query.isError
      // rather than crashing the route error boundary (EH2 path).
    }),
  component: HabitsPage,
})

function HabitsPage() {
  const query = useHabits()
  const formRef = React.useRef<HTMLDivElement>(null)

  /** Focus the create form input when the header action or empty-state CTA is clicked. */
  const focusCreateForm = React.useCallback(() => {
    const input = formRef.current?.querySelector('input')
    input?.focus()
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-24 p-24 md:p-32">
      <PageHeader
        eyebrow="Daily rituals"
        title="Habits"
        description={
          query.data?.habits.length
            ? `${query.data.habits.length} active · tended to day by day`
            : 'Small things, kept up. Check off each day to grow the streak.'
        }
        action={
          <Button variant="text" size="sm" onClick={focusCreateForm}>
            <Plus className="h-16 w-16" aria-hidden="true" />
            New habit
          </Button>
        }
      />

      <div ref={formRef}>
        <HabitCreateForm />
      </div>

      {query.isPending && (
        <ul
          className="flex flex-col gap-8"
          aria-busy="true"
          aria-label="Loading habits"
        >
          <HabitItemSkeleton />
          <HabitItemSkeleton />
          <HabitItemSkeleton />
        </ul>
      )}

      {query.isError && (
        <ErrorState
          icon={<AlertCircle className="h-32 w-32" />}
          title="Couldn't load your habits"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Something didn't go through. Mind trying again?"
          }
          action={
            <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {query.data && query.data.habits.length === 0 && (
        <EmptyState
          icon={<Flame className="h-32 w-32" />}
          title="No habits yet"
          description="The smallest one tomorrow morning is the right place to start."
          action={
            <Button variant="primary" size="sm" onClick={focusCreateForm}>
              <Plus className="h-16 w-16" aria-hidden="true" />
              Create a habit
            </Button>
          }
        />
      )}

      {query.data && query.data.habits.length > 0 && (
        <div
          className="anim-stagger flex flex-col gap-8"
          role="list"
          aria-label="Habits"
        >
          {query.data.habits.map((habit, i) => (
            <HabitItem
              key={habit.id}
              habit={habit}
              style={{ ['--anim-i' as string]: i }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
