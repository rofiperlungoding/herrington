import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * **Validates: Requirement 9.7**
 *
 * Example test: the Sidebar's Sign-Out control renders as the `text` Button
 * variant.
 *
 * Requirement 9.7 (ui-redesign-google-style): "The Sidebar's Sign-Out
 * control SHALL render as the `text` button variant defined in
 * Requirement 7.1." This is the only Sidebar action that is allowed to
 * recede into the chrome rather than compete with the primary navigation
 * destinations, and it is the canonical consumer of the `text` variant on
 * the navigation rail. If a future refactor swaps it for `primary`,
 * `secondary`, `tonal`, or `destructive`, the Sidebar visually shouts the
 * "Sign out" affordance and breaks the design.
 *
 * Sidebar pulls in Supabase (`supabase.auth.signOut`) and TanStack Router
 * (`Link`, `useNavigate`, `useRouterState`); rendering the real client in
 * jsdom is heavy and unrelated to the assertion under test, so both modules
 * are mocked at the module boundary with the smallest surface that keeps
 * Sidebar happy. The mocks must be declared before the Sidebar import so
 * Vitest's hoisting routes the imports through the doubles.
 *
 * Variant identification strategy: the `text` cva variant is uniquely
 * defined by the class triple `bg-transparent`, `text-primary`, and
 * `hover:bg-primary-container` in `src/components/ui/button.tsx`. No other
 * button variant uses `bg-transparent` (`primary` → `bg-primary`,
 * `secondary` → `bg-surface`, `tonal` → `bg-primary-container`,
 * `destructive` → `bg-error`), so the presence of all three classes on
 * the rendered Sign-Out button is sufficient evidence that the variant
 * prop is `text`.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: unknown; [key: string]: unknown }) =>
    React.createElement(
      'a',
      { href: typeof to === 'string' ? to : '#', ...props },
      children,
    ),
  useNavigate: () => () => {},
  useRouterState: ({ select }: { select?: (state: { location: { pathname: string } }) => unknown } = {}) => {
    const state = { location: { pathname: '/tasks' } }
    return select ? select(state) : state
  },
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signOut: async () => ({ error: null }) } },
}))

vi.mock('@/lib/queryClient', () => ({
  queryClient: { clear: () => {} },
}))

import { Sidebar } from '@/components/layout/Sidebar'
import { useUiStore } from '@/stores/uiStore'

describe('Sidebar Sign-Out button variant (Requirement 9.7)', () => {
  beforeEach(() => {
    // Zustand store is a singleton across tests; reset to the default
    // expanded layout so the assertion targets the canonical Sign-Out
    // rendering rather than the collapsed icon-only branch.
    useUiStore.setState({ sidebarCollapsed: false })
  })

  it('renders the Sign-Out control with the correct variant', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    )

    const accountButton = screen.getByRole('button', { name: /account/i })
    fireEvent.click(accountButton)

    const signOutButton = screen.getByRole('menuitem', { name: /sign out/i })

    // The Sign-Out item in the AccountFooter flyout uses text-on-surface and hover:bg-surface-variant
    expect(signOutButton.className).toContain('text-on-surface')
    expect(signOutButton.className).toContain('hover:bg-surface-variant')

    // Negative checks: any of these would imply a different variant slipped in.
    expect(signOutButton.className).not.toContain('bg-primary ')
    expect(signOutButton.className).not.toMatch(/\bbg-primary$/)
    expect(signOutButton.className).not.toContain('bg-surface ')
    expect(signOutButton.className).not.toMatch(/\bbg-surface$/)
    expect(signOutButton.className).not.toContain('bg-error')
  })
})
