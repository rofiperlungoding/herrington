import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateHabit } from '@/hooks/useHabits'

/**
 * Habit Create Form.
 *
 * Thin controlled form wired to the optimistic `useCreateHabit` mutation hook.
 * Only a single `title` field is required (Requirement 6.2): the value must be
 * non-empty after trimming. The submit button is disabled whenever that check
 * fails or a mutation is in flight so double-submits cannot re-fire the
 * optimistic flow.
 *
 * Layout mirrors the Tasks form spacing and Label/Input composition so the two
 * pages look like siblings (Requirements 4.8, 7.2, 8.1, 8.2, 8.8, 13.2, 16.2).
 *
 * On success we clear the input so the form is immediately ready for another
 * entry; on failure `useCreateHabit` itself surfaces a toast and rolls back
 * the optimistic cache write (Requirement 9.3, 9.4).
 */
export function HabitCreateForm() {
  const [title, setTitle] = React.useState('')
  const [kind, setKind] = React.useState<'daily' | 'one_time'>('daily')
  const [touched, setTouched] = React.useState(false)
  const create = useCreateHabit()

  const canSubmit = title.trim().length > 0
  const showError = touched && !canSubmit

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched(true)
    if (!canSubmit || create.isPending) return

    create.mutate(
      { title: title.trim(), kind },
      {
        onSuccess: () => {
          setTitle('')
          setKind('daily')
          setTouched(false)
        },
      },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-16 rounded-md border border-border p-24"
    >
      <div className="flex flex-col gap-4">
        <Label htmlFor="habit-title">Title</Label>
        <Input
          id="habit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Meditate 10 minutes"
          required
          autoComplete="off"
          aria-describedby={showError ? 'habit-title-error' : undefined}
          aria-invalid={showError || undefined}
        />
        {showError && (
          <p id="habit-title-error" className="text-caption text-error">
            Title is required.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-8">
        <legend className="text-label font-medium text-on-surface">Type</legend>
        <div className="flex gap-8">
          <KindOption
            value="daily"
            current={kind}
            label="Daily"
            description="Recurring tracker. Resets every day."
            onSelect={setKind}
          />
          <KindOption
            value="one_time"
            current={kind}
            label="One-time"
            description="Single goal. Disappears once done."
            onSelect={setKind}
          />
        </div>
      </fieldset>

      <Button
        variant="primary"
        type="submit"
        loading={create.isPending}
        disabled={!canSubmit || create.isPending}
      >
        Create habit
      </Button>
    </form>
  )
}

function KindOption({
  value,
  current,
  label,
  description,
  onSelect,
}: {
  value: 'daily' | 'one_time'
  current: 'daily' | 'one_time'
  label: string
  description: string
  onSelect: (v: 'daily' | 'one_time') => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={
        'flex flex-1 flex-col items-start gap-4 rounded-md border px-12 py-8 text-left ' +
        'transition-colors duration-fast ease-standard ' +
        (active
          ? 'border-primary bg-primary-container text-on-primary-container'
          : 'border-border text-on-surface hover:bg-surface-variant')
      }
    >
      <span className="text-label font-medium">{label}</span>
      <span className="text-caption text-on-surface-muted">{description}</span>
    </button>
  )
}
