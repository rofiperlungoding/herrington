import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkdownMessage } from '@/components/ui/markdown-message'
import { AccountToggleBar } from '@/components/chat/AccountToggleBar'
import { ToolEventCard } from '@/components/chat/ToolEventCard'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import {
  sessionsQueryOptions,
  useChatSessions,
  useCreateSession,
  useDeleteSession,
  useSendMessage,
  useSessionMessages,
  type ChatMessage,
  type ChatSession,
} from '@/hooks/useChat'
import { isToolEvent } from '@/shared/api/chat-tools'
import { cn } from '@/lib/utils'

/**
 * AI Chat page (`/chat`) — multi-session, ChatGPT-style.
 *
 * Layout:
 *   [Sidebar: list of sessions]  [Main: active session conversation]
 *
 * The sidebar is a borderless ambient list. Each row is one line —
 * truncated title + delete affordance on hover. Active row is shown
 * with a subtle surface-variant background; no card chrome around the
 * list itself, so it sits next to the conversation card without the
 * "boxes inside boxes" feel.
 *
 * On mobile (< 768px) the sidebar collapses behind a "Sessions" toggle
 * in the header; tapping a session selects it and dismisses the
 * overlay.
 */
export const Route = createFileRoute('/_authed/chat')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(sessionsQueryOptions).catch(() => {
      // Allow component to mount; UI will show error state if needed.
    }),
  component: ChatPage,
})

// Inline width — Tailwind's default w-* scale would map to spacing tokens
// that don't include 240 in this project, so we use an arbitrary value to
// keep the sidebar consistently 240px wide on desktop.
const SIDEBAR_WIDTH = 'w-[240px]'

function ChatPage() {
  const sessions = useChatSessions()
  const createSession = useCreateSession()
  const deleteSession = useDeleteSession()

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  const sessionList = sessions.data?.sessions ?? []

  // Auto-select the most-recent session when sessions load and none is
  // active; if the active session disappears (deleted) fall back to the
  // newest remaining one.
  React.useEffect(() => {
    if (!activeId && sessionList.length > 0) {
      setActiveId(sessionList[0].id)
    }
    if (activeId && !sessionList.some((s) => s.id === activeId)) {
      setActiveId(sessionList[0]?.id ?? null)
    }
  }, [sessionList, activeId])

  async function handleNewChat() {
    if (createSession.isPending) return
    const created = await createSession.mutateAsync()
    setActiveId(created.id)
    setSidebarOpen(false)
  }

  function handleSelect(id: string) {
    setActiveId(id)
    setSidebarOpen(false)
  }

  async function handleDelete(id: string) {
    if (deleteSession.isPending) return
    await deleteSession.mutateAsync(id)
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-64px)] w-full max-w-5xl flex-col gap-16 p-16 md:h-[calc(100dvh-128px)] md:p-24">
      <header className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-12">
          <p className="text-caption uppercase tracking-wider text-on-surface-muted">
            Conversation
          </p>
          <div className="flex items-center gap-4">
            <Button
              variant="text"
              onClick={() => setSidebarOpen((v) => !v)}
              className="md:hidden"
            >
              {sidebarOpen ? 'Close' : 'Sessions'}
            </Button>
            <Button
              variant="text"
              onClick={handleNewChat}
              disabled={createSession.isPending}
            >
              <Plus className="h-16 w-16" aria-hidden="true" />
              New chat
            </Button>
          </div>
        </div>
        <h1 className="font-display font-medium tracking-tight text-on-surface text-headline leading-[1.15] md:text-display md:leading-[1.05]">
          Assistant
        </h1>
        <p className="text-body text-on-surface-muted">
          One thread per conversation. Each one has its own context.
        </p>
      </header>
      <div className="relative flex min-h-0 flex-1 gap-16">
        {/* Sessions sidebar — borderless, ambient. */}
        <aside
          className={cn(
            'flex shrink-0 flex-col gap-4 overflow-y-auto anim-stagger',
            SIDEBAR_WIDTH,
            // Mobile: overlay when toggled; hidden by default.
            'md:relative md:flex',
            sidebarOpen
              ? 'absolute inset-0 z-10 w-full bg-surface p-8'
              : 'hidden md:flex',
          )}
        >
          {sessions.isPending && sessionList.length === 0 ? (
            <p className="px-12 py-8 text-caption text-on-surface-muted">
              A moment…
            </p>
          ) : sessionList.length === 0 ? (
            <p className="px-12 py-8 text-caption text-on-surface-muted">
              No threads yet.
            </p>
          ) : (
            sessionList.map((s, i) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeId}
                onSelect={() => handleSelect(s.id)}
                onDelete={() => handleDelete(s.id)}
                deleting={deleteSession.isPending}
                index={i}
              />
            ))
          )}
        </aside>

        {/* Active conversation */}
        <main className="flex min-h-0 flex-1 flex-col gap-12">
          {activeId ? (
            <ConversationPane key={activeId} sessionId={activeId} />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface p-24 text-center">
              <div className="flex max-w-sm flex-col gap-12">
                <p className="text-body text-on-surface-muted">
                  Start a new thread when you're ready.
                </p>
                <Button
                  variant="primary"
                  onClick={handleNewChat}
                  disabled={createSession.isPending}
                  loading={createSession.isPending}
                >
                  <Plus className="h-16 w-16" aria-hidden="true" />
                  New chat
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// ─── Sidebar row ────────────────────────────────────────────────────────────

/**
 * A single conversation entry in the sidebar.
 *
 * One-line layout: truncated title, delete trash on hover, inline
 * "Yes / No" confirmation when armed. No timestamp, no second line —
 * the row stays minimal so longer titles don't push the list height.
 */
function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
  deleting,
  index,
}: {
  session: ChatSession
  active: boolean
  onSelect: () => void
  onDelete: () => void
  deleting: boolean
  index: number
}) {
  const [confirming, setConfirming] = React.useState(false)

  // Reset confirmation if the row becomes inactive (user picked another
  // session) so re-opening this one doesn't show a stale Yes/No state.
  React.useEffect(() => {
    if (!active) setConfirming(false)
  }, [active])

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirming) {
      setConfirming(true)
      return
    }
    onDelete()
  }

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      style={{ ['--anim-i' as string]: index }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group flex h-40 cursor-pointer items-center gap-8 rounded-md px-12',
        'transition-colors duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        active
          ? 'bg-surface-variant text-on-surface'
          : 'text-on-surface-muted hover:bg-surface-variant hover:text-on-surface',
      )}
    >
      <span className="flex-1 truncate text-label">{session.title}</span>

      {confirming ? (
        <div
          className="flex shrink-0 items-center gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={deleting}
            className="rounded-md px-8 py-4 text-caption font-medium text-error hover:bg-error/10"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(false)
            }}
            className="rounded-md px-8 py-4 text-caption text-on-surface-muted hover:bg-surface"
          >
            No
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleDeleteClick}
          aria-label={`Delete ${session.title}`}
          className={cn(
            'inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-md',
            'opacity-0 transition-opacity',
            'group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100',
            'hover:bg-on-surface/10',
          )}
        >
          <Trash2 className="h-16 w-16" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ─── Conversation pane ──────────────────────────────────────────────────────

