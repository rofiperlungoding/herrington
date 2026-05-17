import * as React from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { BookOpen, CheckSquare, Flame, Home, LineChart, Settings, WandSparkles } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'

/**
 * Mobile navigation bar rendered by `AppShell` on viewports < 768px
 * (Requirement 12.2). Presents the two MVP destinations — `/tasks` and
 * `/habits` — as icon-first entries suited to thumb reach, plus a
 * Sign-Out control to mirror the Sidebar footer (Requirement 13.6).
 *
 * The bar is pinned to the bottom of the viewport (`fixed bottom-0 inset-x-0`)
 * so page content can scroll underneath it while the controls stay reachable.
 *
 * Visual layer (Requirements 9.5, 9.6, 13.6):
 * - The container uses `bg-surface` with `border-t border-border` so the
 *   bar is visually separated from scrolling content without relying on
 *   elevation (a dropshadow at the bottom of the viewport reads as a
 *   graphical artifact on mobile).
 * - Each entry is a vertical stack of `<Icon />` over `<span class="text-caption">`.
 *   The active entry uses the `primary` color role on both icon and label
 *   (`text-primary`), inactive entries use `text-on-surface-muted` so they
 *   stay legible while receding (Requirement 9.6).
 * - Keyboard focus renders the Focus_Ring via
 *   `focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2`
 *   outside each entry's box. The ring is the Focus_Ring color, so it is
 *   distinguishable from the primary-colored active state even on the
 *   currently-active route (Requirement 9.5).
 */

interface NavEntry {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/**
 * Primary navigation entries. The set and order mirror the Sidebar so that
 * Requirement 13.6 ("same set of navigation entries in the same order")
 * holds by construction.
 */
const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  {
    to: '/',
    label: 'Home',
    icon: Home,
  },
  {
    to: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
  },
  {
    to: '/habits',
    label: 'Habits',
    icon: Flame,
  },
  {
    to: '/chat',
    label: 'Assistant',
    icon: WandSparkles,
  },
  {
    to: '/notebooks',
    label: 'Notebooks',
    icon: BookOpen,
  },
  {
    to: '/review',
    label: 'Review',
    icon: LineChart,
  },
  {
    to: '/settings/profile',
    label: 'Settings',
    icon: Settings,
  },
]

/**
 * Shared class list for the vertical icon-over-label stack used by both
 * nav links and the Sign-Out button, so every entry shares the same
 * layout, focus ring, and motion contract.
 */
const ENTRY_BASE_CLASS = cn(
  'flex flex-col items-center justify-center gap-4 px-12 py-8 rounded-md',
  'transition-colors duration-fast ease-standard',
  'focus-visible:outline-none',
  'focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
)

export function BottomNav() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed bottom-0 inset-x-0 z-40 h-56',
        'border-t border-border bg-surface',
        'flex items-center justify-around',
      )}
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          currentPath === item.to || currentPath.startsWith(item.to + '/')
        const className = cn(
          ENTRY_BASE_CLASS,
          isActive
            ? 'text-primary'
            : 'text-on-surface-muted hover:text-on-surface',
        )
        const content = (
          <>
            <Icon decorative size={20}>
              <item.icon />
            </Icon>
            <span className="text-caption">{item.label}</span>
          </>
        )

        // Render "/" as a plain anchor to dodge TanStack's "Generated path
        // / for route /_authed" ambiguity warning that fires when the
        // layout route and its index share fullPath '/'.
        if (item.to === '/') {
          return (
            <a
              key={item.to}
              href="/"
              aria-current={isActive ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                navigate({ to: '/' as never })
              }}
              className={className}
            >
              {content}
            </a>
          )
        }

        return (
          <Link
            key={item.to}
            to={item.to as never}
            aria-current={isActive ? 'page' : undefined}
            className={className}
          >
            {content}
          </Link>
        )
      })}
    </nav>
  )
}
