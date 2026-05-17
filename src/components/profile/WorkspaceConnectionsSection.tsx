import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Plus, Star, Trash2, Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { GmailIcon } from '@/components/chat/GoogleIcons'
import { cn } from '@/lib/utils'
import {
  useDeleteConnection,
  useTestConnection,
  useUpdateConnection,
  useWorkspaceConnections,
  type WorkspaceConnection,
} from '@/hooks/useWorkspaceConnections'

/**
 * Workspace connections settings section.
 *
 * Lives on the profile page and lists every Google Apps Script bridge
 * the user has connected. Operations:
 *   - Add a new connection → routes to `/settings/workspace/new`
 *     (paste flow doesn't fit cleanly in a modal).
 *   - Test, set as default, rename, or disconnect each row inline.
 *
 * Secrets are server-side only — there's no surface to read or copy
 * an existing secret. To rotate one, the user goes through the same
 * "add" flow (or rename/replace via PATCH; a simpler flow we keep for
 * later when we add a "rotate" mini-modal).
 */
export function WorkspaceConnectionsSection() {
  const query = useWorkspaceConnections()
  const connections = query.data?.connections ?? []

  return (
    <section className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold text-on-surface">
          Workspace integrations
        </h2>
        <p className="text-caption text-on-surface-muted">
          Connect Google accounts so the assistant can work with your inbox,
          calendar, and docs. Your credentials never leave Herrington.
        </p>
      </div>

      <div className="flex flex-col gap-12 rounded-lg border border-border bg-surface p-20">
        {query.isPending && !query.data ? (
          <p className="text-caption text-on-surface-muted">A moment…</p>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-start gap-12 py-12">
            <p className="text-body text-on-surface">
              No accounts connected yet.
            </p>
            <p className="text-caption text-on-surface-muted">
              Connect a Google account to put your inbox, calendar, and docs
              at hand.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-8">
            {connections.map((c) => (
              <ConnectionRow key={c.id} connection={c} />
            ))}
          </ul>
        )}

        <div className="flex justify-start pt-4">
          <Button asChild variant="secondary" size="sm">
            <Link to={'/settings/workspace/new' as never}>
              <Plus className="h-16 w-16" aria-hidden="true" />
              {connections.length === 0
                ? 'Connect Google account'
                : 'Add another account'}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

function ConnectionRow({ connection }: { connection: WorkspaceConnection }) {
  const test = useTestConnection()
  const update = useUpdateConnection()
  const remove = useDeleteConnection()

  const [renaming, setRenaming] = React.useState(false)
  const [draftLabel, setDraftLabel] = React.useState(connection.label)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  React.useEffect(() => {
    setDraftLabel(connection.label)
  }, [connection.label])

  const status = connection.lastTestOk === false ? 'failed' : 'ok'
  const statusLabel =
    connection.lastTestAt === null
      ? 'Connected, not yet tested'
      : status === 'failed'
        ? 'Last test failed'
        : `Connected · checked ${formatRelative(connection.lastTestAt)}`

  async function commitRename() {
    const next = draftLabel.trim()
    setRenaming(false)
    if (!next || next === connection.label) {
      setDraftLabel(connection.label)
      return
    }
    try {
      await update.mutateAsync({ id: connection.id, label: next })
    } catch {
      setDraftLabel(connection.label)
    }
  }

  return (
    <li className="flex flex-col gap-12 rounded-md border border-border bg-surface-container p-12 md:flex-row md:items-center md:gap-16">
      <span className="shrink-0">
        <GmailIcon size={24} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-8">
          {renaming ? (
            <input
              autoFocus
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitRename()
                }
                if (e.key === 'Escape') {
                  setRenaming(false)
                  setDraftLabel(connection.label)
                }
              }}
              className="flex-1 border-0 bg-transparent text-label font-medium text-on-surface outline-none"
              maxLength={80}
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="truncate text-left text-label font-medium text-on-surface hover:underline"
              title="Rename"
            >
              {connection.label}
            </button>
          )}
          {connection.isDefault && (
            <span className="inline-flex items-center gap-2 rounded-pill bg-brand-conservatory px-8 py-2 text-caption font-medium text-brand-brass">
              <Star className="h-12 w-12" aria-hidden="true" />
              Primary
            </span>
          )}
        </div>
        <p
          className={cn(
            'text-caption',
            status === 'failed' ? 'text-error' : 'text-on-surface-muted',
          )}
        >
          {statusLabel}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-8">
        <Button
          variant="text"
          size="sm"
          onClick={() => test.mutate(connection.id)}
          loading={test.isPending && test.variables === connection.id}
        >
          <Zap className="h-12 w-12" aria-hidden="true" />
          Test
        </Button>
        {!connection.isDefault && (
          <Button
            variant="text"
            size="sm"
            onClick={() =>
              update.mutate({ id: connection.id, isDefault: true })
            }
            loading={update.isPending && update.variables?.id === connection.id}
          >
            <CheckCircle2 className="h-12 w-12" aria-hidden="true" />
            Make primary
          </Button>
        )}
        {confirmingDelete ? (
          <span className="flex items-center gap-4">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => remove.mutate(connection.id)}
              loading={remove.isPending && remove.variables === connection.id}
            >
              Confirm
            </Button>
            <Button
              variant="text"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="text"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-12 w-12" aria-hidden="true" />
            Disconnect
          </Button>
        )}
      </div>
    </li>
  )
}

function formatRelative(unixSec: number): string {
  const dt = Date.now() / 1000 - unixSec
  if (dt < 60) return 'just now'
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`
  return `${Math.floor(dt / 86400)}d ago`
}
