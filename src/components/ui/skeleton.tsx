import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * `Skeleton` — decorative placeholder primitive.
 *
 * Renders a rounded block tinted with the `surface-variant` role token and a
 * motion-safe pulse. `aria-hidden="true"` hides the element from assistive
 * technology because it conveys no content — announcing loading state is the
 * job of the region's `aria-live` or `aria-busy` attribute on the parent
 * list/container, not of each individual placeholder (Requirements 10.1,
 * 10.7).
 *
 * The pulse animates opacity only (Tailwind's `animate-pulse`) so it never
 * forces layout and it is automatically suppressed under
 * `prefers-reduced-motion: reduce` via the `motion-safe:` variant
 * (Requirements 6.5, 6.6).
 *
 * Callers size the block through `className` (e.g. `h-16 w-48`). Dimension
 * utilities use the token-backed spacing scale, so all skeletons resolve
 * through `tokens.spacing` (Requirement 14.4).
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md bg-surface-variant motion-safe:animate-pulse',
        className,
      )}
      {...props}
    />
  )
}

/**
 * `TaskItemSkeleton` — dimension-matched placeholder for one `TaskItem` row.
 *
 * The outer `<li>` copies the real `ListItem` container (flex row, `gap-16`,
 * `p-16`, `rounded-lg`, `border border-border`) so each placeholder occupies
 * the same bounding box as the row that will replace it. When real data
 * arrives the replacement produces only intra-item reflow, never
 * item-boundary reflow — the CLS budget (Requirement 14.3) is protected by
 * construction.
 *
 * Hover/shadow/background transitions are deliberately omitted because the
 * skeleton is non-interactive (Requirement 14.3).
 *
 * Row composition mirrors `TaskItem`:
 *   - leading checkbox glyph        → 20×20 rounded-sm
 *   - title line (body text step)   → h-16, ~48px wide
 *   - meta line (caption text step) → h-12, ~32px wide
 */
export function TaskItemSkeleton() {
  return (
    <li className="flex items-center gap-16 p-16 rounded-lg border border-border">
      <Skeleton className="h-20 w-20 rounded-sm" />
      <div className="flex-1 flex flex-col gap-4">
        <Skeleton className="h-16 w-48" />
        <Skeleton className="h-12 w-32" />
      </div>
    </li>
  )
}

/**
 * `HabitItemSkeleton` — dimension-matched placeholder for one `HabitItem` row.
 *
 * Structure mirrors `HabitItem`:
 *   - leading streak-flame badge    → 20×20 pill-shaped disc
 *   - title line (body text step)   → h-16, ~48px wide
 *   - meta pair (current / longest  → two h-12 runs of ~24px, separated by a
 *     streak captions)                gap, matching the "🔥 N · Best: M"
 *                                     inline caption the real component
 *                                     renders (Requirement 13.3).
 *
 * As with `TaskItemSkeleton`, the outer `<li>` matches the `ListItem`
 * container exactly so placeholder → real-data transitions produce no
 * inter-item CLS (Requirements 10.7, 14.3).
 */
export function HabitItemSkeleton() {
  return (
    <li className="flex items-center gap-16 p-16 rounded-lg border border-border">
      <Skeleton className="h-20 w-20 rounded-full" />
      <div className="flex-1 flex flex-col gap-4">
        <Skeleton className="h-16 w-48" />
        <div className="flex items-center gap-8">
          <Skeleton className="h-12 w-24" />
          <Skeleton className="h-12 w-24" />
        </div>
      </div>
    </li>
  )
}
