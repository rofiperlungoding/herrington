import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { AppShell } from '@/components/layout/AppShell'
import { ThemeProvider } from '@/components/profile/ThemeProvider'
import { useSession } from '@/lib/authStore'

/**
 * Layout route for the authenticated portion of the app.
 *
 * Consumes auth state from the Zustand auth store via `useSession()`.
 * The store is populated by a single `onAuthStateChange` subscription
 * registered at module load in `authStore.ts`, and the bootstrap deadline
 * is enforced by `useAuthBootstrap` in `__root.tsx`.
 *
 * This route does NOT call `supabase.auth.getSession()` or subscribe to
 * `onAuthStateChange` — it is a pure consumer of derived state.
 *
 * While the store is not yet `ready` we render `null` (the root layout
 * already shows a retry panel if Supabase times out). Once ready, an
 * unauthenticated user is pushed to `/sign-in` and a signed-in user sees
 * the AppShell + child route.
 *
 * Design: S2.4 | Requirements: 10.2, 13.3
 */
export const Route = createFileRoute('/_authed')({
  component: AuthedLayout,
})

function AuthedLayout() {
  const navigate = useNavigate()
  const { session, ready } = useSession()

  useEffect(() => {
    if (ready && !session) {
      navigate({ to: '/sign-in' as never, replace: true })
    }
  }, [ready, session, navigate])

  if (!ready) return null
  if (!session) return null

  return (
    <ThemeProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </ThemeProvider>
  )
}
