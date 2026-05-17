import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSliceTask } from '@/hooks/useAi'
import { useCreateTask, useDeleteTask } from '@/hooks/useTasks'
import type { Task } from '@/shared/api/tasks.contracts'
import { cn } from '@/lib/utils'

/**
 * Task Slicer dialog.
 *
 * User clicks "Slice" on a task that feels too big. We send the title
 * to Mistral, get back 3-5 actionable sub-tasks, and let the user pick
 * which ones to actually create. Once accepted, we:
 *
 *   1. Create the selected sub-tasks (each inherits the original
 *      task's category and deadline — easy to edit later).
 *   2. Delete the original "scary" task so it doesn't double-track.
 *
 * The user can also keep the original by unchecking "Replace original".
 */
export function TaskSliceDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const slice = useSliceTask()
  const create = useCreateTask()
  const del = useDeleteTask()
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [replaceOriginal, setReplaceOriginal] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const subtasks = slice.data?.subtasks ?? []

  // Trigger the slice on open. Skip if we already have data for this
  // dialog instance (so reopening doesn't re-spend tokens).
  React.useEffect(() => {
    if (!open) return
    setError(null)
    slice.reset()
    setSelected(new Set())
    setReplaceOriginal(true)
    slice
      .mutateAsync({ title: task.title })
      .then((data) => {
        // Default: select all sub-tasks.
        setSelected(new Set(data.subtasks.map((_, i) => i)))
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not break this task down. Try again.',
        )
      })
    // We intentionally only run on open; mutation reset handles repeat opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task.title])

  function toggleSelected(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function handleCreate() {
    const picks = subtasks.filter((_, i) => selected.has(i))
    if (picks.length === 0 || create.isPending || del.isPending) return

    try {
      // Create each sub-task. Inherit category and deadline so the user's
      // calendar stays intact; they can edit later if needed.
      for (const title of picks) {
        await create.mutateAsync({
          title,
          category: task.category,
          deadline: task.deadline ?? null,
        })
      }
      if (replaceOriginal) {
        await del.mutateAsync(task.id)
      }
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to create the sub-tasks.',
      )
    }
  }

  const busy = create.isPending || del.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Break it down</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-16">
          <p className="text-body text-on-surface-muted">
            <span className="font-medium text-on-surface">{task.title}</span>
          </p>

          {slice.isPending ? (
            <p className="text-body text-on-surface-muted">Thinking…</p>
          ) : error ? (
            <p role="alert" className="text-body text-error">
              {error}
            </p>
          ) : subtasks.length === 0 ? (
            <p className="text-body text-on-surface-muted">No sub-tasks yet.</p>
          ) : (
            <ul className="flex flex-col gap-8">
              {subtasks.map((s, i) => {
                const checked = selected.has(i)
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => toggleSelected(i)}
                      className={cn(
                        'flex w-full items-center gap-12 rounded-md border border-border px-12 py-8 text-left',
                        'transition-colors duration-fast ease-standard',
                        checked
                          ? 'bg-primary-container text-on-primary-container'
                          : 'bg-surface text-on-surface hover:bg-surface-variant',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-20 w-20 shrink-0 items-center justify-center rounded border-2',
                          checked
                            ? 'border-primary bg-primary text-on-primary'
                            : 'border-border',
                        )}
                        aria-hidden="true"
                      >
                        {checked && (
                          <svg viewBox="0 0 16 16" className="h-12 w-12 fill-current">
                            <path d="M6 11.4 2.6 8 4 6.6l2 2 4-4L11.4 6Z" />
                          </svg>
                        )}
                      </span>
                      <span className="flex-1 text-body">{s}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {subtasks.length > 0 && (
            <label className="flex items-center gap-8 text-caption text-on-surface-muted">
              <input
                type="checkbox"
                checked={replaceOriginal}
                onChange={(e) => setReplaceOriginal(e.target.checked)}
              />
              Delete the original task
            </label>
          )}
        </div>

        <DialogFooter className="gap-8">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleCreate}
            disabled={selected.size === 0 || busy || slice.isPending}
            loading={busy}
          >
            Create {selected.size > 0 ? selected.size : ''} sub-task
            {selected.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
