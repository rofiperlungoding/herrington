import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * **Validates: Requirement 12.5**
 *
 * Example test: AppShell renders BottomNav on first paint when
 * `window.matchMedia` is unavailable.
 *
 * Requirement 12.5 (ui-redesign-google-style): "IF the UI_Shell cannot
 * determine the viewport width at initial render (for example because
 * `window.matchMedia` is unavailable during server-side rendering or
 * hydration), THEN THE UI_Shell SHALL default to the mobile BottomNav
 * layout until viewport detection resolves, so that navigation chrome is
 * never absent."
 *
 * The implementation contract that satisfies this requirement lives in two
 * places:
 *
 * 1. `src/hooks/useMediaQuery.ts` — when `window.matchMedia` is missing,
 *    `getSnapshot` and `getServerSnapshot` both return
 *    `options.defaultMatches`.
 * 2. `src/components/layout/AppShell.tsx` — calls
 *    `useMediaQuery('(min-width: 768px)', { defaultMatches: false })`,
 *    so the absence of matchMedia resolves `isDesktop` to `false`, which
 *    routes rendering through the `<BottomNav />` branch and skips
 *    `<Sidebar />`.
 *
 * This test exercises the contract end-to-end by deleting
 * `window.matchMedia` before rendering AppShell, then confirming that the
 * rendered tree contains BottomNav (the mobile nav) on the first paint
 * and does NOT contain the Sidebar's `<aside>` rail.
 *
 * BottomNav and Sidebar both pull in Supabase Auth (`supabase.auth.signOut`)
 * and TanStack Router (`Link`, `useNavigate`, `useRouterState`); rendering
 * real providers in jsdom is heavy and unrelated to the matchMedia-fallback
 * invariant under test, so both modules are mocked at the module boundary
 * with the smallest surface that keeps the components happy. Mocks are
 * declared before the AppShell import so Vitest's hoisting routes the
 * imports through the doubles.
 *
 * BottomNav identification strategy: BottomNav is the only navigation
 * element in the shell that renders as `<nav aria-label="Primary">` with
 * the position-fixed class set (`fixed bottom-0 inset-x-0`). Sidebar
 * renders as an `<aside>` element. Asserting the presence of the fixed
 * `<nav aria-label="Primary">` and the absence of `<aside>` is sufficient
 * to prove BottomNav (and only BottomNav) is mounted on first paint.
 */

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
  >(function MockLink({ to, children, ...rest }, ref) {
    return (
      <a ref={ref} href={typeof to === 'string' ? to : '#'} {...rest}>
        {children}
      </a>
    )
  }),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select?: (state: { location: { pathname: string } }) => unknown } = {}) => {
    const state = { location: { pathname: '/tasks' } }
    return select ? select(state) : state
  },
}))

vi.mock('@/lib/queryClient', () => ({
  queryClient: { clear: vi.fn() },
}))

import { AppShell } from '@/components/layout/AppShell'

/**
 * Snapshot of the original `window.matchMedia` (which jsdom does not
 * provide by default but a future setup file might) so we can restore
 * any pre-existing implementation between tests and avoid leaking the
 * deleted state into sibling specs.
 */
const ORIGINAL_MATCH_MEDIA = (window as Window & typeof globalThis).matchMedia

afterEach(() => {
  if (ORIGINAL_MATCH_MEDIA) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: ORIGINAL_MATCH_MEDIA,
    })
  } else {
    // No prior implementation: ensure the property is absent so subsequent
    // tests start from the same blank slate jsdom hands us.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).matchMedia
  }
})

describe('AppShell matchMedia-unavailable fallback (Requirement 12.5)', () => {
  it('renders BottomNav on first paint when window.matchMedia is undefined', () => {
    // Simulate the SSR / hydration / unsupported-environment case: the
    // viewport-detection API is simply not on `window`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).matchMedia
    expect(
      (window as Window & typeof globalThis).matchMedia,
    ).toBeUndefined()

    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AppShell>
          <p>content</p>
        </AppShell>
      </QueryClientProvider>,
    )

    // BottomNav is identified by the fixed-position `<nav>` with the
    // "Primary" accessible name. Sidebar uses `<aside>`, so the absence of
    // `<aside>` is the negative-side guarantee.
    const bottomNav = container.querySelector('nav[aria-label="Primary"]')
    expect(
      bottomNav,
      'AppShell must mount BottomNav (a <nav aria-label="Primary"> element) on first paint when matchMedia is unavailable',
    ).not.toBeNull()

    const bottomNavClasses = (bottomNav as HTMLElement).className.split(/\s+/)
    expect(bottomNavClasses).toContain('fixed')
    expect(bottomNavClasses).toContain('bottom-0')

    const sidebarAside = container.querySelector('aside')
    expect(
      sidebarAside,
      'AppShell must NOT mount the desktop Sidebar (<aside>) when matchMedia is unavailable',
    ).toBeNull()
  })

  it('still renders BottomNav when window.matchMedia is replaced with undefined', () => {
    // Some test harnesses overwrite `matchMedia` with `undefined` instead
    // of deleting the property. The fallback must hold in either shape.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })

    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AppShell>
          <p>content</p>
        </AppShell>
      </QueryClientProvider>,
    )

    const bottomNav = container.querySelector('nav[aria-label="Primary"]')
    expect(bottomNav).not.toBeNull()
    expect(container.querySelector('aside')).toBeNull()
  })
})
