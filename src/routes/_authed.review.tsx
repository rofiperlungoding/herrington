import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Calendar, CheckSquare, Flame, Tag, Timer } from 'lucide-react'

import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Chip } from '@/components/tasks/TagInput'
import { reviewQueryOptions, useReview, type ReviewData } from '@/hooks/useReview'
import { formatDurationShort } from '@/hooks/usePomodoro'
import { cn } from '@/lib/utils'

/**
 * Weekly Review page (`/review`).
 *
 * Bento layout with five tiles:
 *   1. Hero — "you finished X of Y" with the headline number.
 *   2. Habits — completion rate + most-skipped row.
 *   3. Focus — total minutes + top focus tasks.
 *   4. Tag breakdown — chips sized by frequency.
 *   5. Reschedule offenders — top 3 tasks pushed forward most often.
 *
 * Empty-state fallback when nothing happened this week ("you took a
 * week off — that's also okay").
 */

export const Route = createFileRoute('/_authed/review')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(reviewQueryOptions).catch(() => undefined),
  component: ReviewPage,
})

function ReviewPage() {
  const review = useReview()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-32 p-24 md:p-32">
      <PageHeader
        eyebrow="Last 7 days"
        title="Weekly review"
        description="What you did, what slipped, where the time went."
      />

      {review.isPending && !review.data ? (
        <LoadingTiles />
      ) : review.isError ? (
        <ErrorState
          icon={null}
          title="Couldn't load this week"
          description="Something didn't go through. Mind trying again?"
        />
      ) : review.data ? (
        <ReviewContent data={review.data} />
      ) : (
        <EmptyState
          icon={null}
          title="Nothing to review yet"
          description="Get a few tasks and habits going, then come back."
        />
      )}
    </div>
  )
}

// ─── Composition ────────────────────────────────────────────────────────────

