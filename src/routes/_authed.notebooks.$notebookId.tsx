import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  FileText,
  Globe,
  Trash2,
  Upload,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { MarkdownMessage } from '@/components/ui/markdown-message'
import { cn } from '@/lib/utils'
import {
  EmptyFileError,
  UnsupportedFileError,
  extractFile,
} from '@/lib/fileExtract'
import {
  notebookDetailQueryOptions,
  notebookMessagesQueryOptions,
  useAskNotebook,
  useDeleteSource,
  useNotebookDetail,
  useNotebookMessages,
  useUpdateNotebook,
  useUploadSource,
  type NotebookMessage,
  type NotebookSource,
} from '@/hooks/useNotebooks'

/**
 * Notebook detail page — research workspace.
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  ← Back                                             │
 *   │  Title (editable)                                   │
 *   │  description                                        │
 *   ├─────────────────────┬───────────────────────────────┤
 *   │  Sources            │  Q&A history                  │
 *   │  + Add file         │   Q: …                        │
 *   │  📄 paper.pdf       │   A: … with [1] citations     │
 *   │  🌐 wikipedia.org   │   Q: …                        │
 *   │  🌐 arxiv.org       │   A: …                        │
 *   │                     │  ┌─────────────────┬──────┐  │
 *   │                     │  │ Type a question │  ↑   │  │
 *   │                     │  └─────────────────┴──────┘  │
 *   └─────────────────────┴───────────────────────────────┘
 *
 * Sources panel is unified — uploaded files (📄) and web pages the AI
 * pulled in during research (🌐) live in the same list. Clicking a
 * web source opens the original URL in a new tab.
 *
 * Q&A persists across sessions (`/api/notebooks/:id/messages`).
 *
 * If the user asks a question and the notebook's chunks don't have a
 * confident answer, the server fires Tavily, ingests the top results
 * as web sources, and re-runs retrieval. The new sources appear in
 * the panel automatically (we invalidate the detail query when
 * `didResearch` is true).
 */
export const Route = createFileRoute('/_authed/notebooks/$notebookId')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient
        .ensureQueryData(notebookDetailQueryOptions(params.notebookId))
        .catch(() => undefined),
      context.queryClient
        .ensureQueryData(notebookMessagesQueryOptions(params.notebookId))
        .catch(() => undefined),
    ]),
  component: NotebookDetailPage,
})

function NotebookDetailPage() {
  const { notebookId } = Route.useParams()
  const navigate = useNavigate()
  const detail = useNotebookDetail(notebookId)
  const messagesQuery = useNotebookMessages(notebookId)

  if (detail.isPending && !detail.data) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col p-24 md:p-32">
        <p className="text-body text-on-surface-muted">Loading…</p>
      </div>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col p-24 md:p-32">
        <ErrorState
          title="Notebook not found"
          description="It might have been deleted."
          action={
            <Button
              variant="secondary"
              onClick={() => navigate({ to: '/notebooks' })}
            >
              Back to notebooks
            </Button>
          }
        />
      </div>
    )
  }

  const { notebook, sources } = detail.data
  const messages = messagesQuery.data?.messages ?? []
  const [hoveredSourceId, setHoveredSourceId] = React.useState<string | null>(
    null,
  )

  return (
    <div className="mx-auto flex h-[calc(100dvh-64px)] w-full max-w-6xl flex-col gap-12 p-16 md:h-[calc(100dvh-128px)] md:p-24">
      <button
        type="button"
        onClick={() => navigate({ to: '/notebooks' })}
        className="flex items-center gap-4 self-start text-caption text-on-surface-muted hover:text-on-surface"
      >
        <ArrowLeft className="h-12 w-12" aria-hidden="true" />
        Back
      </button>

      <NotebookTitle
        notebookId={notebookId}
        title={notebook.title}
        description={notebook.description}
      />

      <div className="grid min-h-0 flex-1 gap-16 md:grid-cols-[280px_1fr]">
        <SourcesPanel
          notebookId={notebookId}
          sources={sources}
          highlightedId={hoveredSourceId}
        />
        <ConversationPane
          notebookId={notebookId}
          messages={messages}
          onCitationHover={setHoveredSourceId}
        />
      </div>
    </div>
  )
}

// ─── Title (inline editable) ───────────────────────────────────────────────

function NotebookTitle({
  notebookId,
  title,
  description,
}: {
  notebookId: string
  title: string
  description: string | null
}) {
  const update = useUpdateNotebook()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setDraft(title)
  }, [title])

  React.useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function commit() {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === title) {
      setDraft(title)
      return
    }
    try {
      await update.mutateAsync({ id: notebookId, title: next })
    } catch {
      setDraft(title)
    }
  }

  function cancel() {
    setDraft(title)
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') cancel()
          }}
          className={cn(
            'rounded-md bg-transparent px-0 font-display text-headline font-medium tracking-tight text-on-surface',
            'border-0 outline-none',
          )}
          maxLength={120}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="self-start text-left font-display text-headline font-medium tracking-tight text-on-surface hover:opacity-80"
        >
          {title}
        </button>
      )}
      <p className="text-body text-on-surface-muted">
        {description ?? "Drop in files or just ask. The assistant searches the web when needed."}
      </p>
    </div>
  )
}

