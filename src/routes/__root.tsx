import React, { Suspense } from 'react'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

import type { RouterContext } from '@/lib/routerContext'

import { useAuthBootstrap } from '@/hooks/useAuthBootstrap'

/**
 * Lazy-load the Sonner Toaster so its module (and the `sonner` dependency)
 * does not ship in the entry chunk. Toasts are only shown in response to
 * user actions, so deferring the load until after initial render is safe.
 * The first toast trigger may incur a ~50-100 ms delay while the chunk
 * loads — acceptable for a non-blocking notification.
 *
 * Design: S4.6, EH1 | Requirement: 9.6
 */
const Toaster = React.lazy(() =>
  import('@/components/ui/toast').then((m) => ({ default: m.Toaster })),
)

/**
 * Root layout for the Client.
 *
 * Mounts global providers that every route should share:
 *
 * - Renders `<Outlet />` so child routes (the `_authed` layout, `sign-in`,
 *   etc.) can take over the page body.
 * - Mounts the Design_System `<Toaster />` exactly once so any component
 *   can call `toast.success(...)` / `toast.error(...)` for optimistic-
 *   mutation rollback notifications (Requirement 9.4) and related flows.
 *   The Toaster wraps `sonner` with token-styled surfaces, motion that
 *   respects `prefers-reduced-motion`, and an assertive live region for
 *   error toasts (Requirements 6.4, 10.5, 10.6, 11.7, 11.8, 11.9).
 * - Runs `useAuthBootstrap()` to enforce a 10-second authentication
 *   bootstrap deadline (Requirement 1.6). If Supabase has not produced a
 *   session snapshot in that window we render a retry panel instead of
 *   `<Outlet />`. Once Supabase finishes loading, the panel is suppressed
 *   (Requirement 1.7).
 */
function RootLayout() {
  const { ready, timedOut, retry } = useAuthBootstrap()

  if (!ready && timedOut) {
    return (
      <>
        <div className="min-h-dvh flex items-center justify-center p-24 bg-surface text-on-surface">
          <div className="max-w-sm text-center flex flex-col gap-16">
            <h1 className="text-title font-medium">
              Authentication is taking too long
            </h1>
            <p className="text-body text-on-surface-muted">
              We couldn&apos;t reach the authentication service. Check your
              internet connection and try again.
            </p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center justify-center rounded-md bg-primary px-20 h-40 text-label font-medium text-on-primary transition-[background-color,box-shadow] duration-fast ease-standard hover:shadow-e1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
      </>
    )
  }

  return (
    <>
      <Outlet />
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})
