import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * PageHeader primitive.
 *
 * Editorial header used at the top of every primary route. Layout:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ EYEBROW                          [action] │   ← uppercase tracked-out caption
 *   │ Title                                     │   ← Fraunces display
 *   │ Description                               │   ← Inter body, muted
 *   └──────────────────────────────────────────┘
 *
 * The `eyebrow` slot is the small uppercase caption that sits above the
 * `<h1>` and acts as the page's category label ("Today", "This week",
 * "Settings"). It uses `tracking-wider` and the `caption` step from the
 * type scale so it reads as orientation, not chrome.
 *
 * The `<h1>` itself is set in `font-display` (Fraunces) at the
 * `headline → display` responsive step. Fraunces is the brand's display
 * face — using it on every page H1 is the single change that ties all
 * routes back to the brand without touching the rest of the UI.
 *
 * The `action` slot stays on the right side at md+, dropping below the
 * title block on mobile so it doesn't fight for the same horizontal axis.
 */
export interface PageHeaderProps {
  /** Required H1 title — rendered in Fraunces. */
  title: string
  /** Small uppercase caption above the title (e.g. "Today", "This week"). */
  eyebrow?: string
  /** Optional supporting paragraph below the title. */
  description?: string
  /** Right-aligned action slot — typically a `<Button>`. */
  action?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  eyebrow,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('flex flex-col gap-8', className)}
    >
      {(eyebrow || action) && (
        <div className="flex items-center justify-between gap-12 min-h-24">
          {eyebrow ? (
            <p className="text-caption uppercase tracking-wider text-on-surface-muted">
              {eyebrow}
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      <h1 className="font-display font-medium text-on-surface tracking-tight text-headline leading-[1.15] md:text-display md:leading-[1.05]">
        {title}
      </h1>
      {description && (
        <p className="text-body text-on-surface-muted">{description}</p>
      )}
    </header>
  )
}
