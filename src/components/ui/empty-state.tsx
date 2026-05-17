import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * EmptyState primitive.
 *
 * Renders the "nothing to show yet" affordance for list surfaces. Pages
 * compose it with an optional leading `icon`, a required `title` (rendered as
 * an `<h2>` at the Type_Scale `title` step so heading order stays monotonic
 * under a PageHeader's `<h1>`), an optional `description` paragraph at the
 * `body` step in the muted on-surface role, and an `action` slot for a
 * primary CTA that focuses the create form.
 *
 * The container uses `role="status"` so assistive tech announces the empty
 * state without interrupting the user.
 */
export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center text-center gap-16 py-48 px-24',
        className,
      )}
    >
      {icon && (
        <div className="text-on-surface-muted" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-8 max-w-md">
        <h2 className="font-display text-title font-medium text-on-surface tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="text-body text-on-surface-muted">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
