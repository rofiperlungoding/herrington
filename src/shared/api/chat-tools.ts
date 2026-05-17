/**
 * Frontend-facing types for chat tool events.
 *
 * The shape mirrors the server-side ToolEvent in
 * `netlify/edge-functions/chat.ts`. We keep two copies (one Deno-friendly,
 * one browser-friendly) instead of importing across the runtime boundary
 * because the Deno edge code can't import directly from `src/shared`
 * without a build step, and `src/` can't import from `netlify/` either.
 *
 * Add a new tool here, in `chat.ts`'s ToolEvent union, AND in the
 * Apps Script bridge (`Code.gs`) when expanding the integration.
 */

export type ToolEvent =
  | WebSearchEvent
  | ListUnreadEmailsEvent
  | SearchEmailsEvent
  | CheckCalendarAvailabilityEvent
  | CreateCalendarEventEvent
  | CreateDocEvent

export interface WebSearchEvent {
  kind: 'web_search'
  status: 'success' | 'error'
  args: { query: string; time_range?: string }
  data?: {
    answer?: string
    results: Array<{
      title: string
      url: string
      snippet: string
      publishedDate?: string
    }>
  }
  error?: string
}

export interface ListUnreadEmailsEvent {
  kind: 'list_unread_emails'
  status: 'success' | 'error'
  args: { max?: number }
  /** Which connected Google account this result came from. */
  accountLabel?: string
  data?: {
    messages: Array<{
      id: string
      from: string
      subject: string
      receivedAtSec: number
      snippet: string
    }>
  }
  error?: string
}

export interface SearchEmailsEvent {
  kind: 'search_emails'
  status: 'success' | 'error'
  args: { query: string; max?: number }
  accountLabel?: string
  data?: {
    query: string
    messages: Array<{
      id: string
      from: string
      subject: string
      receivedAtSec: number
      snippet: string
      isUnread: boolean
    }>
  }
  error?: string
}

export interface CheckCalendarAvailabilityEvent {
  kind: 'check_calendar_availability'
  status: 'success' | 'error'
  args: { startSec: number; endSec: number }
  accountLabel?: string
  data?: {
    events: Array<{
      id: string
      title: string
      startSec: number
      endSec: number
    }>
    isFree: boolean
  }
  error?: string
}

export interface CreateCalendarEventEvent {
  kind: 'create_calendar_event'
  status: 'success' | 'error'
  args: {
    title: string
    startSec: number
    endSec?: number
    description?: string
  }
  accountLabel?: string
  data?: {
    id: string
    title: string
    startSec: number
    endSec: number
    htmlLink?: string
  }
  error?: string
}

export interface CreateDocEvent {
  kind: 'create_doc'
  status: 'success' | 'error'
  args: { title: string; folderId?: string }
  accountLabel?: string
  data?: {
    id: string
    url: string
    warning?: string
  }
  error?: string
}

/**
 * Type guard so consumers can narrow `unknown[]` from the wire schema
 * down to typed events without sprinkling shape checks.
 */
export function isToolEvent(value: unknown): value is ToolEvent {
  if (!value || typeof value !== 'object') return false
  const obj = value as { kind?: unknown; status?: unknown }
  return (
    typeof obj.kind === 'string' &&
    typeof obj.status === 'string' &&
    (obj.kind === 'web_search' ||
      obj.kind === 'list_unread_emails' ||
      obj.kind === 'search_emails' ||
      obj.kind === 'check_calendar_availability' ||
      obj.kind === 'create_calendar_event' ||
      obj.kind === 'create_doc')
  )
}