function ConversationPane({ sessionId }: { sessionId: string }) {
  const sessions = useChatSessions()
  const messagesQuery = useSessionMessages(sessionId)
  const send = useSendMessage(sessionId)
  const [input, setInput] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const messages: ChatMessage[] = messagesQuery.data?.messages ?? []
  const session = sessions.data?.sessions.find((s) => s.id === sessionId) ?? null

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, send.isPending])

  // Reset error/input when switching sessions.
  React.useEffect(() => {
    setInput('')
    setError(null)
  }, [sessionId])

  // Soft progress hint while the assistant is producing a reply. The
  // reply is single-shot (no streaming yet) so we can't show real-time
  // tool-call status, but we can transition a label from "Thinking" to
  // "Working on it" after a few seconds so the user knows the request
  // is still in flight rather than stuck. Once we're past the 3.5s
  // mark we're likely waiting on a 429 retry, so say so honestly.
  const [pendingLabel, setPendingLabel] = React.useState<string | undefined>(
    undefined,
  )
  React.useEffect(() => {
    if (!send.isPending) {
      setPendingLabel(undefined)
      return
    }
    setPendingLabel(undefined)
    const t1 = window.setTimeout(() => setPendingLabel('Working on it'), 2500)
    const t2 = window.setTimeout(
      () => setPendingLabel('Provider is busy, retrying'),
      4500,
    )
    const t3 = window.setTimeout(
      () => setPendingLabel('Still trying, give it a sec'),
      8000,
    )
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [send.isPending])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || send.isPending) return

    setInput('')
    setError(null)
    send.mutate(trimmed, {
      onError: (err) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong sending the message.',
        )
      },
    })
  }

  return (
    <>
      {session && <AccountToggleBar session={session} />}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-surface p-16"
      >
        {messagesQuery.isPending && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body text-on-surface-muted">A moment…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="max-w-sm text-body text-on-surface-muted">
              A fresh thread. The assistant only remembers what you say here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-12">
            {messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'flex anim-fade-in',
                  m.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-12 py-8 text-body',
                    m.role === 'user'
                      ? 'whitespace-pre-wrap bg-primary-container text-on-primary-container'
                      : 'bg-surface-variant text-on-surface',
                  )}
                >
                  {m.role === 'assistant' ? (
                    <>
                      <MarkdownMessage
                        content={m.content}
                        citations={m.citations?.map((c) => ({
                          sourceId: c.url,
                          sourceFilename: c.title || hostnameOf(c.url),
                          sourceKind: 'web' as const,
                          sourceUrl: c.url,
                          snippet: c.snippet,
                        }))}
                      />
                      {m.toolEvents && m.toolEvents.length > 0 && (
                        <div className="mt-12 flex flex-col gap-8">
                          {m.toolEvents
                            .filter(isToolEvent)
                            .map((evt, i) => (
                              <ToolEventCard
                                key={`${m.id}-tool-${i}`}
                                event={evt}
                              />
                            ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              </li>
            ))}
            {send.isPending && (
              <li className="flex justify-start">
                <TypingIndicator label={pendingLabel} />
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-8">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={send.isPending}
          aria-label="Message"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!input.trim() || send.isPending}
          loading={send.isPending}
        >
          Send
        </Button>
      </form>
    </>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
