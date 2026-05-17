/**
 * Property 3: Auth bootstrap deadline
 *
 * **Validates: Requirements 10.1, 10.2**
 *
 * Verifies that the retry panel in `__root.tsx` appears at exactly the
 * 10-second mark when Supabase session never resolves. Uses fake timers
 * to deterministically test the deadline boundary:
 *   - At 9,999 ms: retry panel is NOT shown
 *   - At 10,000 ms: retry panel IS shown
 *
 * This proves the auth bootstrap deadline is exactly 10 seconds — not
 * earlier, not later — as required by the consolidated `useAuthBootstrap`
 * hook backed by the Zustand `authStore`.
 *
 * Spec references:
 *   Requirements: 10.1, 10.2
 *   Design: Property 3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import * as React from 'react'

// ─── Mock setup ─────────────────────────────────────────────────────────────

// Mock the supabase client so onAuthStateChange never fires INITIAL_SESSION
// (simulating a session that never resolves).
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(() => new Promise(() => {})), // Never resolves
    },
  },
}))

// Mock TanStack Router's createRootRouteWithContext and Outlet to isolate
// the RootLayout rendering without needing the full router infrastructure.
vi.mock('@tanstack/react-router', () => ({
  createRootRouteWithContext: () => (opts: { component: React.ComponentType }) => ({
    component: opts.component,
  }),
  Outlet: () => React.createElement('div', { 'data-testid': 'outlet' }, 'Outlet'),
}))

// Mock the toast component (lazy-loaded in __root.tsx)
vi.mock('@/components/ui/toast', () => ({
  Toaster: () => React.createElement('div', { 'data-testid': 'toaster' }),
}))

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Auth bootstrap deadline (Property 3)', () => {
  let RootLayout: React.ComponentType

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()

    // Re-apply mocks after resetModules
    vi.doMock('@/lib/supabaseClient', () => ({
      supabase: {
        auth: {
          onAuthStateChange: vi.fn(() => ({
            data: { subscription: { unsubscribe: vi.fn() } },
          })),
          getSession: vi.fn(() => new Promise(() => {})), // Never resolves
        },
      },
    }))

    vi.doMock('@tanstack/react-router', () => ({
      createRootRouteWithContext: () => (opts: { component: React.ComponentType }) => ({
        component: opts.component,
      }),
      Outlet: () => React.createElement('div', { 'data-testid': 'outlet' }, 'Outlet'),
    }))

    vi.doMock('@/components/ui/toast', () => ({
      Toaster: () => React.createElement('div', { 'data-testid': 'toaster' }),
    }))

    // Import the root route module fresh so the authStore module-level
    // subscription runs against our mock (which never fires INITIAL_SESSION).
    const rootModule = await import('@/routes/__root')
    // The Route export has a `component` property from our mock
    RootLayout = (rootModule.Route as unknown as { component: React.ComponentType }).component
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retry panel is NOT shown before 10,000 ms', () => {
    render(React.createElement(RootLayout))

    // Advance to just before the deadline (9,999 ms)
    act(() => {
      vi.advanceTimersByTime(9_999)
    })

    // The retry panel should NOT be visible — the text "Authentication is taking too long"
    // is the heading rendered in the retry panel.
    expect(
      screen.queryByText('Authentication is taking too long'),
    ).not.toBeInTheDocument()

    // The Outlet (normal content) should be rendered instead
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('retry panel IS shown at exactly 10,000 ms', () => {
    render(React.createElement(RootLayout))

    // Advance to exactly the deadline (10,000 ms)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    // The retry panel should now be visible
    expect(
      screen.getByText('Authentication is taking too long'),
    ).toBeInTheDocument()

    // The retry button should be present
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    // The Outlet should NOT be rendered (retry panel replaces it)
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument()
  })

  it('retry panel appears at 10,000 ms boundary (advance 9,999 then 1 more)', () => {
    render(React.createElement(RootLayout))

    // Step 1: Advance 9,999 ms — no retry panel
    act(() => {
      vi.advanceTimersByTime(9_999)
    })

    expect(
      screen.queryByText('Authentication is taking too long'),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()

    // Step 2: Advance 1 more ms (total = 10,000 ms) — retry panel appears
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(
      screen.getByText('Authentication is taking too long'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument()
  })
})
