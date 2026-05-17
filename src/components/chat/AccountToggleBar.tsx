import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Star } from 'lucide-react'

import { GmailIcon } from './GoogleIcons'
import { cn } from '@/lib/utils'
import {
  useUpdateSessionConnections,
  type ChatSession,
} from '@/hooks/useChat'
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'

/**
 * Per-conversation Workspace account toggle bar.
 *
 * Sits above the message list. Renders one chip per connected
 * Workspace account; clicking a chip flips that account in the
 * "enabled" set for this conversation. The default behaviour
 * (`activeConnectionIds === null`) is "primary only is enabled" so the
 * assistant doesn't accidentally fan out to side accounts; once the
 * user toggles anything, the explicit list takes over.
 *
 * Hidden completely when the user has zero connections — instead we
 * render a single quiet "Connect a Google account" link. Hidden also
 * when there's exactly one connection (no choice to make), since the
 * default is already "use that one".
 */
export function AccountToggleBar({
  session,
}: {
  session: ChatSession
}) {
  const connections = useWorkspaceConnections().data?.connections ?? []
  const update = useUpdateSessionConnections()

  // Resolve which IDs are currently enabled for this session.
  const enabledSet = React.useMemo(() => {
    if (session.activeConnectionIds === null || session.activeConnectionIds === undefined) {
      // Default state: only the primary connection is implicitly enabled.
      const def = connections.find((c) => c.isDefault) ?? connections[0]
      return def ? new Set([def.id]) : new Set<string>()
    }
    return new Set(session.activeConnectionIds)
  }, [session.activeConnectionIds, connections])

  if (connections.length === 0) {
    return (
      <div className="flex items-center gap-8 border-b border-border pb-12">
        <p className="text-caption text-on-surface-muted">
          No Workspace account connected.
        </p>
        <Link
          to={'/settings/workspace/new' as never}
          className="inline-flex items-center gap-4 text-caption text-primary hover:underline"
        >
          <Plus className="h-12 w-12" aria-hidden="true" />
          Connect Google
        </Link>
      </div>
    )
  }

  if (connections.length === 1) return null

  function toggle(id: string) {
    const next = new Set(enabledSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // Always send an explicit array so the server stops treating this
    // conversation as "default only".
    update.mutate({
      sessionId: session.id,
      activeConnectionIds: Array.from(next),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-8 border-b border-border pb-12">
      <span className="text-caption uppercase tracking-wider text-on-surface-muted">
        Accounts
      </span>
      {connections.map((c) => {
        const enabled = enabledSet.has(c.id)
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            aria-pressed={enabled}
            className={cn(
              'inline-flex items-center gap-4 rounded-pill border px-12 py-4',
              'text-caption font-medium',
              'transition-colors duration-fast ease-standard',
              enabled
                ? 'border-brand-conservatory bg-brand-conservatory text-brand-brass'
                : 'border-border text-on-surface-muted hover:bg-surface-variant',
            )}
          >
            <GmailIcon size={14} />
            <span className="truncate">{c.label}</span>
            {c.isDefault && (
              <Star
                className={cn(
                  'h-12 w-12 shrink-0',
                  enabled ? 'text-brand-brass' : 'text-on-surface-muted',
                )}
                aria-hidden="true"
                aria-label="primary"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
