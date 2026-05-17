import * as React from 'react'
import { ExternalLink, MapPin, Clock, AlertCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  type CheckCalendarAvailabilityEvent,
  type CreateCalendarEventEvent,
  type CreateDocEvent,
  type ListUnreadEmailsEvent,
  type SearchEmailsEvent,
  type ToolEvent,
  type WebSearchEvent,
} from '@/shared/api/chat-tools'

import {
  CalendarIcon,
  DocsIcon,
  GmailIcon,
  SearchIcon,
} from './GoogleIcons'

/**
 * Gemini-style tool-event card.
 *
 * Renders each structured event the assistant produced in this turn
 * as a self-contained card with a Google product icon header and a
 * body shaped to the event kind. Failures collapse to a single
 * inline error pill so the user always sees what went wrong without
 * the assistant having to surface it in the markdown body.
 */
export function ToolEventCard({ event }: { event: ToolEvent }) {
  if (event.status === 'error') {
    return <ErrorCard event={event} />
  }

  switch (event.kind) {
    case 'web_search':
      return <WebSearchCard event={event} />
    case 'list_unread_emails':
      return <EmailsCard event={event} />
    case 'search_emails':
      return <SearchEmailsCard event={event} />
    case 'check_calendar_availability':
      return <AvailabilityCard event={event} />
    case 'create_calendar_event':
      return <EventCreatedCard event={event} />
    case 'create_doc':
      return <DocCard event={event} />
  }
}

// ─── Header ────────────────────────────────────────────────────────────────

function CardHeader({
  icon,
  label,
  meta,
  accountLabel,
}: {
  icon: React.ReactNode
  label: string
  meta?: string
  /** Connected Workspace account this card came from. */
  accountLabel?: string
}) {
  return (
    <div className="flex items-center gap-12 border-b border-border bg-surface-variant/40 px-16 py-12">
      <span className="shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-label font-medium text-on-surface">
          {label}
        </span>
        {meta && (
          <span className="truncate text-caption text-on-surface-muted">
            {meta}
          </span>
        )}
      </div>
      {accountLabel && (
        <span className="shrink-0 inline-flex items-center rounded-pill bg-brand-conservatory px-8 py-2 text-caption font-medium text-brand-brass">
          {accountLabel}
        </span>
      )}
    </div>
  )
}

function CardShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-surface',
        'anim-fade-in',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ─── Web search ────────────────────────────────────────────────────────────

