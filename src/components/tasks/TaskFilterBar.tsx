import * as React from 'react'

import { Chip } from '@/components/tasks/TagInput'
import type { Task } from '@/shared/api/tasks.contracts'

/**
 * Tag filter bar shown above the task list. Surfaces every tag the user
 * has actually used in the current task list (no presets, no fixed
 * vocabulary), and lets them toggle multiple tags at once. Filter is
 * AND across selected tags — "kuliah + urgent" returns only tasks that
 * carry both labels.
 *
 * Design notes:
 *   - Chips are minimalist: text + accent ring when active.
 *   - "All" chip clears the selection (only shown when at least one
 *     tag is active).
 *   - Hidden entirely when there are zero tags in the dataset, so the
 *     UI doesn't add empty chrome for users who haven't tagged yet.
 *
 * The selection lives in component state in the parent (Tasks page),
 * not the global UI store, so it resets on navigation. Persisting it
 * across sessions felt overkill for now — happy to revisit.
 */
export function TaskFilterBar({
  tasks,
  selected,
  onChange,
}: {
  tasks: Task[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const tagsWithCount = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      for (const tag of t.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }))
  }, [tasks])

  if (tagsWithCount.length === 0) return null

  function toggle(tag: string) {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag))
    } else {
      onChange([...selected, tag])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-8">
      <span className="text-caption uppercase tracking-wider text-on-surface-muted">
        Filter
      </span>
      {selected.length > 0 && (
        <Chip label="Clear" onClick={() => onChange([])} />
      )}
      {tagsWithCount.map(({ tag, count }) => (
        <Chip
          key={tag}
          label={`${tag} · ${count}`}
          active={selected.includes(tag)}
          onClick={() => toggle(tag)}
        />
      ))}
    </div>
  )
}

/**
 * Apply the currently-selected tag filter to a task list. AND semantics:
 * a task must carry every selected tag to pass.
 */
export function filterTasksByTags(tasks: Task[], selected: string[]): Task[] {
  if (selected.length === 0) return tasks
  return tasks.filter((t) => selected.every((sel) => t.tags.includes(sel)))
}
