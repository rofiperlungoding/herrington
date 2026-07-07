import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Validates: Requirement 9.2
 *
 * Example test: Sidebar fallback border
 *
 * Per Requirement 9.2: "IF neither a border nor Elevation_Scale-backed
 * background separation is applied, THEN THE Sidebar SHALL fall back to a
 * default 1-pixel `border` token on its trailing edge so the Sidebar always
 * remains visually distinct from main content."
 *
 * The current implementation in `src/components/layout/Sidebar.tsx` always
 * applies `border-r border-border` to the `<aside>` element, ensuring the
 * trailing-edge border is present even when elevation-based separation is
 * not (which is the case in this Design_System — the Sidebar uses
 * `bg-surface-container` plus a 1-pixel border, never elevation, satisfying
 * Requirement 9.1's "either … or … and SHALL NOT use both simultaneously").
 *
 * This test renders the Sidebar in jsdom and asserts the rendered `<aside>`
 * exposes the `border-r` class as the fallback affordance required by
 * Requirement 9.2.
 *
 * The Sidebar pulls in Supabase Auth (`supabase.auth.signOut`) and TanStack
 * Router providers as part of its sign-out and active-route logic, neither
 * of which is relevant to the border-fallback invariant. We mock both
 * modules so the assertion runs cleanly in jsdom without spinning up a
 * router or Supabase client.
 */

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }>(
    function MockLink({ to, children, ...rest }, ref) {
      return (
        <a ref={ref} href={typeof to === 'string' ? to : '#'} {...rest}>
          {children}
        </a>
      )
    },
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select?: (state: { location: { pathname: string } }) => unknown } = {}) => {
    const state = { location: { pathname: '/tasks' } }
    return select ? select(state) : state
  },
}))

vi.mock('@/lib/queryClient', () => ({
  queryClient: { clear: vi.fn() },
}))

import { Sidebar } from '@/components/layout/Sidebar'

describe('Sidebar fallback border (Requirement 9.2)', () => {
  it('renders an <aside> element', () => {
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    )
    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
  })

  it('applies the border-r fallback class on the rendered <aside>', () => {
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    )
    const aside = container.querySelector('aside') as HTMLElement
    expect(aside.className.split(/\s+/)).toContain('border-r')
  })

  it('pairs border-r with the token-backed border-border color', () => {
    // Requirement 9.2 mandates a "1-pixel `border` token". The Component_Library
    // expresses that token via Tailwind's `border-border` utility, which
    // resolves to `var(--color-border)` from `tokens.css`. Confirm both halves
    // of the fallback are present so the border is not just a 1-pixel line of
    // an arbitrary color.
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    )
    const aside = container.querySelector('aside') as HTMLElement
    const classes = aside.className.split(/\s+/)
    expect(classes).toContain('border-r')
    expect(classes).toContain('border-border')
  })
})
