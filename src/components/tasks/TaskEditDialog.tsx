import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TagInput } from '@/components/tasks/TagInput'
import { useDeleteTask, useUpdateTask } from '@/hooks/useTasks'
import type { Task } from '@/shared/api/tasks.contracts'

/**
 * Convert a unix-seconds deadline to the `YYYY-MM-DDTHH:mm` format that the
 * native `<input type="datetime-local">` control understands.
 *
 * The `<input type="datetime-local">` control renders and parses values in
 * the *browser's* local timezone without any offset suffix. To round-trip a
 * deadline we must therefore re-project the stored UTC instant back into
 * local wall-clock components. `new Date(unix*1000)` gives us that UTC
 * instant; the `getX` accessors then return the local calendar fields,
 * which is exactly what the control expects. A missing deadline (`null` or
 * `undefined`) maps to an empty string so the control shows as unset,
 * mirroring `TaskCreateForm`'s own "no deadline" semantics.
 */
function unixToDatetimeLocal(unixSec: number | null | undefined): string {
  if (unixSec == null) return ''
  const d = new Date(unixSec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

/**
 * Task Edit Dialog.
 *
 * Controlled Dialog for editing a single task's `title`, `category`, and
 * `deadline`, and for deleting the task. The parent owns `open` state and
 * supplies both the `task` snapshot and `onOpenChange` callback, which keeps
 * this component a pure UI shell over the optimistic `useUpdateTask` and
 * `useDeleteTask` mutation hooks (Requirement 9.3, 9.4).
 *
 * Field initialisation is synced to the `open` transition rather than to
 * the `task` prop on every render: if the user edits a field and the parent
 * rerenders with the same task reference, we don't want local state to be
 * clobbered. Re-opening the dialog re-seeds from the current `task` so stale
 * edits from a previously-cancelled session don't leak into a fresh open.
 *
 * On save, the deadline string is converted back to unix seconds in the
 * browser's local timezone (matching `TaskCreateForm`), and the dialog is
 * closed via `onOpenChange(false)` in the mutation's `onSuccess` so the
 * cache-level optimistic update in `useUpdateTask` owns the visible state.
 * On delete, we gate with `window.confirm` before firing the mutation so
 * accidental taps can't destroy data.
 *
 * Requirements: 5.6, 5.7, 6.3, 11.4, 16.1
 */
export function TaskEditDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = React.useState(task.title)
  const [category, setCategory] = React.useState(task.category)
  const [deadline, setDeadline] = React.useState(
    unixToDatetimeLocal(task.deadline),
  )
  const [tags, setTags] = React.useState<string[]>(task.tags)

  const update = useUpdateTask()
  const del = useDeleteTask()
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTitle(task.title)
      setCategory(task.category)
      setDeadline(unixToDatetimeLocal(task.deadline))
      setTags(task.tags)
      setConfirmingDelete(false)
    }
  }, [open, task])

  const canSubmit =
    title.trim().length > 0 && category.trim().length > 0

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || update.isPending) return

    const updates = {
      title: title.trim(),
      category: category.trim(),
      deadline: deadline
        ? Math.floor(new Date(deadline).getTime() / 1000)
        : null,
      tags,
    }

    update.mutate(
      { id: task.id, updates },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
      },
    )
  }

  function handleDelete() {
    if (del.isPending) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    del.mutate(task.id, {
      onSuccess: () => {
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="flex flex-col gap-16">
          <div className="flex flex-col gap-4">
            <Label htmlFor="edit-task-title">Title</Label>
            <Input
              id="edit-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-4">
            <Label htmlFor="edit-task-category">Category</Label>
            <Input
              id="edit-task-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-4">
            <Label htmlFor="edit-task-deadline">Deadline (optional)</Label>
            <Input
              id="edit-task-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-4">
            <Label htmlFor="edit-task-tags">Tags (optional)</Label>
            <TagInput id="edit-task-tags" value={tags} onChange={setTags} />
          </div>

          <DialogFooter className="gap-8">
            {confirmingDelete ? (
              <>
                <span className="text-body text-on-surface-muted mr-auto">
                  Are you sure?
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingDelete(false)}
                >
                  No, keep it
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={del.isPending}
                  loading={del.isPending}
                >
                  Yes, delete
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={del.isPending}
                  loading={del.isPending}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!canSubmit || update.isPending}
                  loading={update.isPending}
                >
                  Save
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
