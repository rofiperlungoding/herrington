import * as React from 'react'

import { ListItem } from '@/components/ui/list-item'
import { Button } from '@/components/ui/button'
import { useCheckOffHabit } from '@/hooks/useCheckOffHabit'
import { useDeleteHabit } from '@/hooks/useHabits'
import { isSameLocalDay } from '@/lib/date'
import { getUserTimezone } from '@/lib/timezone'
import type { Habit } from '@/shared/api/habits.contracts'
import { Flame, Check } from 'lucide-react'
import { HabitHeatmap } from './HabitHeatmap'

const HabitEditDialog = React.lazy(() =>
  import('./HabitEditDialog').then((m) => ({ default: m.HabitEditDialog })),
)

/**
 * Renders a single habit row (Requirements 7.1–7.6).
 *
 * Re-skinned on top of the shared `ListItem` primitive (Requirement 13.3)
 * so that `TaskItem` and `HabitItem` share identical container styling.
 *
 * Displays:
 *   - Leading: streak flame icon + current streak count badge
 *   - Title: the habit title (clickable to open the edit dialog)
 *   - Meta: current and longest streak display
 *   - Trailing: a check-off button wired to `useCheckOffHabit`
 *
 * When checked off for Local_Today, sets `tone="success"` and renders a
 * visible "Checked" label alongside a check icon (Requirements 2.7, 2.8,
 * 13.5 — color alone never conveys meaning).
 *
 * The check-off button is disabled when `lastCompletedDate` falls on the same
 * local calendar day as the current clock (Requirement 7.6). This uses
 * `isSameLocalDay` from `@/lib/date` and `getUserTimezone` from
 * `@/lib/timezone` to perform the comparison in the user's IANA timezone.
 *
 * Wrapped with `React.memo` (Requirement 9.8) so that when the parent list
 * re-renders but this item's `habit` prop is referentially equal to the
 * previous render, the component skips re-rendering entirely.
 */
export const HabitItem = React.memo(function HabitItem({
  habit,
  style,
}: {
  habit: Habit
  style?: React.CSSProperties
}) {
  const checkOff = useCheckOffHabit()
  const del = useDeleteHabit()
  const [editOpen, setEditOpen] = React.useState(false)

  const nowSeconds = Math.floor(Date.now() / 1000)
  const alreadyDoneToday =
    habit.lastCompletedDate != null &&
    isSameLocalDay(habit.lastCompletedDate, nowSeconds, getUserTimezone())

  const isOneTime = habit.kind === 'one_time'

  // Did this row mount in the "already done today" state? If so, the
  // countdown has long since elapsed in a previous session — just hide
  // the row immediately on this render and skip the animation. Otherwise
  // the user just clicked check off in this session, so play the
  // countdown + fade.
  //
  // We can't compute "seconds since the click" from `lastCompletedDate`
  // because that field is stored as midnight UTC of the user's
  // Local_Today, NOT the click instant. (See `habits.contracts.ts`.)
  const initiallyDoneRef = React.useRef(alreadyDoneToday)

  const COUNTDOWN_TOTAL = 3 // seconds

  const [secondsLeft, setSecondsLeft] = React.useState<number>(COUNTDOWN_TOTAL)
  const [fadingOut, setFadingOut] = React.useState(false)
  const [hidden, setHidden] = React.useState<boolean>(initiallyDoneRef.current)
  const deleteFiredRef = React.useRef(false)

  // Tick down once per second once the user has just checked off.
  React.useEffect(() => {
    if (!alreadyDoneToday || hidden || fadingOut) return
    if (initiallyDoneRef.current) return // already-done on mount, no animation
    if (secondsLeft <= 0) {
      setFadingOut(true)
      return
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [alreadyDoneToday, secondsLeft, fadingOut, hidden])

  // After fade-out:
  //   - daily habit → hide locally; row reappears tomorrow on its own.
  //   - one-time habit → DELETE from DB so it never comes back.
  React.useEffect(() => {
    if (!fadingOut) return
    const t = window.setTimeout(() => {
      setHidden(true)
      if (isOneTime && !deleteFiredRef.current) {
        deleteFiredRef.current = true
        del.mutate(habit.id)
      }
    }, 500)
    return () => window.clearTimeout(t)
  }, [fadingOut, isOneTime, habit.id, del])

  // For one-time habits that mount already-done, fire the delete once.
  React.useEffect(() => {
    if (
      initiallyDoneRef.current &&
      isOneTime &&
      !deleteFiredRef.current &&
      hidden
    ) {
      deleteFiredRef.current = true
      del.mutate(habit.id)
    }
  }, [hidden, isOneTime, habit.id, del])

  if (hidden) return null

  return (
    <>
      <div
        className="transition-all duration-500 ease-out"
        style={{
          ...style,
          opacity: fadingOut ? 0 : 1,
          transform: fadingOut ? 'translateX(20px)' : 'translateX(0)',
          maxHeight: fadingOut ? '0px' : '400px',
          overflow: fadingOut ? 'hidden' : 'visible',
          marginBottom: fadingOut ? '0px' : undefined,
        }}
      >
        <ListItem
          tone={alreadyDoneToday ? 'success' : 'default'}
          leading={
            isOneTime ? (
              <Check className="h-20 w-20" aria-hidden="true" />
            ) : (
              <span className="flex items-center gap-4">
                <Flame className="h-20 w-20" aria-hidden="true" />
                <span className="text-label font-medium">{habit.currentStreak}</span>
              </span>
            )
          }
          title={
            <span
              className="cursor-pointer"
              onClick={() => setEditOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setEditOpen(true)
              }}
            >
              {habit.title}
            </span>
          }
          meta={
            alreadyDoneToday ? (
              <span className="flex items-center gap-4">
                <Check className="h-12 w-12" aria-hidden="true" />
                <span>Done</span>
                {!isOneTime && (
                  <>
                    <span className="mx-4">·</span>
                    <span>Streak {habit.currentStreak}</span>
                  </>
                )}
                {!fadingOut && secondsLeft > 0 && (
                  <>
                    <span className="mx-4">·</span>
                    <span className="text-on-surface-muted">
                      {isOneTime
                        ? `deleting in ${secondsLeft}s`
                        : `clearing in ${secondsLeft}s`}
                    </span>
                  </>
                )}
              </span>
            ) : isOneTime ? (
              <span className="text-on-surface-muted">One-time goal</span>
            ) : (
              <span>Current: {habit.currentStreak} · Best: {habit.longestStreak}</span>
            )
          }
          trailing={
            <Button
              size="sm"
              variant="secondary"
              disabled={alreadyDoneToday || checkOff.isPending}
              onClick={() => checkOff.mutate({ id: habit.id })}
              aria-label={alreadyDoneToday ? 'Already done' : `Check off ${habit.title}`}
            >
              {alreadyDoneToday ? 'Done' : 'Check off'}
            </Button>
          }
        />
        {/* Heatmap only for daily habits and only while the row is visible
            (not while fading out, to avoid layout fights with the height
            collapse). One-time goals don't get a heatmap — there's only
            ever one completion. */}
        {!isOneTime && !fadingOut && (
          <div className="mt-8 px-16">
            <HabitHeatmap habitId={habit.id} />
          </div>
        )}
      </div>
      {editOpen && (
        <React.Suspense fallback={null}>
          <HabitEditDialog
            habit={habit}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
        </React.Suspense>
      )}
    </>
  )
})