function WebSearchCard({ event }: { event: WebSearchEvent }) {
  const results = event.data?.results ?? []
  return (
    <CardShell>
      <CardHeader
        icon={<SearchIcon size={20} />}
        label="Google Search"
        meta={event.args.query}
      />
      <ul className="divide-y divide-border">
        {results.slice(0, 4).map((r, i) => (
          <li key={`${r.url}-${i}`} className="px-16 py-12">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-4 hover:underline"
            >
              <span className="truncate text-label font-medium text-on-surface">
                {r.title || hostnameOf(r.url)}
              </span>
              <span className="truncate text-caption text-on-surface-muted">
                {hostnameOf(r.url)}
              </span>
              {r.snippet && (
                <span className="line-clamp-2 text-caption text-on-surface-muted">
                  {r.snippet}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── Gmail ─────────────────────────────────────────────────────────────────

function EmailsCard({ event }: { event: ListUnreadEmailsEvent }) {
  const messages = event.data?.messages ?? []
  return (
    <CardShell>
      <CardHeader
        icon={<GmailIcon size={20} />}
        label="Gmail"
        meta={`${messages.length} unread`}
        accountLabel={event.accountLabel}
      />
      {messages.length === 0 ? (
        <p className="px-16 py-12 text-caption text-on-surface-muted">
          Inbox is empty.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-col gap-4 px-16 py-12">
              <div className="flex items-baseline justify-between gap-12">
                <span className="truncate text-label font-medium text-on-surface">
                  {senderName(m.from)}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-on-surface-muted">
                  {formatRelative(m.receivedAtSec)}
                </span>
              </div>
              <span className="truncate text-caption text-on-surface">
                {m.subject}
              </span>
              {m.snippet && (
                <span className="line-clamp-2 text-caption text-on-surface-muted">
                  {m.snippet}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

// ─── Gmail (search) ────────────────────────────────────────────────────────

function SearchEmailsCard({ event }: { event: SearchEmailsEvent }) {
  const messages = event.data?.messages ?? []
  const query = event.data?.query ?? event.args.query
  return (
    <CardShell>
      <CardHeader
        icon={<GmailIcon size={20} />}
        label="Gmail search"
        meta={
          messages.length === 0
            ? `No matches for "${query}"`
            : `${messages.length} match${messages.length === 1 ? '' : 'es'} · ${query}`
        }
        accountLabel={event.accountLabel}
      />
      {messages.length === 0 ? (
        <p className="px-16 py-12 text-caption text-on-surface-muted">
          Nothing matched. Try a broader query.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-col gap-4 px-16 py-12">
              <div className="flex items-baseline justify-between gap-12">
                <span
                  className={cn(
                    'truncate text-label',
                    m.isUnread
                      ? 'font-semibold text-on-surface'
                      : 'font-medium text-on-surface',
                  )}
                >
                  {senderName(m.from)}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-on-surface-muted">
                  {formatRelative(m.receivedAtSec)}
                </span>
              </div>
              <span
                className={cn(
                  'truncate text-caption',
                  m.isUnread ? 'text-on-surface' : 'text-on-surface-muted',
                )}
              >
                {m.subject}
              </span>
              {m.snippet && (
                <span className="line-clamp-2 text-caption text-on-surface-muted">
                  {m.snippet}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

// ─── Calendar availability ─────────────────────────────────────────────────

function AvailabilityCard({
  event,
}: {
  event: CheckCalendarAvailabilityEvent
}) {
  const events = event.data?.events ?? []
  const isFree = event.data?.isFree ?? false
  return (
    <CardShell>
      <CardHeader
        icon={<CalendarIcon size={20} />}
        label="Google Calendar"
        meta={
          isFree
            ? 'Free during this window'
            : `${events.length} event${events.length === 1 ? '' : 's'}`
        }
        accountLabel={event.accountLabel}
      />
      {events.length === 0 ? (
        <p className="px-16 py-12 text-caption text-on-surface-muted">
          {formatWindow(event.args.startSec, event.args.endSec)} — nothing
          scheduled.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-4 px-16 py-12">
              <span className="truncate text-label font-medium text-on-surface">
                {e.title}
              </span>
              <div className="flex items-center gap-8 text-caption text-on-surface-muted">
                <Clock className="h-12 w-12" aria-hidden="true" />
                <span>{formatWindow(e.startSec, e.endSec)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

// ─── Calendar event created ────────────────────────────────────────────────

function EventCreatedCard({ event }: { event: CreateCalendarEventEvent }) {
  const data = event.data
  if (!data) return null
  return (
    <CardShell>
      <CardHeader
        icon={<CalendarIcon size={20} />}
        label="Google Calendar"
        meta="Event added"
        accountLabel={event.accountLabel}
      />
      <div className="flex flex-col gap-8 px-16 py-12">
        <span className="text-label font-medium text-on-surface">
          {data.title}
        </span>
        <div className="flex items-center gap-8 text-caption text-on-surface-muted">
          <Clock className="h-12 w-12" aria-hidden="true" />
          <span>{formatWindow(data.startSec, data.endSec)}</span>
        </div>
        {event.args.description && (
          <p className="line-clamp-3 text-caption text-on-surface-muted">
            {event.args.description}
          </p>
        )}
        {data.htmlLink && (
          <a
            href={data.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-4 self-start text-caption text-primary hover:underline"
          >
            Open in Google Calendar
            <ExternalLink className="h-12 w-12" aria-hidden="true" />
          </a>
        )}
      </div>
    </CardShell>
  )
}

// ─── Doc ───────────────────────────────────────────────────────────────────

function DocCard({ event }: { event: CreateDocEvent }) {
  const data = event.data
  if (!data) return null
  return (
    <CardShell>
      <CardHeader
        icon={<DocsIcon size={20} />}
        label="Google Docs"
        meta="Document created"
        accountLabel={event.accountLabel}
      />
      <div className="flex flex-col gap-8 px-16 py-12">
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-between gap-12 text-label font-medium text-on-surface hover:underline"
        >
          <span className="truncate">{event.args.title}</span>
          <ExternalLink className="h-16 w-16 shrink-0 text-on-surface-muted" aria-hidden="true" />
        </a>
        {data.warning && (
          <p className="text-caption text-on-surface-muted">
            ⚠ {data.warning}
          </p>
        )}
      </div>
    </CardShell>
  )
}

// ─── Errors ────────────────────────────────────────────────────────────────

function ErrorCard({ event }: { event: ToolEvent }) {
  const label = TOOL_LABELS[event.kind]
  const Icon = TOOL_ICONS[event.kind]
  // Workspace tool errors carry the account label that failed; web_search
  // doesn't, so the cast is safe at runtime.
  const accountLabel =
    'accountLabel' in event ? event.accountLabel : undefined
  return (
    <CardShell className="border-error/50">
      <CardHeader
        icon={<Icon size={20} />}
        label={label}
        meta="Failed"
        accountLabel={accountLabel}
      />
      <div className="flex items-start gap-8 px-16 py-12">
        <AlertCircle
          className="mt-4 h-16 w-16 shrink-0 text-error"
          aria-hidden="true"
        />
        <p className="text-caption text-on-surface-muted">
          {event.error ?? 'The action could not be completed.'}
        </p>
      </div>
    </CardShell>
  )
}

const TOOL_LABELS: Record<ToolEvent['kind'], string> = {
  web_search: 'Google Search',
  list_unread_emails: 'Gmail',
  search_emails: 'Gmail search',
  check_calendar_availability: 'Google Calendar',
  create_calendar_event: 'Google Calendar',
  create_doc: 'Google Docs',
}

const TOOL_ICONS: Record<
  ToolEvent['kind'],
  (props: { size?: number }) => React.ReactElement
> = {
  web_search: SearchIcon,
  list_unread_emails: GmailIcon,
  search_emails: GmailIcon,
  check_calendar_availability: CalendarIcon,
  create_calendar_event: CalendarIcon,
  create_doc: DocsIcon,
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function senderName(from: string): string {
  // "Foo Bar <foo@bar.com>" → "Foo Bar"
  const m = /^(.+?)\s*<.+>$/.exec(from)
  if (m) return m[1].replace(/^"|"$/g, '').trim()
  return from
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatRelative(unixSec: number): string {
  const dt = Date.now() / 1000 - unixSec
  if (dt < 60) return 'now'
  if (dt < 3600) return `${Math.floor(dt / 60)}m`
  if (dt < 86400) return `${Math.floor(dt / 3600)}h`
  return `${Math.floor(dt / 86400)}d`
}

function formatWindow(startSec: number, endSec: number): string {
  if (!startSec) return ''
  const start = new Date(startSec * 1000)
  const end = endSec ? new Date(endSec * 1000) : null
  const sameDay =
    end &&
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()

  const datePart = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const startTime = start.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  if (!end) return `${datePart} · ${startTime}`
  const endTime = end.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  if (sameDay) return `${datePart} · ${startTime} – ${endTime}`
  return `${datePart} ${startTime} → ${end.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

// MapPin is exported in case future tool events need a location row;
// keep it in the import list above so the linter knows it's intentional.
void MapPin
