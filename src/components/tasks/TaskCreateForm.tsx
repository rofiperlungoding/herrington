import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TagInput } from '@/components/tasks/TagInput'
import { useCreateTask } from '@/hooks/useTasks'

/**
 * Task Create Form.
 *
 * Thin controlled form wired to the optimistic `useCreateTask` mutation hook.
 * Keeps all three fields as local React state and performs the minimum
 * validation the server already enforces (Requirement 3.2): `title` and
 * `category` must be non-empty after trimming. The submit button is disabled
 * whenever that check fails or a mutation is in flight so double-submits
 * cannot re-fire the optimistic flow.
 *
 * The `<input type="datetime-local">` control returns local wall-clock time
 * in the shape `YYYY-MM-DDTHH:mm`. We hand that string to `new Date(...)`,
 * which interprets it in the browser's local timezone, then floor to unix
 * seconds to match the `tasks.deadline` column type in the Drizzle schema
 * (integer timestamp, see `src/shared/db/schema.ts`). When the field is
 * empty we send `null` to explicitly indicate "no deadline", satisfying the
 * `deadline: number | null | undefined` shape of `CreateTaskRequest`.
 *
 * On success we clear all three inputs so the form is immediately ready for
 * another entry; on failure `useCreateTask` itself surfaces a toast and rolls
 * back the optimistic cache write (Requirement 9.3, 9.4), so this component
 * deliberately does not mirror the error locally.
 *
 * Layout uses the Design_System composed field pattern (Label + Input + error
 * caption) stacked vertically with `gap-16` between fields (Requirement 8.8).
 * Submit renders as `<Button variant="primary">` (Requirement 7.2, 13.2).
 *
 * Requirements: 4.8, 7.2, 8.1, 8.2, 8.3, 8.4, 8.8, 13.2, 16.2
 */
export function TaskCreateForm() {
  const [title, setTitle] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [deadline, setDeadline] = React.useState('')
  const [tags, setTags] = React.useState<string[]>([])
  const [errors, setErrors] = React.useState<{ title?: string; category?: string }>({})

  const create = useCreateTask()

  const canSubmit =
    title.trim().length > 0 && category.trim().length > 0

  function validate(): boolean {
    const next: { title?: string; category?: string } = {}
    if (title.trim().length === 0) next.title = 'Title is required'
    if (category.trim().length === 0) next.category = 'Category is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validate() || create.isPending) return

    const deadlineSec = deadline
      ? Math.floor(new Date(deadline).getTime() / 1000)
      : undefined

    create.mutate(
      {
        title: title.trim(),
        category: category.trim(),
        deadline: deadlineSec ?? null,
        tags,
      },
      {
        onSuccess: () => {
          setTitle('')
          setCategory('')
          setDeadline('')
          setTags([])
          setErrors({})
        },
      },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-16 rounded-lg border border-border bg-surface p-24"
    >
      {/* Title field */}
      <div className="flex flex-col gap-4">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoComplete="off"
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? 'task-title-error' : undefined}
        />
        {errors.title && (
          <p id="task-title-error" className="text-caption text-error">
            {errors.title}
          </p>
        )}
      </div>

      {/* Category field */}
      <div className="flex flex-col gap-4">
        <Label htmlFor="task-category">Category</Label>
        <Input
          id="task-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
          autoComplete="off"
          aria-invalid={!!errors.category}
          aria-describedby={errors.category ? 'task-category-error' : undefined}
        />
        {errors.category && (
          <p id="task-category-error" className="text-caption text-error">
            {errors.category}
          </p>
        )}
      </div>

      {/* Deadline field (optional) */}
      <div className="flex flex-col gap-4">
        <Label htmlFor="task-deadline" optional>
          Deadline
        </Label>
        <Input
          id="task-deadline"
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>

      {/* Tags field (optional) */}
      <div className="flex flex-col gap-4">
        <Label htmlFor="task-tags" optional>
          Tags
        </Label>
        <TagInput id="task-tags" value={tags} onChange={setTags} />
      </div>

      <Button
        variant="primary"
        type="submit"
        loading={create.isPending}
        disabled={!canSubmit || create.isPending}
      >
        Create task
      </Button>
    </form>
  )
}
