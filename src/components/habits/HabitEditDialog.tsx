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
import { useDeleteHabit, useUpdateHabit } from '@/hooks/useHabits'
import type { Habit } from '@/shared/api/habits.contracts'

/**
 * Habit Edit Dialog.
 *
 * Controlled Dialog for renaming or deleting a habit. The parent owns `open`
 * state and supplies both the `habit` snapshot and `onOpenChange` callback,
 * keeping this component a pure UI shell over the optimistic `useUpdateHabit`
 * and `useDeleteHabit` mutation hooks (Requirement 9.3, 9.4).
 *
 * Field initialisation is synced to the `open` transition rather than to the
 * `habit` prop on every render: re-opening the dialog re-seeds from the
 * current `habit` so stale edits from a previously-cancelled session don't
 * leak into a fresh open.
 *
 * On delete, we gate with `window.confirm` before firing the mutation so
 * accidental taps can't destroy data.
 *
 * Requirements: 5.6, 5.7, 6.3, 11.4, 16.1
 */
export function HabitEditDialog({
  habit,
  open,
  onOpenChange,
}: {
  habit: Habit
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = React.useState(habit.title)

  const update = useUpdateHabit()
  const del = useDeleteHabit()
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTitle(habit.title)
      setConfirmingDelete(false)
    }
  }, [open, habit])

  const canSubmit = title.trim().length > 0

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || update.isPending) return

    update.mutate(
      { id: habit.id, updates: { title: title.trim() } },
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
    del.mutate(habit.id, {
      onSuccess: () => {
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Habit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="flex flex-col gap-16">
          <div className="flex flex-col gap-4">
            <Label htmlFor="edit-habit-title">Title</Label>
            <Input
              id="edit-habit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoComplete="off"
            />
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