// ─── Sources panel ─────────────────────────────────────────────────────────

function SourcesPanel({
  notebookId,
  sources,
  highlightedId,
}: {
  notebookId: string
  sources: NotebookSource[]
  highlightedId: string | null
}) {
  const upload = useUploadSource(notebookId)
  const del = useDeleteSource(notebookId)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  async function ingest(files: File[]) {
    setError(null)
    for (const file of files) {
      try {
        setProgress(`Reading ${file.name}…`)
        const extracted = await extractFile(file)
        setProgress(`Embedding ${file.name}…`)
        await upload.mutateAsync({
          filename: extracted.filename,
          mimeType: extracted.mimeType,
          sizeBytes: extracted.sizeBytes,
          text: extracted.text,
        })
        setProgress(null)
      } catch (err) {
        setProgress(null)
        setError(
          err instanceof UnsupportedFileError ||
            err instanceof EmptyFileError
            ? err.message
            : err instanceof Error
              ? err.message
              : `Couldn't upload ${file.name}.`,
        )
        break
      }
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) ingest(files)
  }

  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col gap-12 rounded-lg border border-border bg-surface p-12',
        'transition-colors duration-fast ease-standard',
        dragging && 'border-primary bg-primary-container/30',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-label font-semibold text-on-surface">Sources</h2>
        <span className="text-caption text-on-surface-muted">
          {sources.length}
        </span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending || progress !== null}
        className={cn(
          'flex items-center justify-center gap-8 rounded-md border border-dashed border-border px-12 py-12 text-caption text-on-surface-muted',
          'transition-colors duration-fast ease-standard',
          'hover:border-primary hover:text-primary disabled:opacity-50',
        )}
      >
        <Upload className="h-12 w-12" aria-hidden="true" />
        {progress ?? 'Add file or drag here'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files
          if (list) ingest(Array.from(list))
        }}
      />

      {error && (
        <p className="text-caption text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {sources.length === 0 ? (
          <p className="text-caption text-on-surface-muted">
            No sources yet. Upload a file or just ask — the assistant
            will pull in references from the web when needed.
          </p>
        ) : (
          <ul className="anim-stagger flex flex-col gap-4">
            {sources.map((s, i) => (
              <SourceRow
                key={s.id}
                source={s}
                onDelete={() => del.mutateAsync(s.id)}
                deleting={del.isPending}
                highlighted={highlightedId === s.id}
                index={i}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

function SourceRow({
  source,
  onDelete,
  deleting,
  highlighted,
  index,
}: {
  source: NotebookSource
  onDelete: () => Promise<void>
  deleting: boolean
  highlighted: boolean
  index: number
}) {
  const [confirming, setConfirming] = React.useState(false)

  async function handleClick() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    await onDelete()
  }

  const isWeb = source.kind === 'web'
  const Icon = isWeb ? Globe : FileText
  const subtitle = isWeb
    ? hostnameOf(source.url ?? '')
    : `${source.chunkCount} chunk${source.chunkCount === 1 ? '' : 's'}${
        source.sizeBytes ? ` · ${formatBytes(source.sizeBytes)}` : ''
      }`

  // For web sources, the row is a clickable link; for files it's a
  // plain row. Either way the trash button stops propagation.
  const RowTag = isWeb && source.url ? 'a' : 'div'
  const rowProps = isWeb && source.url
    ? {
        href: source.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      }
    : {}

  return (
    <li style={{ ['--anim-i' as string]: index }}>
      <RowTag
        {...rowProps}
        className={cn(
          'group relative flex items-center gap-8 rounded-md py-8 pl-12 pr-8',
          'transition-colors duration-fast ease-standard',
          'hover:bg-surface-variant',
          isWeb && 'cursor-pointer',
          highlighted && 'bg-surface-variant',
        )}
      >
        {/* Left accent bar — only visible when this row is the
            currently-highlighted citation target. Slides in smoothly. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-0 top-8 bottom-8 w-[3px] rounded-full bg-primary',
            'origin-top scale-y-0 transition-transform duration-fast ease-standard',
            highlighted && 'scale-y-100',
          )}
        />
        <Icon
          className={cn(
            'h-16 w-16 shrink-0',
            isWeb ? 'text-primary' : 'text-on-surface-muted',
          )}
          aria-hidden="true"
        />
        <div className="flex flex-1 flex-col gap-4 truncate">
          <span className="truncate text-caption font-medium text-on-surface">
            {source.filename}
          </span>
          <span className="truncate text-caption text-on-surface-muted">
            {subtitle}
          </span>
        </div>

        {isWeb && source.url && (
          <ExternalLink
            className="h-12 w-12 shrink-0 text-on-surface-muted opacity-0 group-hover:opacity-100"
            aria-hidden="true"
          />
        )}

        {confirming ? (
          <div
            className="flex shrink-0 items-center gap-4"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <button
              type="button"
              onClick={handleClick}
              disabled={deleting}
              className="rounded-md px-8 py-4 text-caption font-medium text-error hover:bg-error/10"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-8 py-4 text-caption text-on-surface-muted hover:bg-surface"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleClick()
            }}
            aria-label={`Delete ${source.filename}`}
            className={cn(
              'inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-md',
              'opacity-0 transition-opacity',
              'group-hover:opacity-100 focus-visible:opacity-100',
              'hover:bg-on-surface/10',
            )}
          >
            <Trash2 className="h-12 w-12" aria-hidden="true" />
          </button>
        )}
      </RowTag>
    </li>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ─── Conversation pane ─────────────────────────────────────────────────────

function ConversationPane({
  notebookId,
  messages,
  onCitationHover,
}: {
  notebookId: string
  messages: NotebookMessage[]
  onCitationHover: (sourceId: string | null) => void
}) {
  const ask = useAskNotebook(notebookId)
  const [question, setQuestion] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Autoscroll on new turn or pending state.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, ask.isPending])

  // Auto-resize textarea.
  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [question])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const q = question.trim()
    if (!q || ask.isPending) return
    setQuestion('')
    ask.mutate(q)
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-12 rounded-lg border border-border bg-surface p-16">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !ask.isPending ? (
          <EmptyState onPrompt={(p) => setQuestion(p)} />
        ) : (
          <ul className="flex flex-col gap-16">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onCitationHover={onCitationHover}
              />
            ))}
            {ask.isPending && (
              <li className="flex justify-start">
                <p className="rounded-lg bg-surface-variant px-12 py-8 text-body text-on-surface-muted">
                  Thinking…
                </p>
              </li>
            )}
            {ask.isError && (
              <li className="flex justify-start">
                <p className="rounded-lg bg-surface-variant px-12 py-8 text-body text-error">
                  {ask.error instanceof Error
                    ? ask.error.message
                    : 'Failed to ask.'}
                </p>
              </li>
            )}
          </ul>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className={cn(
          'flex items-end gap-8 rounded-lg border border-border bg-surface px-12 py-8',
          'transition-colors duration-fast ease-standard',
          'focus-within:border-on-surface-muted',
        )}
      >
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="Ask anything, or request fresh research…"
          disabled={ask.isPending}
          rows={1}
          aria-label="Question"
          className={cn(
            'flex-1 resize-none border-0 bg-transparent text-body text-on-surface placeholder:text-on-surface-muted',
            'outline-none focus:outline-none',
            'disabled:opacity-50',
          )}
        />
        <button
          type="submit"
          disabled={!question.trim() || ask.isPending}
          aria-label="Send question"
          className={cn(
            'inline-flex h-32 w-32 shrink-0 items-center justify-center rounded-md',
            'bg-primary text-on-primary',
            'transition-opacity duration-fast ease-standard',
            'hover:opacity-90',
            'disabled:cursor-not-allowed disabled:opacity-30',
          )}
        >
          <ArrowUp className="h-16 w-16" aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}

function EmptyState({
  onPrompt,
}: {
  onPrompt: (prompt: string) => void
}) {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div className="flex max-w-sm flex-col gap-12">
        <p className="text-body text-on-surface-muted">
          Upload a file on the left to ground answers in your own
          documents, or just ask — the assistant will pull in web
          sources when it needs them.
        </p>
        <ul className="flex flex-col gap-4 text-caption text-on-surface-muted">
          <SuggestedPrompt
            onClick={onPrompt}
            text="Summarize the sources in this notebook"
          />
          <SuggestedPrompt
            onClick={onPrompt}
            text="Latest research on large language models in 2025"
          />
          <SuggestedPrompt
            onClick={onPrompt}
            text="Compare FastAPI vs Express for building a REST API"
          />
        </ul>
      </div>
    </div>
  )
}

function SuggestedPrompt({
  text,
  onClick,
}: {
  text: string
  onClick: (text: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onClick(text)}
        className="rounded-md px-12 py-8 text-caption text-on-surface-muted hover:bg-surface-variant hover:text-on-surface"
      >
        {text}
      </button>
    </li>
  )
}

function MessageBubble({
  message,
  onCitationHover,
}: {
  message: NotebookMessage
  onCitationHover: (sourceId: string | null) => void
}) {
  if (message.role === 'user') {
    return (
      <li className="flex justify-end anim-fade-in">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary-container px-12 py-8 text-body text-on-primary-container">
          {message.content}
        </div>
      </li>
    )
  }

  return (
    <li className="flex justify-start anim-fade-in">
      <div className="max-w-[90%] flex-1 rounded-lg bg-surface-variant px-12 py-8">
        <MarkdownMessage
          content={message.content}
          citations={message.citations.map((c) => ({
            sourceId: c.sourceId,
            sourceFilename: c.sourceFilename,
            sourceKind: c.sourceKind,
            sourceUrl: c.sourceUrl,
            chunkIndex: c.chunkIndex,
            snippet: c.snippet,
          }))}
          onCitationHover={onCitationHover}
        />
      </div>
    </li>
  )
}
