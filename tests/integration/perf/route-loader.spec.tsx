/**
 * Integration test: Route loader prefetch for `/tasks`
 *
 * Validates: Requirements 5.2, 5.5, 5.6
 *
 * Verifies that the route loader prefetches task data via
 * `queryClient.ensureQueryData(tasksListQueryOptions)` so that:
 *   1. Exactly one `GET /api/tasks` request is fired by the loader
 *   2. No second fetch is fired by the component on mount (cache hit)
 *   3. The rendered list shows data from the prefetched cache without an
 *      intermediate loading skeleton
 *
 * Approach: We simulate the loader → component lifecycle by:
 *   - Calling `ensureQueryData(tasksListQueryOptions)` (what the loader does)
 *   - Then rendering a component that calls `useTasks()` (what the route does)
 *   - Asserting the component gets data synchronously from cache
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { TaskListResponseBody } from '@/shared/api/tasks.contracts'

// ---------------------------------------------------------------------------
// Mock modules that have side effects or external dependencies
// ---------------------------------------------------------------------------

// Mock the authStore to provide a cached access token without Supabase
vi.mock('@/lib/authStore', () => ({
  useAuthStore: {
    getState: () => ({ accessToken: 'mock-token' }),
    subscribe: () => () => {},
  },
  useSession: () => ({ session: { access_token: 'mock-token' }, ready: true, timedOut: false }),
  getCachedAccessToken: () => 'mock-token',
}))

// Mock supabaseClient to avoid real Supabase initialization
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-token' } },
        error: null,
      }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TASKS: TaskListResponseBody = {
  tasks: [
    {
      id: 'task-1',
      userId: 'user-1',
      title: 'Buy groceries',
      category: 'personal',
      isCompleted: false,
      deadline: null,
      createdAt: 1700000000,
    },
    {
      id: 'task-2',
      userId: 'user-1',
      title: 'Finish report',
      category: 'work',
      isCompleted: true,
      deadline: 1700100000,
      createdAt: 1700000100,
    },
    {
      id: 'task-3',
      userId: 'user-1',
      title: 'Call dentist',
      category: 'health',
      isCompleted: false,
      deadline: null,
      createdAt: 1700000200,
    },
  ],
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh QueryClient configured like the app's production client
 * but with retry disabled for deterministic tests.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/**
 * Test component that mirrors what the real TasksPage does:
 * calls `useTasks()` and renders either a loading skeleton or the task list.
 *
 * This isolates the prefetch behavior test from TanStack Router internals
 * while testing the exact same cache-read path the real component uses.
 */
function TestTasksConsumer() {
  // Import useTasks dynamically won't work in component body, so we use
  // useQuery with the same options the real component uses.
  const { useTasks } = require('@/hooks/useTasks')
  const query = useTasks()

  if (query.isPending && !query.data) {
    return (
      <div aria-busy="true" aria-label="Loading tasks">
        <div data-testid="skeleton">Loading...</div>
      </div>
    )
  }

  if (query.isError) {
    return <div data-testid="error">Error loading tasks</div>
  }

  return (
    <ul data-testid="task-list">
      {query.data?.tasks.map((task: { id: string; title: string }) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Route loader prefetch — /tasks', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch
  let tasksListQueryOptions: any
  let useTasks: any

  beforeEach(async () => {
    originalFetch = globalThis.fetch
    fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    // Import after mocks are set up
    const mod = await import('@/hooks/useTasks')
    tasksListQueryOptions = mod.tasksListQueryOptions
    useTasks = mod.useTasks
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('loader fires exactly one GET /api/tasks request via ensureQueryData', async () => {
    const queryClient = createTestQueryClient()

    // Simulate what the route loader does: call ensureQueryData which will
    // trigger a fetch because the cache is empty.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_TASKS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    // Execute the loader's ensureQueryData call
    await queryClient.ensureQueryData(tasksListQueryOptions)

    // Exactly one fetch should have been fired
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'GET' }),
    )

    queryClient.clear()
  })

  it('component renders prefetched data immediately without loading skeleton', () => {
    const queryClient = createTestQueryClient()

    // Pre-populate the cache (simulating what the loader already did before
    // the component mounts). This is the key behavior: the loader runs
    // before the component, so by the time the component mounts the data
    // is already in the QueryClient cache.
    queryClient.setQueryData(tasksListQueryOptions.queryKey, MOCK_TASKS)

    // Render a component that uses useTasks() with the pre-populated cache
    function TasksConsumer() {
      const query = useTasks()

      if (query.isPending && !query.data) {
        return (
          <div aria-busy="true" aria-label="Loading tasks">
            <div data-testid="skeleton">Loading...</div>
          </div>
        )
      }

      if (query.isError) {
        return <div data-testid="error">Error loading tasks</div>
      }

      return (
        <ul data-testid="task-list">
          {query.data?.tasks.map((task: { id: string; title: string }) => (
            <li key={task.id}>{task.title}</li>
          ))}
        </ul>
      )
    }

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <TasksConsumer />
      </QueryClientProvider>,
    )

    // The loading skeleton should NOT be present — data is served from cache
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()

    // The task titles from the prefetched data should be visible immediately
    expect(screen.getByText('Buy groceries')).toBeInTheDocument()
    expect(screen.getByText('Finish report')).toBeInTheDocument()
    expect(screen.getByText('Call dentist')).toBeInTheDocument()

    // The task list container should be rendered
    expect(screen.getByTestId('task-list')).toBeInTheDocument()

    queryClient.clear()
  })

  it('no second fetch is fired by the component when cache is pre-populated by loader', async () => {
    const queryClient = createTestQueryClient()

    // Pre-populate cache as the loader would
    queryClient.setQueryData(tasksListQueryOptions.queryKey, MOCK_TASKS)

    // Reset fetch spy to track only component-initiated fetches
    fetchSpy.mockClear()

    function TasksConsumer() {
      const query = useTasks()
      return <div>{query.data ? 'loaded' : 'pending'}</div>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <TasksConsumer />
      </QueryClientProvider>,
    )

    // Wait a tick to allow any potential useEffect-based fetches to fire
    await new Promise((r) => setTimeout(r, 50))

    // No fetch should have been fired — the component uses the cached data
    // because staleTime (30s) has not elapsed since the cache was populated
    expect(fetchSpy).not.toHaveBeenCalled()

    queryClient.clear()
  })

  it('ensureQueryData does not re-fetch when cache is already populated within staleTime window (Req 5.5)', async () => {
    const queryClient = createTestQueryClient()

    // First call: populates the cache
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_TASKS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await queryClient.ensureQueryData(tasksListQueryOptions)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second call within staleTime window: should NOT fetch again.
    // This simulates the preload-on-hover → click-within-30s scenario (Req 5.5):
    // user hovers a Link, loader prefetches, user clicks within 30s, data
    // is served from cache without an additional HTTP request.
    await queryClient.ensureQueryData(tasksListQueryOptions)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // Still just 1

    queryClient.clear()
  })
})
