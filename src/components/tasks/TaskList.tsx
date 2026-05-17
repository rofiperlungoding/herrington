import type { Task } from '@/shared/api/tasks.contracts'
import { TaskItem } from './TaskItem'

/**
 * Pure sort used by `TaskList` (Requirement 5.3, 5.4).
 *
 * Rows are split into three groups and concatenated in this order:
 *
 *   1. Incomplete tasks with a non-null `deadline`, ordered by `deadline`
 *      ascending. Ties on `deadline` fall back to `createdAt` ascending
 *      (Requirement 5.4).
 *   2. Incomplete tasks with a null `deadline`, ordered by `createdAt`
 *      ascending (Requirement 5.4 tiebreak also applies within-group).
 *   3. Completed tasks, ordered by `createdAt` ascending.
 *
 * The function is pure: it does not mutate the input array. Each group is
 * produced by `.filter(...).sort(...)` on fresh arrays so the caller's
 * `tasks` reference is preserved, which matters for referential stability
 * in upstream memoization and for deterministic property-based testing.
 */
export function sortTasks(tasks: Task[]): Task[] {
  const incompleteWithDeadline = tasks
    .filter((t) => !t.isCompleted && t.deadline != null)
    .sort(
      (a, b) =>
        // Non-null assertions are safe: the filter guarantees `deadline != null`.
        a.deadline! - b.deadline! || a.createdAt - b.createdAt,
    )

  const incompleteWithoutDeadline = tasks
    .filter((t) => !t.isCompleted && t.deadline == null)
    .sort((a, b) => a.createdAt - b.createdAt)

  const completed = tasks
    .filter((t) => t.isCompleted)
    .sort((a, b) => a.createdAt - b.createdAt)

  return [...incompleteWithDeadline, ...incompleteWithoutDeadline, ...completed]
}

/**
 * Renders the authenticated user's tasks in the canonical order defined by
 * `sortTasks` (Requirement 5.3, 5.4). Individual row rendering — including
 * the completion checkbox, overdue visual state, and formatted deadline —
 * is delegated to `TaskItem`.
 */
export function TaskList({ tasks }: { tasks: Task[] }) {
  const sorted = sortTasks(tasks)
  return (
    <ul className="divide-y">
      {sorted.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </ul>
  )
}
