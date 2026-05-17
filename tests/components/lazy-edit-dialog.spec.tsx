import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { Task } from '@/shared/api/tasks.contracts'
import type { Habit } from '@/shared/api/habits.contracts'

/**
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 *
 * Component test for lazy dialog mount behavior.
 *
 * Both `TaskItem` and `HabitItem` use `React.lazy` + conditional rendering
 * (`{editOpen && ...}`) for their edit dialogs. This test verifies:
 *   - No dialog is present in the DOM when `editOpen` is false (initial state)
 *   - After triggering the edit action, the dialog mounts via Suspense
 */

// Mock the mutation hooks so components can render without a real API
vi.mock('@/hooks/useToggleTaskCompletion', () => ({
  useToggleTaskCompletion: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/hooks/useCheckOffHabit', () => ({
  useCheckOffHabit: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/hooks/useTasks', () => ({
  useUpdateTask: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteTask: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/hooks/useHabits', () => ({
  useUpdateHabit: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteHabit: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/hooks/useAuthedApi', () => ({
  useAuthedApi: () => vi.fn(),
}))

vi.mock('@/lib/timezone', () => ({
  getUserTimezone: () => 'America/New_York',
}))

const mockTask: Task = {
  id: 'task-1',
  userId: 'user-1',
  title: 'Test Task',
  category: 'Work',
  isCompleted: false,
  deadline: null,
  createdAt: Math.floor(Date.now() / 1000),
}

const mockHabit: Habit = {
  id: 'habit-1',
  userId: 'user-1',
  title: 'Test Habit',
  currentStreak: 3,
  longestStreak: 10,
  lastCompletedDate: null,
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

afterEach(() => {
  cleanup()
})

describe('Lazy dialog mount — TaskItem', () => {
  it('does not render a dialog when editOpen is false (initial state)', async () => {
    const { TaskItem } = await import('@/components/tasks/TaskItem')

    render(<TaskItem task={mockTask} />, { wrapper: createWrapper() })

    // No dialog should be present in the DOM initially
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mounts the dialog after clicking the edit trigger', async () => {
    const { TaskItem } = await import('@/components/tasks/TaskItem')

    render(<TaskItem task={mockTask} />, { wrapper: createWrapper() })

    // The edit trigger is the "..." button with aria-label "Edit <title>"
    const editButton = screen.getByLabelText(`Edit ${mockTask.title}`)
    fireEvent.click(editButton)

    // Wait for the lazy-loaded dialog to resolve and mount
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})

describe('Lazy dialog mount — HabitItem', () => {
  it('does not render a dialog when editOpen is false (initial state)', async () => {
    const { HabitItem } = await import('@/components/habits/HabitItem')

    render(<HabitItem habit={mockHabit} />, { wrapper: createWrapper() })

    // No dialog should be present in the DOM initially
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mounts the dialog after clicking the habit title (edit trigger)', async () => {
    const { HabitItem } = await import('@/components/habits/HabitItem')

    render(<HabitItem habit={mockHabit} />, { wrapper: createWrapper() })

    // The edit trigger for HabitItem is the title element with role="button"
    const titleButton = screen.getByRole('button', { name: mockHabit.title })
    fireEvent.click(titleButton)

    // Wait for the lazy-loaded dialog to resolve and mount
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
