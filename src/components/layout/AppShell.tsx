import type { ReactNode } from 'react'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSmartNotifications } from '@/hooks/useSmartNotifications'
import { cn } from '@/lib/utils'

import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { FloatingTimer } from '@/components/pomodoro/FloatingTimer'

/**
 * Responsive application shell.
 *
 * A single `(min-width: 768px)` media query drives the primary navigation
 * swap (Requirements 12.1, 12.6):
 *
 * - Viewports `>= 768px` render `<Sidebar />` inline as a left-hand rail
 *   while the bottom bar is omitted.
 * - Viewports `< 768px` render `<BottomNav />` pinned to the bottom of the
 *   viewport and omit the sidebar.
 *
 * `useMediaQuery` is called with `defaultMatches: false` so that when
 * `window.matchMedia` is unavailable — SSR, static pre-render, or a test
 * that deletes the API — the first paint prefers the mobile shell,
 * satisfying Requirement 12.5. Crossing the breakpoint at runtime (resize,
 * rotate, zoom) flips `isDesktop` and swaps the nav chrome on the next
 * render without unmounting the `<main>` element, so the content region and
 * any focused element inside it remain mounted across the transition
 * (Requirement 12.6).
 *
 * The `<main>` container applies fluid padding that scales with the
 * breakpoint (Requirement 12.4):
 *
 * - Mobile: `px-16 py-24 pb-64` — edge padding plus bottom padding that
 *   clears the fixed-height `BottomNav`.
 * - Desktop: `md:mx-auto md:max-w-readable md:w-full md:px-32 md:py-32` —
 *   centered column capped at the `readable` width token (see
 *   `tailwind.config.ts`), keeping line lengths inside the readable band
 *   on wide viewports (Requirements 4.7, 12.2, 12.3).
 *
 * The outer container uses `min-h-dvh` and `flex` so the sidebar and main
 * share the full viewport height in a row layout on desktop. Background and
 * foreground resolve through the Design_System role tokens (`bg-surface`,
 * `text-on-surface`) so the surface tracks the active `[data-theme]`
 * (Requirement 16.6).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const isDesktop = useMediaQuery('(min-width: 768px)', { defaultMatches: false })
  // Engine is a side-effect hook — no UI of its own. Lives here so it
  // keeps polling regardless of which route the user is on.
  useSmartNotifications()

  return (
    <div className="min-h-dvh flex bg-surface text-on-surface">
      {isDesktop ? <Sidebar /> : null}
      <main
        className={cn(
          'flex-1 min-w-0',
          // Mobile: single column with edge padding + bottom clearance for
          // the fixed BottomNav.
          'px-16 py-24 pb-64',
          // Desktop: centered column capped at the readable-width token.
          'md:mx-auto md:max-w-readable md:w-full md:px-32 md:py-32 md:pb-32',
        )}
      >
        {children}
      </main>
      {!isDesktop ? <BottomNav /> : null}
      <FloatingTimer />
    </div>
  )
}
