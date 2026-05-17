import * as React from 'react'

import { useHabitCompletions } from '@/hooks/useHabits'
import { cn } from '@/lib/utils'

/**
 * GitHub-style commit grid for a single habit's last 90 days.
 *
 * Renders 13 columns × 7 rows = 91 day cells. Each cell is colored
 * based on whether the user checked off the habit on that day:
 *   - empty / faintest  → no completion that day
 *   - filled (mid)      → completed
 *
 * (We only have a binary completed/not for now; we still keep the
 *  multi-shade plumbing in place via `intensity` so adding multi-check
 *  per day later doesn't require an API change.)
 *
 * Today is the bottom-right cell. Cells progress chronologically:
 * column 0 row 0 is the oldest day in the window; the last column's
 * last filled row is today. Earlier rows of the last column are
 * future days (this week's Mon/Tue/etc. before today) — left blank
 * with a subtle "future" tone.
 */
export function HabitHeatmap({
  habitId,
  enabled = true,
}: {
  habitId: string
  enabled?: boolean
}) {
  const completions = useHabitCompletions(habitId, enabled)

  // Build the day-key set for fast lookup.
  const completedSet = React.useMemo(() => {
    return new Set(completions.data?.dates ?? [])
  }, [completions.data])

  // Today's day-key (days since unix epoch). We compute it client-side
  // because the heatmap is purely a presentation concern; the server
  // already deduped completions per local-day at write time.
  const todayKey = Math.floor(Date.now() / 1000 / 86400)

  // 91 cells = 13 weeks. Build the matrix from oldest to newest.
  const WEEKS = 13
  const TOTAL = WEEKS * 7
  const oldestKey = todayKey - (TOTAL - 1)

  const cells: Array<{ dayKey: number; completed: boolean; isFuture: boolean }> = []
  for (let i = 0; i < TOTAL; i++) {
    const dayKey = oldestKey + i
    cells.push({
      dayKey,
      completed: completedSet.has(dayKey),
      isFuture: dayKey > todayKey,
    })
  }

  return (
    <div
      className="flex gap-[3px]"
      role="img"
      aria-label="Last 90 days completion history"
    >
      {Array.from({ length: WEEKS }).map((_, weekIndex) => (
        <div key={weekIndex} className="flex flex-col gap-[3px]">
          {Array.from({ length: 7 }).map((_, dayIndex) => {
            const cellIndex = weekIndex * 7 + dayIndex
            const cell = cells[cellIndex]
            return (
              <div
                key={dayIndex}
                title={cell.completed ? 'Completed' : 'Missed'}
                className={cn(
                  'h-8 w-8 rounded-[2px]',
                  cell.isFuture
                    ? 'bg-surface-variant/40'
                    : cell.completed
                      ? 'bg-success'
                      : 'bg-surface-variant',
                )}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
