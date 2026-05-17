import type { Habit } from '@/shared/api/habits.contracts'
import { HabitItem } from './HabitItem'

/**
 * Renders the authenticated user's habits as a simple list.
 *
 * Unlike `TaskList`, habits have no specified sort order in the requirements,
 * so they are rendered in the server-returned order (insertion order).
 * Individual row rendering — including streak display and check-off button —
 * is delegated to `HabitItem`.
 */
export function HabitList({ habits }: { habits: Habit[] }) {
  return (
    <ul className="divide-y">
      {habits.map((habit) => (
        <HabitItem key={habit.id} habit={habit} />
      ))}
    </ul>
  )
}
