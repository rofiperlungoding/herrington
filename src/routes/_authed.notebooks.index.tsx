import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BookOpen, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import {
  notebooksQueryOptions,
  useCreateNotebook,
  useDeleteNotebook,
  useNotebooks,
  type Notebook,
} from '@/hooks/useNotebooks'

/**
 * Notebooks list page.
 *
 * One row per notebook — title, description, last-updated. Click a
 * row to open the detail view where the user can upload sources and
 * ask grounded questions.
 */
export const Route = createFileRoute('/_authed/notebooks/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(notebooksQueryOptions).catch(() => {
      // mount the route; the component will surface error state
    }),
  component: NotebooksListPage,
})

function NotebooksListPage() {
  const query = useNotebooks()
  const create = useCreateNotebook()

  async function handleCreate() {
    if (create.isPending) return
    await create.mutateAsync({})
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-24 p-24 md:p-32">
      <PageHeader
        eyebrow="Knowledge cabinet"
        title="Notebooks"
        description={
          query.data?.notebooks.length
            ? `${query.data.notebooks.length} on the shelf · ask any question, grounded in what's inside`
            : "A quiet cabinet. Drop a file or paste a note and ask questions grounded in what's inside."
        }
        action={
          <Button
            variant="text"
            onClick={handleCreate}
            disabled={create.isPending}
            loading={create.isPending}
          >
            <Plus className="h-16 w-16" aria-hidden="true" />
            New notebook
          </Button>
        }
      />

      <div>
        {query.isPending && !query.data ? (
          <p className="text-body text-on-surface-muted">A moment…</p>
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load your notebooks"
            description="Something didn't go through. Mind trying again?"
            action={
              <Button variant="secondary" onClick={() => query.refetch()}>
                Retry
              </Button>
            }
          />
        ) : query.data?.notebooks.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-32 w-32" />}
            title="Nothing in the cabinet yet"
            description="Create one, drop in a few files, and start asking."
          />
        ) : (
          <ul className="anim-stagger flex flex-col gap-4">
            {query.data?.notebooks.map((nb, i) => (
              <NotebookRow key={nb.id} notebook={nb} index={i} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function NotebookRow({
  notebook,
  index,
}: {
  notebook: Notebook
  index: number
}) {
  const del = useDeleteNotebook()
  const [confirming, setConfirming] = React.useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirming) {
      setConfirming(true)
      return
    }
    await del.mutateAsync(notebook.id)
  }

  return (
    <li style={{ ['--anim-i' as string]: index }}>
      <Link
        to="/notebooks/$notebookId"
        params={{ notebookId: notebook.id }}
        className={cn(
          'group flex items-center gap-12 rounded-md px-12 py-12',
          'bg-surface-container',
          'transition-colors duration-fast ease-standard',
          'hover:bg-surface-variant focus-visible:bg-surface-variant',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <span className="truncate text-label font-semibold text-on-surface">
            {notebook.title}
          </span>
          {notebook.description && (
            <p className="line-clamp-2 text-caption text-on-surface-muted">
              {notebook.description}
            </p>
          )}
        </div>

        <div
          className="flex shrink-0 items-center gap-8"
          onClick={(e) => {
            // Stop propagation only on the action area so clicks on the
            // delete button don't navigate, but clicks anywhere else on
            // the row still open the notebook.
            if (confirming) e.stopPropagation()
          }}
        >
          {confirming ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={del.isPending}
                className="rounded-md px-8 py-4 text-caption font-medium text-error hover:bg-error/10"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setConfirming(false)
                }}
                className="rounded-md px-8 py-4 text-caption text-on-surface-muted hover:bg-surface"
              >
                No
              </button>
            </>
          ) : (
            <>
              <span className="text-caption text-on-surface-muted group-hover:hidden">
                {formatRelative(notebook.updatedAt)}
              </span>
              <button
                type="button"
                onClick={handleDelete}
                aria-label={`Delete ${notebook.title}`}
                className={cn(
                  'hidden h-24 w-24 items-center justify-center rounded-md',
                  'group-hover:inline-flex focus-visible:inline-flex',
                  'hover:bg-on-surface/10',
                )}
              >
                <Trash2 className="h-16 w-16" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </Link>
    </li>
  )
}

function formatRelative(unix: number): string {
  const diffMs = Date.now() - unix * 1000
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}mo`
  return `${Math.floor(month / 12)}y`
}
