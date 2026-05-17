import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Tone that lets the caller lift error/success semantics into the container
 * while still owning the non-color affordance (icon, label) that actually
 * conveys the meaning. Color alone never carries state — see Requirements
 * 2.7, 2.8, 13.4, 13.5.
 */
export type ListItemTone = 'default' | 'error' | 'success'

/**
 * Props for the shared `ListItem` primitive used by both `TaskItem` and
 * `HabitItem`. The primitive owns padding, radius, elevation, and hover
 * treatment so both surfaces look like siblings from the same product
 * (Requirement 13.3). Per-feature affordances (checkbox, streak badge,
 * deadline, overflow menu) live in the caller via `leading`, `meta`, and
 * `trailing` slots.
 */
export interface ListItemProps extends Omit<React.HTMLAttributes<HTMLLIElement>, 'title'> {
  /** Checkbox, streak flame, or any icon rendered at the start of the row. */
  leading?: React.ReactNode
  /** Heading text for the row (Type_Scale `body` unless it's a section). */
  title: React.ReactNode
  /** Supporting info — deadline, streak counts, etc. — in `caption` step. */
  meta?: React.ReactNode
  /** Overflow menu, check-off button, or any action at the end of the row. */
  trailing?: React.ReactNode
  /** Semantic tone. Caller must pair non-default tones with text/icon. */
  tone?: ListItemTone
  className?: string
}

/**
 * Shared list-item primitive.
 *
 * Renders an `<li>` with the resting card treatment — `rounded-lg` (Req 4.5),
 * `bg-surface`, `shadow-e0` + `border border-border` (Req 5.5, and Req 5.7's
 * "elevation above 1 never coexists with a border" invariant), and a
 * `background-color`/`box-shadow` transition tuned to `duration-fast` with
 * `ease-standard` (Req 6.2, 6.7). Hover shifts the background to
 * `surface-variant` without disturbing layout (Req 6.6).
 *
 * The `data-tone` attribute surfaces error/success coloring on the text layer
 * via `data-[tone='error']:text-error` and `data-[tone='success']:text-success`
 * utilities. Because color is only a secondary affordance, callers pass an
 * icon + text label alongside the tone so meaning still reaches users who
 * can't perceive the hue (Requirements 2.7, 2.8, 13.4, 13.5).
 */
export const ListItem = React.forwardRef<HTMLLIElement, ListItemProps>(
  (
    { leading, title, meta, trailing, tone = 'default', className, ...props },
    ref,
  ) => (
    <li
      ref={ref}
      data-tone={tone}
      className={cn(
        'flex items-center gap-16 p-16',
        'rounded-lg bg-surface',
        'shadow-e0 border border-border',
        'transition-[background-color,box-shadow] duration-fast ease-standard',
        'hover:bg-surface-variant',
        "data-[tone='error']:text-error data-[tone='success']:text-success",
        className,
      )}
      {...props}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="text-body text-on-surface truncate">{title}</div>
        {meta && <div className="text-caption text-on-surface-muted">{meta}</div>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </li>
  ),
)
ListItem.displayName = 'ListItem'
