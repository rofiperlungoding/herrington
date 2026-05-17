import * as React from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToggleTaskCompletion } from '@/hooks/useToggleTaskCompletion'
import { formatLocal } from '@/lib/date'
import type { Task } from '@/shared/api/tasks.contracts'
import { cn } from '@/lib/utils'

/**
 * Zen Mode — "The One Thing".
 *
 * Hides the entire task list and shows a single focus task centered on
 * the screen. Reduces overwhelm and gives the user permission to ignore
 * everything else.
 *
 * Picks the most urgent incomplete task automatically:
 *   1. First overdue task (smallest deadline that's already past).
 *   2. Next upcoming task (smallest future deadline).
 *   3. Newest task without a deadline.
 *
 * Completing the task in Zen Mode auto-cycles to the next one. If the
 * list is exhausted, shows a calm "all clear" state.
 */
export function ZenMode({
  tasks,
  onClose,
}: {
  tasks: Task[]
  onClose: () => void
}) {
  const toggle = useToggleTaskCompletion()
  const focus = pickFocus(tasks)

  // Esc closes Zen Mode.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface px-24 py-32">
      <Button
        variant="text"
        size="icon"
        onClick={onClose}
        aria-label="Exit zen mode"
        className="absolute right-24 top-24"
      >
        <X className="h-20 w-20" aria-hidden="true" />
      </Button>

      <div className="flex w-full max-w-md flex-col items-center gap-32 text-center">
        {focus ? (
          <>
            <p className="text-caption uppercase tracking-wide text-on-surface-muted">
              Just this one
            </p>
            <div className="flex w-full flex-col items-center gap-16">
              <h1 className="text-display font-medium text-on-surface">
                {focus.title}
              </h1>
              {focus.deadline != null && (
                <p className="text-body text-on-surface-muted">
                  <time>{formatLocal(focus.deadline)}</time>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                toggle.mutate({ id: focus.id, isCompleted: !focus.isCompleted })
              }
              disabled={toggle.isPending}
              className={cn(
                'inline-flex h-48 items-center gap-12 rounded-pill border-2 border-primary px-32',
                'text-label font-medium text-primary',
                'transition-[background-color,color] duration-fast ease-standard',
                'hover:bg-primary hover:text-on-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
                toggle.isPending && 'opacity-60',
              )}
            >
              <Checkbox
                checked={focus.isCompleted}
                onCheckedChange={() => {
                  /* button click handles it */
                }}
                aria-hidden="true"
                tabIndex={-1}
              />
              <span>Done</span>
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-16">
            <h1 className="text-display font-medium text-on-surface">
              All clear.
            </h1>
            <p className="text-body text-on-surface-muted">
              Nothing pending. Take a breath.
            </p>
            <Button variant="secondary" onClick={onClose}>
              Exit zen mode
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Pick the single most-urgent incomplete task to focus on.
 */
function pickFocus(tasks: Task[]): Task | null {
  const incomplete = tasks.filter((t) => !t.isCompleted)
  if (incomplete.length === 0) return null

  const nowSec = Math.floor(Date.now() / 1000)

  const overdue = incomplete
    .filter((t) => t.deadline != null && t.deadline < nowSec)
    .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0))
  if (overdue[0]) return overdue[0]

  const upcoming = incomplete
    .filter((t) => t.deadline != null && t.deadline >= nowSec)
    .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))
  if (upcoming[0]) return upcoming[0]

  // No deadlines anywhere — newest task wins.
  return [...incomplete].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}
