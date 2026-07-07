import * as React from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Flame,
  Home,
  LineChart,
  LogOut,
  Settings,
  WandSparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Avatar } from '@/components/profile/Avatar'
import { Monogram } from '@/components/brand/Monogram'
import { Wordmark } from '@/components/brand/Wordmark'
import { useUiStore } from '@/stores/uiStore'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore, useSession } from '@/lib/authStore'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'

/**
 * Desktop-only navigation rail rendered by `AppShell` on viewports >= 768px
 * (Requirement 9.1). Presents the MVP destinations as the canonical
 * primary navigation entries (Requirement 9.3).
 *
 * Footer: an avatar pill with display name + headline. Clicking it
 * reveals a small flyout menu containing Settings and Sign-Out. When
 * the rail is collapsed the pill collapses to just the avatar disc and
 * a tooltip surfaces the user's name on hover.
 */
interface NavEntry {
  to: string
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  {
    to: '/',
    label: 'Home',
    icon: <Home className="h-20 w-20 shrink-0" aria-hidden="true" />,
  },
  {
    to: '/tasks',
    label: 'Tasks',
    icon: <CheckSquare className="h-20 w-20 shrink-0" aria-hidden="true" />,
  },
  {
    to: '/habits',
    label: 'Habits',
    icon: <Flame className="h-20 w-20 shrink-0" aria-hidden="true" />,
  },
  {
    to: '/chat',
    label: 'Assistant',
    icon: <WandSparkles className="h-20 w-20 shrink-0" aria-hidden="true" />,
  },
  {
    to: '/notebooks',
    label: 'Notebooks',
    icon: <BookOpen className="h-20 w-20 shrink-0" aria-hidden="true" />,
  },
  {
    to: '/review',
    label: 'Review',
    icon: <LineChart className="h-20 w-20 shrink-0" aria-hidden="true" />,
  },
]

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)
  const navigate = useNavigate()
  const profile = useProfile()

  const { session } = useSession()
  const defaultName = session?.user?.email?.split('@')[0] || 'You'

  async function handleSignOut() {
    await useAuthStore.getState().signOut()
    queryClient.clear()
    navigate({ to: '/sign-in' as never })
  }

  return (
    <TooltipProvider delayDuration={500}>
      <aside
        data-collapsed={collapsed ? '' : undefined}
        className={cn(
          'flex flex-col shrink-0 h-dvh',
          'sticky top-0',
          'bg-surface-container',
          'border-r border-border',
          'transition-[width] duration-300 ease-out',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex items-center p-8',
            collapsed ? 'flex-col gap-8 justify-center' : 'justify-between',
          )}
        >
          {collapsed ? (
            <Monogram size={24} className="text-brand-conservatory" />
          ) : (
            <span className="flex items-center gap-8 pl-4">
              <Monogram size={20} className="text-brand-conservatory" />
              <Wordmark size="sm" className="text-on-surface" />
            </span>
          )}
          <Button
            variant="text"
            size="icon"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="h-20 w-20" aria-hidden="true" />
            ) : (
              <ChevronLeft className="h-20 w-20" aria-hidden="true" />
            )}
          </Button>
        </div>

        <nav
          aria-label="Primary"
          className="flex flex-col gap-4 px-8 flex-1"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="mt-auto p-8">
          <AccountFooter
            collapsed={collapsed}
            displayName={
              profile.data?.preferredName ||
              profile.data?.displayName ||
              defaultName
            }
            headline={profile.data?.headline ?? null}
            avatarEmoji={profile.data?.avatarEmoji ?? null}
            avatarColor={profile.data?.avatarColor ?? null}
            onSettings={() => navigate({ to: '/settings/profile' as never })}
            onSignOut={handleSignOut}
          />
        </div>
      </aside>
    </TooltipProvider>
  )
}

/**
 * Account flyout. Renders an avatar pill (collapsed: just the disc; expanded:
 * disc + name + headline) that opens a small menu with Settings + Sign-Out.
 *
 * The menu closes on outside click, Escape, or selecting any entry.
 */
function AccountFooter({
  collapsed,
  displayName,
  headline,
  avatarEmoji,
  avatarColor,
  onSettings,
  onSignOut,
}: {
  collapsed: boolean
  displayName: string
  headline: string | null
  avatarEmoji: string | null
  avatarColor: string | null
  onSettings: () => void
  onSignOut: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Account menu"
      className={cn(
        'flex w-full items-center rounded-md',
        'transition-colors duration-fast ease-standard',
        'hover:bg-surface-variant',
        collapsed ? 'justify-center p-4' : 'gap-12 p-8',
      )}
    >
      <Avatar
        name={displayName}
        emoji={avatarEmoji}
        color={avatarColor}
        size={32}
      />
      {!collapsed && (
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="truncate text-label font-medium text-on-surface">
            {displayName}
          </span>
          {headline && (
            <span className="truncate text-caption text-on-surface-muted">
              {headline}
            </span>
          )}
        </span>
      )}
    </button>
  )

  return (
    <div ref={wrapperRef} className="relative">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" align="center">
            {displayName}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 min-w-[200px] overflow-hidden rounded-md bg-surface shadow-e2',
            'anim-scale-in',
            collapsed ? 'bottom-full left-full ml-8 mb-0' : 'bottom-full left-0 mb-8',
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSettings()
            }}
            className={cn(
              'flex w-full items-center gap-12 px-12 py-8 text-left text-label',
              'text-on-surface',
              'transition-colors duration-fast ease-standard',
              'hover:bg-surface-variant',
            )}
          >
            <Settings className="h-16 w-16" aria-hidden="true" />
            <span>Settings</span>
          </button>
          <div className="h-[1px] bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            className={cn(
              'flex w-full items-center gap-12 px-12 py-8 text-left text-label',
              'text-on-surface',
              'transition-colors duration-fast ease-standard',
              'hover:bg-surface-variant',
            )}
          >
            <LogOut className="h-16 w-16" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Single navigation destination. Active state is derived from the router
 * state (exact match or descendant path) rather than TanStack's
 * `activeProps`, so we retain full control over the four required visual
 * states and can toggle the pill shape only when active.
 *
 * Note: the "/" target is rendered as a regular anchor + useNavigate
 * onClick so we don't hit TanStack's "Generated path / for route /_authed
 * did not match after params.stringify" warning. That warning is a known
 * false-positive when a layout route and its index sibling both have
 * `fullPath: '/'` (the typed Link picks the layout, then re-stringifies).
 */
function NavLink({
  item,
  collapsed,
}: {
  item: NavEntry
  collapsed: boolean
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const isActive =
    pathname === item.to || pathname.startsWith(item.to + '/')

  const className = cn(
    'inline-flex items-center gap-12',
    'h-40 px-12',
    'text-label font-medium',
    'transition-[background-color,color] duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
    isActive
      ? 'rounded-pill bg-primary-container text-on-primary-container'
      : cn(
          'rounded-md',
          'text-on-surface-muted',
          'hover:bg-surface-variant hover:text-on-surface',
        ),
    collapsed && 'justify-center px-0',
  )

  const content = (
    <>
      {item.icon}
      <span data-label className={cn(collapsed && 'sr-only')}>
        {item.label}
      </span>
    </>
  )

  // Render the home link as a plain anchor to avoid the TanStack Link
  // ambiguity warning (see comment above).
  const link =
    item.to === '/' ? (
      <a
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
    ) : (
      <Link
        to={item.to as never}
        aria-current={isActive ? 'page' : undefined}
        className={className}
      >
        {content}
      </Link>
    )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}
