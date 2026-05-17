import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { tasks, habits } from '@/shared/db/schema'

/**
 * Unit test for database schema index declarations.
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 *
 * Asserts that the Drizzle schema declares the expected indexes on the
 * `tasks` and `habits` tables with the correct column tuples, ensuring
 * queries filtered by `user_id` can leverage index scans instead of
 * full-table scans.
 */
describe('Database schema index declarations', () => {
  const tasksConfig = getTableConfig(tasks)
  const habitsConfig = getTableConfig(habits)

  // Helper to extract index info from a table config
  function getIndexes(config: ReturnType<typeof getTableConfig>) {
    return config.indexes.map((idx) => ({
      name: idx.config.name,
      columns: idx.config.columns.map((col) => col.name),
    }))
  }

  it('tasks table declares idx_tasks_user on (user_id)', () => {
    const indexes = getIndexes(tasksConfig)
    const idx = indexes.find((i) => i.name === 'idx_tasks_user')

    expect(idx).toBeDefined()
    expect(idx!.columns).toEqual(['user_id'])
  })

  it('tasks table declares idx_tasks_user_created on (user_id, created_at)', () => {
    const indexes = getIndexes(tasksConfig)
    const idx = indexes.find((i) => i.name === 'idx_tasks_user_created')

    expect(idx).toBeDefined()
    expect(idx!.columns).toEqual(['user_id', 'created_at'])
  })

  it('habits table declares idx_habits_user on (user_id)', () => {
    const indexes = getIndexes(habitsConfig)
    const idx = indexes.find((i) => i.name === 'idx_habits_user')

    expect(idx).toBeDefined()
    expect(idx!.columns).toEqual(['user_id'])
  })
})