function ReviewContent({ data }: { data: ReviewData }) {
  const { tasks, habits, focus } = data

  const isEmpty =
    tasks.createdThisWeek === 0 &&
    habits.totalCheckoffs === 0 &&
    focus.sessionCount === 0

  if (isEmpty) {
    return (
      <EmptyState
        icon={<Calendar className="h-32 w-32" />}
        title="A quiet week"
        description="No tasks, habits, or focus sessions logged in the last 7 days. That's okay too."
      />
    )
  }

  return (
    <div className="anim-stagger grid grid-cols-1 gap-16 md:grid-cols-3">
      {/* Hero — tasks completion */}
      <Tile
        className="md:col-span-2"
        eyebrow="Tasks"
        title={
          tasks.completionRate != null
            ? `${Math.round(tasks.completionRate * 100)}% finished`
            : 'No new tasks'
        }
        body={
          tasks.completionRate != null
            ? `You closed out ${tasks.completedThisWeek} of ${tasks.createdThisWeek} tasks created this week.`
            : 'Add some tasks and complete them to see your rate.'
        }
        accent={<CheckSquare className="h-20 w-20" aria-hidden="true" />}
      >
        {tasks.totalReschedules > 0 && (
          <p className="text-caption text-on-surface-muted">
            {tasks.totalReschedules} push{tasks.totalReschedules === 1 ? '' : 'es'}
            {' '}forward across all tasks.
          </p>
        )}
      </Tile>

      {/* Focus minutes */}
      <Tile
        eyebrow="Focus"
        title={
          focus.totalSec >= 60
            ? formatDurationShort(focus.totalSec)
            : '—'
        }
        body={
          focus.sessionCount > 0
            ? `${focus.sessionCount} session${focus.sessionCount === 1 ? '' : 's'} logged.`
            : 'Start a Pomodoro from any task to track focus time.'
        }
        accent={<Timer className="h-20 w-20" aria-hidden="true" />}
      >
        {focus.topTasks.length > 0 && (
          <ul className="flex flex-col gap-4">
            {focus.topTasks.map((t) => (
              <li
                key={t.taskId}
                className="flex items-center justify-between gap-8 text-caption"
              >
                <span className="truncate text-on-surface">{t.title}</span>
                <span className="shrink-0 tabular-nums text-on-surface-muted">
                  {formatDurationShort(t.seconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tile>

      {/* Habits */}
      <Tile
        eyebrow="Habits"
        title={
          habits.completionRate != null
            ? `${Math.round(habits.completionRate * 100)}% kept`
            : 'No daily habits'
        }
        body={
          habits.completionRate != null
            ? `${habits.totalCheckoffs} of ${habits.totalPossible} possible check-offs.`
            : 'Add a daily habit and start a streak.'
        }
        accent={<Flame className="h-20 w-20" aria-hidden="true" />}
      >
        {habits.mostSkipped && (
          <p className="text-caption text-on-surface-muted">
            <span className="text-on-surface">{habits.mostSkipped.title}</span>
            {' '}was missed{' '}
            {habits.mostSkipped.possible - habits.mostSkipped.checkoffs}{' '}
            day{habits.mostSkipped.possible - habits.mostSkipped.checkoffs === 1 ? '' : 's'}.
          </p>
        )}
      </Tile>

      {/* Tag breakdown */}
      <Tile
        className="md:col-span-2"
        eyebrow="By tag"
        title={
          tasks.tagBreakdown.length > 0
            ? `${tasks.tagBreakdown.length} tag${tasks.tagBreakdown.length === 1 ? '' : 's'} touched`
            : 'No tags yet'
        }
        body={
          tasks.tagBreakdown.length > 0
            ? 'Where this week went by category.'
            : 'Tag your tasks to see how time clusters.'
        }
        accent={<Tag className="h-20 w-20" aria-hidden="true" />}
      >
        {tasks.tagBreakdown.length > 0 && (
          <div className="flex flex-wrap gap-8">
            {tasks.tagBreakdown.map((entry) => (
              <Chip
                key={entry.tag}
                label={`${entry.tag} · ${entry.count}`}
              />
            ))}
          </div>
        )}
      </Tile>

      {/* Reschedule offenders */}
      {tasks.topReschedules.length > 0 && (
        <Tile
          eyebrow="Pushed most"
          title={`${tasks.topReschedules[0].count}× moved`}
          body="Tasks you keep punting forward."
          accent={<Calendar className="h-20 w-20" aria-hidden="true" />}
        >
          <ul className="flex flex-col gap-4">
            {tasks.topReschedules.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-8 text-caption"
              >
                <span className="truncate text-on-surface">{t.title}</span>
                <span className="shrink-0 tabular-nums text-on-surface-muted">
                  ×{t.count}
                </span>
              </li>
            ))}
          </ul>
        </Tile>
      )}
    </div>
  )
}

// ─── Building blocks ────────────────────────────────────────────────────────

function Tile({
  eyebrow,
  title,
  body,
  accent,
  className,
  children,
}: {
  eyebrow: string
  title: string
  body: string
  accent?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-12 rounded-lg border border-border bg-surface p-20',
        className,
      )}
    >
      <div className="flex items-center gap-8">
        {accent && <span className="text-on-surface-muted">{accent}</span>}
        <p className="text-caption uppercase tracking-wider text-on-surface-muted">
          {eyebrow}
        </p>
      </div>
      <p className="text-headline font-semibold tracking-tight tabular-nums text-on-surface">
        {title}
      </p>
      <p className="text-body text-on-surface-muted">{body}</p>
      {children && <div className="flex flex-col gap-8 pt-4">{children}</div>}
    </section>
  )
}

function LoadingTiles() {
  return (
    <div className="grid grid-cols-1 gap-16 md:grid-cols-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex flex-col gap-12 rounded-lg border border-border bg-surface p-20',
            i === 0 && 'md:col-span-2',
          )}
        >
          <Skeleton className="h-12 w-[80px]" />
          <Skeleton className="h-32 w-[60%]" />
          <Skeleton className="h-12 w-[80%]" />
        </div>
      ))}
    </div>
  )
}
