import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * ErrorState primitive.
 *
 * Renders the failure affordance for list surfaces when a query fails. Pages
 * compose it with an optional leading `icon` (tinted with the error role so
 * the tone reads even in grayscale, per Req 2.8/13.5), a required `title`
 * rendered as an `<h2>` at the `title` step, an optional `description` at
 * the `body` step in the muted on-surface role, and an `action` slot that
 * callers wire to a secondary `<Button>` invoking `refetch`.
 *
 * Uses `role="alert"` so assistive tech announces the failure immediately
 * on insertion into the DOM. Icon tinting is paired with the heading text —
 * the state never relies on color alone to convey its meaning.
 */
export interface ErrorStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function ErrorState({
  icon,
  title,
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center gap-16 py-48 px-24',
        className,
      )}
    >
      {icon && (
        <div className="text-error" aria-hidden="true">
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
