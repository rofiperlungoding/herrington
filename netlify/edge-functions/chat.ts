import { z } from 'zod';
import { nanoid } from 'nanoid';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import { buildSystemPrompt } from './_lib/skills/index.ts';
import { tavilySearch, TavilyOutOfKeysError, TavilyConfigError } from './_lib/tavily.ts';
import { aiChatHistory, chatSessions, userProfiles, workspaceConnections } from '../../src/shared/db/schema.ts';
import {
  type GoogleAction,
} from './_lib/google.ts';
import {
  dispatch as workspaceDispatch,
  loadConnections,
  parseEnabledIds,
  serializeEnabledIds,
  NoConnectionsError,
  UnknownLabelError,
  WriteFanoutError,
  type ConnectionRecord,
  type PerAccountResult,
} from './_lib/workspace.ts';

/**
 * Chat edge function — multi-session conversations stored in Turso.
 *
 * Routes (all under `/api/chat/...`, all require auth):
 *   GET    /api/chat/sessions                  → list user's sessions
 *   POST   /api/chat/sessions                  → create empty session
 *   PATCH  /api/chat/sessions/:id              → rename session
 *   DELETE /api/chat/sessions/:id              → delete session + messages
 *   GET    /api/chat/sessions/:id/messages     → list messages in session
 *   POST   /api/chat/sessions/:id/messages     → send message; get reply
 *
 * Each session has its own conversation context — Mistral only sees
 * the messages from the active session, never bleeds across sessions.
 */

const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const DEFAULT_MODEL = 'mistral-small-latest';

const SYSTEM_PROMPT = buildSystemPrompt();

/**
 * Context budgeting (per Memory Plan):
 *
 *   - RECENT_WINDOW = 6: send at most the last 6 messages verbatim
 *     (≈ 3 user/assistant pairs) so the upstream token bill stays flat
 *     even on long conversations.
 *   - SUMMARY_TRIGGER = 12: only start summarizing once the session has
 *     enough older messages that a summary actually buys us something.
 *     A higher trigger also keeps the request count lower on free
 *     tiers (Mistral rate-limits aggressively).
 *   - SUMMARY_BATCH = 4: refresh the summary lazily — only when at
 *     least this many new "older" messages have piled up since the
 *     last refresh. Otherwise reuse the cached summary.
 *
 * The summarization call is fire-and-forget: it runs AFTER the main
 * chat reply has been sent, so a 429 / network blip on the summary
 * never blocks the user's actual message.
 */
const RECENT_WINDOW = 6;
const SUMMARY_TRIGGER = 12;
const SUMMARY_BATCH = 4;

/**
 * How many tool-calling rounds the assistant is allowed before we
 * force a final answer. 3 is plenty: typical research questions
 * resolve in 1 search, multi-fact ones in 2. Round N+1 is forced
 * to answer without offering tools.
 */
const MAX_TOOL_ROUNDS = 3;

/**
 * OpenAI/Mistral-style tool descriptors. Mistral routes through its
 * `tools` parameter and `tool_choice='auto'` to decide when to call.
 * Keep the description concrete so the model knows when to reach for
 * the web vs answer from memory.
 */
const WEB_SEARCH_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the live web for facts, news, prices, schedules, recent events, or anything the model is unsure about or might be outdated on. Prefer this over guessing. Avoid for general knowledge / coding / opinions / chit-chat where your training data is sufficient.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'A focused web search query in English or the user language. Keep it short and specific (3-8 words usually).',
          },
          time_range: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description:
              'Optional recency filter. Use when the question implies recent events ("today", "this week", news, latest).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_unread_emails',
      description:
        "Read the user's most recent unread Gmail messages (subject, sender, snippet). Use ONLY when the user explicitly asks about email — e.g. \"what's in my inbox\", \"any unread emails\", \"summarise my emails\". Do not call when the user is just chatting.",
      parameters: {
        type: 'object',
        properties: {
          max: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'How many to fetch. Defaults to 5.',
          },
          account: {
            type: 'string',
            description:
              "Which connected Google account to use. Omit to use the user's primary account. Pass an account label (e.g. 'work', 'personal') to target a specific one. Pass 'all' ONLY when the user explicitly asks to look across every enabled account.",
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_emails',
      description:
        "Search the user's Gmail with full Gmail search syntax. Use this when the user asks to FIND a specific email or run a query — e.g. \"find that Stripe invoice\", \"any email from my landlord\", \"show emails from this week\", \"emails about flight booking\". Prefer this over list_unread_emails whenever the user gives any topic, sender, or time hint. Examples of good queries: 'from:stripe subject:invoice', 'from:netflix', 'subject:flight newer_than:30d', 'is:starred from:boss'.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "Gmail search query. Supports operators like from:, to:, subject:, has:attachment, is:unread, is:starred, newer_than:7d, before:2025/01/01.",
          },
          max: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'How many threads to fetch. Defaults to 8.',
          },
          account: {
            type: 'string',
            description:
              "Which connected Google account to search. Omit for the user's primary. Use a label ('work', 'personal') to target one. Use 'all' ONLY when the user explicitly says they want results across every enabled account.",
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_calendar_availability',
      description:
        "Check whether the user's Google Calendar has events in a given time window. Use when the user asks if they're free, busy, or has anything scheduled at a specific time.",
      parameters: {
        type: 'object',
        properties: {
          start_iso: {
            type: 'string',
            description:
              "ISO 8601 datetime for the start of the window in the user's local timezone (e.g., 2026-05-17T15:00:00+07:00).",
          },
          end_iso: {
            type: 'string',
            description: 'ISO 8601 datetime for the end of the window.',
          },
          account: {
            type: 'string',
            description:
              "Which connected Google account's calendar to check. Omit for the user's primary. Use a label to target a specific account. Use 'all' to check every enabled calendar.",
          },
        },
        required: ['start_iso', 'end_iso'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_calendar_event',
      description:
        "Create a new event in the user's Google Calendar. Use when the user asks to schedule, book, add, or remind them of something at a specific time.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short event title.' },
          start_iso: {
            type: 'string',
            description: 'ISO 8601 datetime for the start.',
          },
          end_iso: {
            type: 'string',
            description:
              'ISO 8601 datetime for the end. Optional — defaults to start + 1 hour when omitted.',
          },
          description: {
            type: 'string',
            description: 'Optional agenda or notes for the event body.',
          },
          account: {
            type: 'string',
            description:
              "Which connected Google account's calendar to create the event in. Omit for the user's primary. Use a label ('work', 'personal') to target one. NEVER use 'all' for create operations — pick a single account.",
          },
        },
        required: ['title', 'start_iso'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_doc',
      description:
        "Create a new Google Doc in the user's Drive with the given title and body. Use when the user asks to draft, write up, or save something as a document.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title.' },
          body: {
            type: 'string',
            description:
              'Document body. Plain text or markdown — markdown renders as plain text in Apps Script.',
          },
          folder_id: {
            type: 'string',
            description:
              "Optional Google Drive folder ID. When omitted, lands in the user's My Drive root.",
          },
          account: {
            type: 'string',
            description:
              "Which connected Google account's Drive to create the doc in. Omit for the user's primary. Use a label to target one. NEVER use 'all' for create operations.",
          },
        },
        required: ['title', 'body'],
      },
    },
  },
];

interface Citation {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Structured event captured for every tool invocation in an assistant
 * turn. The frontend renders these as Gemini-style cards (Calendar
 * events, email lists, Doc confirmations, etc) instead of dumping
 * raw URLs into the markdown body.
 *
 * `kind` matches the tool name. `status` distinguishes success from
 * a graceful failure (e.g. "Google Workspace not configured"). `data`
 * carries whatever payload the tool returned; the frontend type-narrows
 * by `kind` before rendering.
 */
export type ToolEvent =
  | {
      kind: 'web_search';
      status: 'success' | 'error';
      args: { query: string; time_range?: string };
      data?: {
        answer?: string;
        results: Array<{
          title: string;
          url: string;
          snippet: string;
          publishedDate?: string;
        }>;
      };
      error?: string;
    }
  | {
      kind: 'list_unread_emails';
      status: 'success' | 'error';
      args: { max?: number };
      /** Which connected Google account this result came from. */
      accountLabel?: string;
      data?: {
        messages: Array<{
          id: string;
          from: string;
          subject: string;
          receivedAtSec: number;
          snippet: string;
        }>;
      };
      error?: string;
    }
  | {
      kind: 'search_emails';
      status: 'success' | 'error';
      args: { query: string; max?: number };
      accountLabel?: string;
      data?: {
        query: string;
        messages: Array<{
          id: string;
          from: string;
          subject: string;
          receivedAtSec: number;
          snippet: string;
          isUnread: boolean;
        }>;
      };
      error?: string;
    }
  | {
      kind: 'check_calendar_availability';
      status: 'success' | 'error';
      args: { startSec: number; endSec: number };
      accountLabel?: string;
      data?: {
        events: Array<{
          id: string;
          title: string;
          startSec: number;
          endSec: number;
        }>;
        isFree: boolean;
      };
      error?: string;
    }
  | {
      kind: 'create_calendar_event';
      status: 'success' | 'error';
      args: {
        title: string;
        startSec: number;
        endSec?: number;
        description?: string;
      };
      accountLabel?: string;
      data?: {
        id: string;
        title: string;
        startSec: number;
        endSec: number;
        htmlLink?: string;
      };
      error?: string;
    }
  | {
      kind: 'create_doc';
      status: 'success' | 'error';
      args: { title: string; folderId?: string };
      accountLabel?: string;
      data?: {
        id: string;
        url: string;
        warning?: string;
      };
      error?: string;
    };

/**
 * Mistral chat-completion message types we round-trip in the
 * tool-calling loop. Includes assistant-with-tool_calls and tool
 * result messages.
 */
type ChatTurn =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: ToolCall[];
    }
  | {
      role: 'tool';
      tool_call_id: string;
      name: string;
      content: string;
    };

interface ToolCall {
  id: string;
  type?: string;
  function: {
    name: string;
    arguments: string;
  };
}

// ─── Routing ────────────────────────────────────────────────────────────────

type Route =
  | { type: 'list_sessions' }
  | { type: 'create_session' }
  | { type: 'rename_session'; id: string }
  | { type: 'delete_session'; id: string }
  | { type: 'list_messages'; sessionId: string }
  | { type: 'send_message'; sessionId: string };

function matchRoute(method: string, pathname: string): Route | null {
  const segments = pathname.split('/').filter(Boolean);

  // /api/chat/sessions
  if (
    segments.length === 3 &&
    segments[0] === 'api' &&
    segments[1] === 'chat' &&
    segments[2] === 'sessions'
  ) {
    if (method === 'GET') return { type: 'list_sessions' };
    if (method === 'POST') return { type: 'create_session' };
    return null;
  }

  // /api/chat/sessions/:id
  if (
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'chat' &&
    segments[2] === 'sessions'
  ) {
    const id = segments[3];
    if (!id) return null;
    if (method === 'PATCH') return { type: 'rename_session', id };
    if (method === 'DELETE') return { type: 'delete_session', id };
    return null;
  }

  // /api/chat/sessions/:id/messages
  if (
    segments.length === 5 &&
    segments[0] === 'api' &&
    segments[1] === 'chat' &&
    segments[2] === 'sessions' &&
    segments[4] === 'messages'
  ) {
    const sessionId = segments[3];
    if (!sessionId) return null;
    if (method === 'GET') return { type: 'list_messages', sessionId };
    if (method === 'POST') return { type: 'send_message', sessionId };
    return null;
  }

  return null;
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  title: string;
  summary: string | null;
  summaryThrough: number;
  /**
   * CSV of workspace_connections.id values. NULL means "use default
   * connection only". Empty string means the user explicitly disabled
   * every account for this conversation.
   */
  activeConnectionIds: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  citations: string | null;
  toolEvents: string | null;
  createdAt: Date;
}

function sessionToDto(row: SessionRow) {
  return {
    id: row.id,
    title: row.title,
    /**
     * Active connection IDs as an explicit array. `null` ⇒ default,
     * `[]` ⇒ explicitly disabled all, `[...ids]` ⇒ that set.
     */
    activeConnectionIds: parseEnabledIds(row.activeConnectionIds) ?? null,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
  };
}

function messageToDto(row: MessageRow) {
  let citations: Citation[] = [];
  if (row.citations) {
    try {
      const parsed = JSON.parse(row.citations);
      if (Array.isArray(parsed)) {
        citations = parsed.filter(
          (c): c is Citation =>
            typeof c === 'object' &&
            c !== null &&
            typeof c.title === 'string' &&
            typeof c.url === 'string',
        );
      }
    } catch {
      // tolerate corrupted citations payload — message text is the source of truth
    }
  }

  let toolEvents: ToolEvent[] = [];
  if (row.toolEvents) {
    try {
      const parsed = JSON.parse(row.toolEvents);
      if (Array.isArray(parsed)) {
        toolEvents = parsed.filter(
          (e): e is ToolEvent =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as { kind?: unknown }).kind === 'string' &&
            typeof (e as { status?: unknown }).status === 'string',
        );
      }
    } catch {
      // tolerate corruption — text body still carries the gist
    }
  }

  return {
    id: row.id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    citations,
    toolEvents,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve a session by id but only when it belongs to the auth'd user.
 * Throws 404 otherwise — never leaks the existence of another user's session.
 */
async function resolveOwnedSession(
  db: ReturnType<typeof createDrizzleClient>,
  auth: AuthContext,
  sessionId: string,
): Promise<SessionRow> {
  const row = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.userId, auth.userId),
      ),
    )
    .get();
  if (!row) {
    throw new HttpError(404, 'not_found', 'Session not found');
  }
  return row;
}

/**
 * Derive a short title from the first user message (max ~60 chars).
 */
function deriveTitle(message: string): string {
  const cleaned = message.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57).trimEnd() + '…';
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth = await requireAuth(req);

  const url = new URL(req.url);
  const route = matchRoute(req.method, url.pathname);

  if (!route) {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  switch (route.type) {
    case 'list_sessions':
      return handleListSessions(auth);
    case 'create_session':
      return handleCreateSession(auth);
    case 'rename_session':
      return handleRenameSession(req, auth, route.id);
    case 'delete_session':
      return handleDeleteSession(auth, route.id);
    case 'list_messages':
      return handleListMessages(auth, route.sessionId);
    case 'send_message':
      return handleSendMessage(req, auth, route.sessionId);
  }
});

// ─── Sessions ───────────────────────────────────────────────────────────────

async function handleListSessions(auth: AuthContext): Promise<Response> {
  const db = createDrizzleClient();
  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userId, auth.userId))
    .orderBy(desc(chatSessions.updatedAt))
    .all();
  return jsonResponse(200, { sessions: rows.map(sessionToDto) });
}

async function handleCreateSession(auth: AuthContext): Promise<Response> {
  const db = createDrizzleClient();
  const now = new Date();
  const session = {
    id: nanoid(),
    userId: auth.userId,
    title: 'New chat',
    summary: null as string | null,
    summaryThrough: 0,
    activeConnectionIds: null as string | null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(chatSessions).values(session).run();
  return jsonResponse(201, sessionToDto(session));
}

const RenameBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    /**
     * Connections enabled for this conversation. `null` ⇒ revert to
     * default (use only the user's primary). Array ⇒ exactly that set
     * of connection IDs is enabled. Empty array ⇒ explicitly disable
     * all (no Workspace tools allowed).
     */
    activeConnectionIds: z.array(z.string()).nullable().optional(),
  })
  .refine(
    (b) =>
      b.title !== undefined || b.activeConnectionIds !== undefined,
    { message: 'Provide at least one of `title` or `activeConnectionIds`.' },
  );

async function handleRenameSession(
  req: Request,
  auth: AuthContext,
  id: string,
): Promise<Response> {
  const body = RenameBody.parse(await req.json());
  const db = createDrizzleClient();

  // Build the patch incrementally so we don't accidentally null out
  // an unset column.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) patch.title = body.title;
  if (body.activeConnectionIds !== undefined) {
    patch.activeConnectionIds =
      body.activeConnectionIds === null
        ? null
        : serializeEnabledIds(body.activeConnectionIds);
  }

  const updated = await db
    .update(chatSessions)
    .set(patch)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)))
    .returning()
    .get();

  if (!updated) {
    throw new HttpError(404, 'not_found', 'Session not found');
  }
  return jsonResponse(200, sessionToDto(updated));
}

async function handleDeleteSession(
  auth: AuthContext,
  id: string,
): Promise<Response> {
  const db = createDrizzleClient();

  // Verify ownership first.
  await resolveOwnedSession(db, auth, id);

  // Delete messages, then the session itself. Order matters only for
  // observability; there is no FK between the two tables.
  await db
    .delete(aiChatHistory)
    .where(
      and(
        eq(aiChatHistory.sessionId, id),
        eq(aiChatHistory.userId, auth.userId),
      ),
    )
    .run();
  await db
    .delete(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, auth.userId)))
    .run();

  return new Response(null, { status: 204 });
}

// ─── Messages ───────────────────────────────────────────────────────────────

async function handleListMessages(
  auth: AuthContext,
  sessionId: string,
): Promise<Response> {
  const db = createDrizzleClient();

  // Verify the session is owned by this user before exposing its messages.
  await resolveOwnedSession(db, auth, sessionId);

  const rows = await db
    .select()
    .from(aiChatHistory)
    .where(
      and(
        eq(aiChatHistory.sessionId, sessionId),
        eq(aiChatHistory.userId, auth.userId),
        isNotNull(aiChatHistory.sessionId),
      ),
    )
    .orderBy(asc(aiChatHistory.createdAt))
    .all();

  return jsonResponse(200, { messages: rows.map(messageToDto) });
}

const SendBody = z.object({
  message: z.string().min(1).max(8000),
  /**
   * IANA timezone (e.g. "Asia/Jakarta"). Optional — falls back to UTC
   * if the client cannot resolve it. Used purely for the time-awareness
   * system prompt (current date/time injected per request); never
   * persisted.
   */
  timezone: z.string().min(1).max(64).optional(),
});

async function handleSendMessage(
  req: Request,
  auth: AuthContext,
  sessionId: string,
): Promise<Response> {
  const apiKey = Deno.env.get('MISTRAL_API_KEY');
  if (!apiKey) {
    console.error('[chat] MISTRAL_API_KEY is not set');
    throw new HttpError(
      500,
      'config_missing',
      'Chat is not configured on the server',
    );
  }

  const body = SendBody.parse(await req.json());
  const db = createDrizzleClient();

  const session = await resolveOwnedSession(db, auth, sessionId);

  // Look up the profile row so we can address the user by their preferred
  // name and acknowledge their focus areas. Best-effort — if the row
  // hasn't been created yet (first chat before visiting Settings), the
  // injected system message is simply omitted.
  const profileRow = await db
    .select({
      preferredName: userProfiles.preferredName,
      displayName: userProfiles.displayName,
      headline: userProfiles.headline,
      focusAreas: userProfiles.focusAreas,
      locationLabel: userProfiles.locationLabel,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, auth.userId))
    .get();

  // Workspace connections for this user, decrypted upfront so the
  // tool-calling loop below can fan out without re-querying. Empty
  // array means the user hasn't connected anything yet — tool calls
  // will return a graceful "not connected" message.
  const userConnections = await loadConnections(db, auth.userId);

  // Resolve which connections are enabled for this conversation. The
  // session row stores a CSV of connection IDs (`active_connection_ids`);
  // null means "use default", empty string means "all disabled".
  const enabledConnectionIds = parseEnabledIds(session.activeConnectionIds);

  // Persist user message first so it survives even if Mistral fails.
  const userMessage: MessageRow & { userId: string; sessionId: string } = {
    id: nanoid(),
    userId: auth.userId,
    sessionId,
    role: 'user' as const,
    content: body.message,
    citations: null,
    toolEvents: null,
    createdAt: new Date(),
  };
  await db.insert(aiChatHistory).values(userMessage).run();

  // Auto-derive a title from the first user message in the session
  // (only when the title is still the default 'New chat').
  let updatedSession = session;
  const isFirstMessage = session.title === 'New chat';
  if (!isFirstMessage) {
    // Bump updatedAt so the session sorts to the top of the sidebar.
    const renamed = await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
      .returning()
      .get();
    if (renamed) updatedSession = renamed;
  }

  // ─── Context budgeting ────────────────────────────────────────────────
  //
  // 1. Pull the full ordered message list for this session.
  // 2. Split into "older" (everything before the recent window) and
  //    "recent" (last RECENT_WINDOW messages).
  // 3. If we have more older messages than the cached summary covers,
  //    refresh the summary via a lightweight Mistral call. Otherwise
  //    reuse the cached one.
  // 4. Send: [system_persona, system_time, system_summary?, ...recent].
  //
  // This keeps the token bill flat regardless of how long the
  // conversation has been running.

  const allMessages = await db
    .select()
    .from(aiChatHistory)
    .where(
      and(
        eq(aiChatHistory.sessionId, sessionId),
        eq(aiChatHistory.userId, auth.userId),
      ),
    )
    .orderBy(asc(aiChatHistory.createdAt))
    .all();

  const totalCount = allMessages.length;
  const recentStart = Math.max(0, totalCount - RECENT_WINDOW);
  const olderMessages = allMessages.slice(0, recentStart);
  const recentMessages = allMessages.slice(recentStart);

  // Use whatever summary is already cached. We don't refresh BEFORE
  // the reply call — that would mean two sequential Mistral round-trips
  // per user message, which trips Mistral's free-tier rate limit. The
  // refresh happens AFTER the reply, fire-and-forget.
  const summaryText = updatedSession.summary;

  const systemMessages: Array<{ role: 'system'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: buildContextPrompt(body.timezone) },
  ];
  const profilePrompt = buildProfilePrompt(profileRow);
  if (profilePrompt) {
    systemMessages.push({ role: 'system', content: profilePrompt });
  }
  // Workspace context — tells Mistral which connections this user has
  // and which ones the conversation is currently scoped to. Without
  // this, the assistant can't pass `account: 'work'` etc. correctly.
  const workspacePrompt = buildWorkspacePrompt(
    userConnections,
    enabledConnectionIds,
  );
  if (workspacePrompt) {
    systemMessages.push({ role: 'system', content: workspacePrompt });
  }
  if (summaryText) {
    systemMessages.push({
      role: 'system',
      content:
        'Summary of earlier conversation in this session (use as ' +
        'background context — do not quote verbatim):\n' +
        summaryText,
    });
  }

  const upstreamMessages: ChatTurn[] = [
    ...systemMessages,
    ...recentMessages.map((r) => ({
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
    })),
  ];

  // ─── Tool-calling loop ────────────────────────────────────────────────
  //
  // Mistral may decide it needs fresh facts from the web. When it
  // returns `tool_calls` we run Tavily, append the results as
  // `tool` messages, and call Mistral again. Capped at MAX_TOOL_ROUNDS
  // to prevent runaway loops.
  let reply: string | null = null;
  const citations: Citation[] = [];
  const toolEvents: ToolEvent[] = [];
  const toolMessages: ChatTurn[] = [];
  let toolError: string | null = null;
  /**
   * Cache of the freshest Tavily response so we can synthesize a
   * fallback answer if Mistral comes back empty after a tool call.
   * Mistral 'mistral-large-latest' occasionally returns an empty
   * `content` after tool results, so the fallback prevents a 502.
   */
  let lastSearchAnswer: string | null = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS;
    const resp = await callMistral(apiKey, {
      messages: [...upstreamMessages, ...toolMessages],
      // Don't offer tools on the last round — we just want a final answer.
      tools: isLastRound ? undefined : WEB_SEARCH_TOOLS,
      tool_choice: isLastRound ? undefined : 'auto',
    });

    const choice = resp.choices?.[0]?.message;
    if (!choice) {
      console.error('[chat] mistral round had no choice', { round });
      break;
    }

    const calls = choice.tool_calls ?? [];
    const contentText = stringifyContent(choice.content);

    if (calls.length === 0) {
      reply = contentText.trim() || null;
      break;
    }

    // Echo the assistant turn (tool_calls) into the trail so Mistral
    // sees its own tool-call request when we re-invoke.
    toolMessages.push({
      role: 'assistant',
      content: contentText,
      tool_calls: calls,
    });

    // Run each requested tool serially. Tavily costs are minimal, and
    // Mistral usually requests just one search.
    for (const call of calls) {
      if (call.function?.name === 'web_search') {
        const parsedArgs = safeParseArgs(call.function.arguments);
        const result = await runWebSearch(call.function.arguments).catch(
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[chat] web_search failed: ${msg}`);
            toolError = err instanceof TavilyOutOfKeysError
              ? 'Web search quota exhausted for this period.'
              : err instanceof TavilyConfigError
                ? 'Web search is not configured on the server.'
                : 'Web search failed.';
            return null;
          },
        );

        if (result) {
          if (result.answer) lastSearchAnswer = result.answer;
          // Track citations for the client.
          for (const r of result.results) {
            if (r.url) {
              citations.push({
                title: r.title,
                url: r.url,
                snippet: r.content.slice(0, 280),
              });
            }
          }

          toolEvents.push({
            kind: 'web_search',
            status: 'success',
            args: {
              query: typeof parsedArgs.query === 'string' ? parsedArgs.query : '',
              time_range:
                typeof parsedArgs.time_range === 'string'
                  ? parsedArgs.time_range
                  : undefined,
            },
            data: {
              answer: result.answer,
              results: result.results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.content.slice(0, 280),
                publishedDate: r.publishedDate,
              })),
            },
          });
        } else {
          toolEvents.push({
            kind: 'web_search',
            status: 'error',
            args: {
              query: typeof parsedArgs.query === 'string' ? parsedArgs.query : '',
              time_range:
                typeof parsedArgs.time_range === 'string'
                  ? parsedArgs.time_range
                  : undefined,
            },
            error: toolError ?? 'Web search failed.',
          });
        }

        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: 'web_search',
          content: result
            ? JSON.stringify({
                answer: result.answer,
                results: result.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  content: r.content,
                  publishedDate: r.publishedDate,
                })),
              })
            : JSON.stringify({ error: toolError ?? 'Tool execution failed.' }),
        });
      } else if (
        call.function?.name === 'list_unread_emails' ||
        call.function?.name === 'search_emails' ||
        call.function?.name === 'check_calendar_availability' ||
        call.function?.name === 'create_calendar_event' ||
        call.function?.name === 'create_doc'
      ) {
        const toolName = call.function.name as
          | 'list_unread_emails'
          | 'search_emails'
          | 'check_calendar_availability'
          | 'create_calendar_event'
          | 'create_doc';
        const parsedArgs = safeParseArgs(call.function.arguments);
        const accountHint =
          typeof parsedArgs.account === 'string'
            ? parsedArgs.account
            : undefined;
        const isWriteTool =
          toolName === 'create_calendar_event' || toolName === 'create_doc';

        // Build the typed Google action from the raw Mistral arguments.
        const action = buildGoogleAction(toolName, parsedArgs);

        if (action.kind === 'error') {
          // Argument validation failed — synthesize an error event and
          // a tool message so Mistral can recover.
          const errorEvent = buildGoogleToolEvent(toolName, parsedArgs, {
            ok: false,
            error: action.error,
          });
          toolEvents.push(errorEvent);
          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: toolName,
            content: JSON.stringify({ ok: false, error: action.error }),
          });
          continue;
        }

        // Dispatch through the workspace router (handles default,
        // single-label, and 'all' fan-out).
        let perAccount: PerAccountResult[];
        try {
          perAccount = await workspaceDispatch(action.value, {
            all: userConnections,
            enabledIds: enabledConnectionIds,
            account: accountHint,
            isWrite: isWriteTool,
          });
        } catch (err) {
          // Soft errors that the user can fix by changing settings —
          // surface them as ToolEvent.error so the AI can explain
          // what's wrong instead of crashing the chat.
          const reason =
            err instanceof NoConnectionsError
              ? 'No Google account is enabled for this conversation. Connect one in Settings or enable an account from the conversation panel.'
              : err instanceof UnknownLabelError
                ? `No enabled connection labelled "${err.label}". Available: ${userConnections
                    .map((c) => c.label)
                    .join(', ') || '(none)'}.`
                : err instanceof WriteFanoutError
                  ? "Pick one account for this action — 'all' isn't allowed for writes."
                  : err instanceof Error
                    ? err.message
                    : 'Workspace dispatch failed.';
          console.error(`[chat] ${toolName} dispatch failed:`, reason);
          const errorEvent = buildGoogleToolEvent(toolName, parsedArgs, {
            ok: false,
            error: reason,
          });
          toolEvents.push(errorEvent);
          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: toolName,
            content: JSON.stringify({ ok: false, error: reason }),
          });
          continue;
        }

        // Stamp last-used on every successful connection. Best-effort —
        // any DB blip here just means the timestamp is stale.
        const usedAt = new Date();
        const usedIds = perAccount
          .filter((r) => r.result.ok)
          .map((r) => r.connectionId);
        if (usedIds.length > 0) {
          for (const id of usedIds) {
            await db
              .update(workspaceConnections)
              .set({ lastUsedAt: usedAt })
              .where(eq(workspaceConnections.id, id))
              .run()
              .catch(() => undefined);
          }
        }

        // Push one ToolEvent per dispatched account so the frontend
        // can render a card per source.
        for (const r of perAccount) {
          const event = buildGoogleToolEvent(toolName, parsedArgs, r.result);
          // Every Google tool variant carries `accountLabel`; this
          // assignment is a runtime no-op for `web_search`, which we
          // never produce here. The narrow cast keeps TypeScript happy.
          (event as { accountLabel?: string }).accountLabel = r.accountLabel;
          toolEvents.push(event);
        }

        // Tool message back to Mistral. For fan-outs we wrap each
        // account's payload under its label so the AI can attribute
        // results to the right account in its prose reply.
        const toolPayload =
          perAccount.length === 1
            ? perAccount[0].result
            : {
                ok: perAccount.some((r) => r.result.ok),
                accounts: perAccount.map((r) => ({
                  account: r.accountLabel,
                  ...r.result,
                })),
              };

        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(toolPayload),
        });
      } else {
        // Unknown tool — return a generic error so Mistral can recover.
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function?.name ?? 'unknown',
          content: JSON.stringify({ error: 'Unknown tool.' }),
        });
      }
    }
  }

  // Fallback: if Mistral never produced a textual reply (rare — but it
  // does happen after a tool call when the model returns an empty
  // content field), synthesize one from the Tavily answer + citations
  // so the user gets *something* useful instead of a 502.
  if (!reply && lastSearchAnswer) {
    reply = lastSearchAnswer.trim();
  }
  if (!reply && toolError) {
    reply = `I tried to look this up on the web but ran into an issue: ${toolError}`;
  }

  if (!reply) {
    throw new HttpError(
      502,
      'upstream_empty',
      'The chat service returned an empty reply',
    );
  }

  const assistantMessage = {
    id: nanoid(),
    userId: auth.userId,
    sessionId,
    role: 'assistant' as const,
    content: reply,
    citations: citations.length > 0 ? JSON.stringify(citations) : null,
    toolEvents:
      toolEvents.length > 0 ? JSON.stringify(toolEvents) : null,
    createdAt: new Date(),
  };
  await db.insert(aiChatHistory).values(assistantMessage).run();

  // If this was the first message in the session, ask Mistral for a
  // concise title based on the first exchange. Fire-and-forget so a
  // rate-limited title call doesn't block the chat reply (we still
  // have a derived fallback title visible immediately).
  if (isFirstMessage) {
    // Set the derived title synchronously so the sidebar updates
    // immediately. The AI title (if any) overwrites it later.
    const fallbackTitle = deriveTitle(body.message);
    const renamed = await db
      .update(chatSessions)
      .set({ title: fallbackTitle, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
      .returning()
      .get();
    if (renamed) updatedSession = renamed;

    // Background: try to upgrade the title to an AI-generated one.
    generateTitle(apiKey, body.message, reply)
      .then(async (aiTitle) => {
        if (!aiTitle) return;
        await db
          .update(chatSessions)
          .set({ title: aiTitle, updatedAt: new Date() })
          .where(eq(chatSessions.id, sessionId))
          .run();
      })
      .catch((err: unknown) => {
        console.error('[chat] background title generation failed:', err);
      });
  }

  // ─── Post-reply background work ───────────────────────────────────────
  //
  // Refresh the rolling summary AFTER the user has their reply. This
  // keeps the user-facing latency tied to a single Mistral round-trip
  // and means a 429 on the summary call no longer 502s the chat.
  //
  // We only refresh when:
  //   - the conversation is long enough to benefit from a summary, AND
  //   - at least SUMMARY_BATCH new older messages have arrived since
  //     the last refresh.
  // After this turn the "older" set will include the user+assistant
  // pair we just inserted (they fall outside the recent window once
  // the next turn arrives, but for summary purposes we already fold
  // them in).
  const projectedOlder = olderMessages.length + 2;
  const shouldRefreshSummary =
    totalCount + 1 >= SUMMARY_TRIGGER &&
    projectedOlder - updatedSession.summaryThrough >= SUMMARY_BATCH;

  if (shouldRefreshSummary) {
    const olderForSummary = [
      ...olderMessages,
      userMessage,
      assistantMessage,
    ];
    // Best-effort: don't await. If the edge runtime aborts before this
    // resolves, the next turn will simply try again.
    summarizeOlderMessages(
      apiKey,
      olderForSummary,
      updatedSession.summary,
    )
      .then(async (refreshed) => {
        if (!refreshed) return;
        await db
          .update(chatSessions)
          .set({
            summary: refreshed,
            summaryThrough: olderForSummary.length,
          })
          .where(eq(chatSessions.id, sessionId))
          .run();
      })
      .catch((err: unknown) => {
        console.error('[chat] background summary refresh failed:', err);
      });
  }

  return jsonResponse(200, {
    user: messageToDto(userMessage),
    assistant: messageToDto(assistantMessage),
    session: sessionToDto(updatedSession),
  });
}


/**
 * Build the per-request "context awareness" system prompt.
 *
 * Injects the current date and time in the user's local timezone (and
 * UTC for cross-reference) so the assistant can reason about deadlines,
 * "tomorrow", "next week", etc. without having to ask. Without this
 * the model is unaware of wall-clock time.
 *
 * `timezone` is an IANA zone like "Asia/Jakarta". Falls back to UTC if
 * the client didn't send one or it's invalid.
 */
function buildContextPrompt(timezone: string | undefined): string {
  const now = new Date();
  const tz = timezone && isValidTimezone(timezone) ? timezone : 'UTC';

  let localStr: string;
  let dayOfWeek: string;
  try {
    // Format like: "Friday, May 15, 2026, 14:32"
    localStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    dayOfWeek = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
    }).format(now);
  } catch {
    localStr = now.toISOString();
    dayOfWeek = '';
  }

  return [
    'Current context (you are a stateless model, the system injects this every turn):',
    `- Local time (${tz}): ${localStr}`,
    `- Day of week: ${dayOfWeek}`,
    `- UTC time: ${now.toISOString()}`,
    '',
    'When the user says "today", "tomorrow", "tonight", "next week", "in 2 hours" etc., resolve those against the LOCAL time above. Never ask the user what the date is — you already know.',
  ].join('\n');
}

/**
 * Build a "who you are talking to" system prompt from the user's
 * profile row. Returns `null` when the profile has no useful data
 * (anonymous defaults), so we don't waste tokens injecting a
 * placeholder.
 *
 * The assistant uses this to address the user by their preferred name
 * naturally (no overuse), and to bias relevance toward their declared
 * focus areas. Greetings shouldn't sound like a customer-service bot —
 * just call them by name once, then carry on.
 */
function buildProfilePrompt(
  profile: {
    preferredName: string | null;
    displayName: string | null;
    headline: string | null;
    focusAreas: string | null;
    locationLabel: string | null;
  } | null | undefined,
): string | null {
  if (!profile) return null;
  const name = (profile.preferredName ?? profile.displayName ?? '').trim();
  const headline = (profile.headline ?? '').trim();
  const focus = (profile.focusAreas ?? '').trim();
  const location = (profile.locationLabel ?? '').trim();
  if (!name && !headline && !focus && !location) return null;

  const lines: string[] = ['User profile (use this to personalize replies):'];
  if (name) lines.push(`- Preferred name: ${name}`);
  if (headline) lines.push(`- Headline: ${headline}`);
  if (focus) lines.push(`- Focus areas: ${focus}`);
  if (location) lines.push(`- Location: ${location}`);
  lines.push('');
  lines.push(
    'Address them by name naturally — once at the start of a fresh thread is plenty, do not sprinkle their name into every reply. Do NOT introduce yourself as an assistant; they already know.',
  );
  return lines.join('\n');
}


/**
 * Tell the assistant which Workspace connections are connected and
 * which ones are currently enabled for this conversation.
 *
 * The assistant uses this to:
 *   - Decide whether to call a Workspace tool at all (no enabled
 *     connection ⇒ tool will fail; ask the user to enable one first).
 *   - Pick the right `account` argument when it does call a tool. If
 *     the user said "in my work email", the assistant must match it
 *     to a connected label like "Work" / "work@example.com".
 *   - Avoid `'all'` fan-out unless the user explicitly asked.
 */
function buildWorkspacePrompt(
  connections: ConnectionRecord[],
  enabledIds: ReadonlyArray<string> | undefined,
): string | null {
  if (connections.length === 0) {
    return 'Workspace connections: none connected. If the user asks for email, calendar, or doc actions, tell them to connect a Google account in Settings first.'
  }

  const enabledSet =
    enabledIds === undefined
      ? new Set(connections.filter((c) => c.isDefault).map((c) => c.id))
      : new Set(enabledIds)

  const lines: string[] = []
  lines.push('Workspace connections (Google Apps Script bridges):')
  for (const c of connections) {
    const isEnabled = enabledSet.has(c.id)
    const flags = [
      c.isDefault ? 'primary' : null,
      isEnabled ? 'enabled' : 'disabled',
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(`- "${c.label}" (${flags})`)
  }
  lines.push('')
  if (enabledSet.size === 0) {
    lines.push(
      'No accounts are enabled for this conversation. If a Workspace tool is needed, tell the user to enable one from the conversation panel.',
    )
  } else {
    lines.push(
      "When you call a Workspace tool, pass `account` matching the label (case-insensitive). Omit `account` to use the primary. Use `account: 'all'` ONLY if the user explicitly asked to look across every enabled account (e.g. \"search across all my emails\"). Never pass an account that isn't in the enabled list above.",
    )
  }
  return lines.join('\n')
}


/**
 * Best-effort check that an IANA timezone string is something
 * `Intl.DateTimeFormat` will accept. Avoids letting clients inject
 * arbitrary strings into the system prompt.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Summarize the older portion of the conversation (everything outside
 * the recent context window) into a compact paragraph that captures
 * what was discussed, decisions made, and ongoing topics — without
 * verbatim quotes. The result is cached on the session row so we only
 * pay for this round-trip when new "older" messages have accumulated.
 *
 * If a previous summary exists, it's passed in so the model can
 * extend rather than rewrite from scratch (cheaper, more consistent).
 */
async function summarizeOlderMessages(
  apiKey: string,
  older: MessageRow[],
  previousSummary: string | null,
): Promise<string | null> {
  if (older.length === 0) return previousSummary;

  // Cap each message at ~400 chars so a single mega-message can't
  // blow the summarization budget.
  const transcript = older
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const sys =
    'You produce rolling chat summaries. Output ONLY the summary text, ' +
    'no preamble. 2-5 short sentences. Capture: what was discussed, ' +
    'decisions/preferences the user expressed, ongoing tasks/topics, ' +
    'and the user\'s tone/language. Match the language the user wrote in. ' +
    'No bullet points, no quotes, no meta-commentary.';

  const userContent = previousSummary
    ? `Previous summary:\n${previousSummary}\n\nNew transcript to fold in:\n${transcript}\n\nReturn an updated summary.`
    : `Transcript to summarize:\n${transcript}`;

  const res = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 240,
    }),
  });

  if (!res.ok) {
    console.error(`[chat] summary upstream failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = data.choices?.[0]?.message?.content?.trim();
  return out || null;
}


/**
 * Coerce Mistral's `message.content` into a plain string regardless of
 * shape. The OpenAI-compatible API can return:
 *   - a plain string (the common case)
 *   - `null` (when the model only emitted `tool_calls`)
 *   - an array of content parts `[{ type: 'text', text: '…' }, …]`
 *
 * We collapse all three into a single string so callers can `.trim()`
 * without runtime checks.
 */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
    return parts.join('');
  }
  return '';
}

/**
 * Single Mistral chat-completion request that supports the tool-calling
 * surface (tools / tool_choice / response with `tool_calls`). All
 * requests in the chat handler now go through this helper so the
 * tool-loop and the final-answer round share one well-typed entry
 * point.
 */
async function callMistral(
  apiKey: string,
  payload: {
    messages: ChatTurn[];
    tools?: typeof WEB_SEARCH_TOOLS;
    tool_choice?: 'auto' | 'none';
    /** Default 0.85; lower for tool-using rounds isn't worth the complexity. */
    temperature?: number;
    max_tokens?: number;
  },
): Promise<{
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
}> {
  // Mistral's free tier rate-limits per-second on bursty interactive
  // chat (especially when tool-calling drives multiple round-trips).
  // Strategy:
  //   1. Try mistral-large-latest with up to 3 attempts and short backoffs.
  //   2. If still 429, downshift to mistral-small-latest (separate per-model
  //      quota on the free tier — a 429 on large doesn't mean small is also
  //      rate-limited). Small is plenty for most chat replies; we only
  //      lose a bit of nuance.
  //   3. Only after BOTH models 429 do we surface a friendly rate-limit error.
  // Anything other than 429 fails fast — bad payloads / auth errors should
  // not be retried.
  const MODEL_LADDER: ReadonlyArray<{ model: string; attempts: number; backoffsMs: number[] }> = [
    { model: DEFAULT_MODEL, attempts: 3, backoffsMs: [600, 1400] },
    { model: 'mistral-small-latest', attempts: 2, backoffsMs: [800] },
  ];

  let lastDetail = '';

  for (const { model, attempts, backoffsMs } of MODEL_LADDER) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const upstream = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: payload.messages,
          tools: payload.tools,
          tool_choice: payload.tool_choice,
          temperature: payload.temperature ?? 0.85,
          max_tokens: payload.max_tokens ?? 800,
        }),
      });

      if (upstream.ok) {
        if (model !== DEFAULT_MODEL) {
          console.warn(`[chat] mistral fell back to ${model}`);
        }
        return (await upstream.json()) as {
          choices?: Array<{
            message?: { content?: string | null; tool_calls?: ToolCall[] };
          }>;
        };
      }

      const detail = await upstream.text().catch(() => '');
      lastDetail = detail.slice(0, 500);

      if (upstream.status !== 429) {
        // Auth/payload error — abort entire ladder, don't waste tokens
        // on the small model with an already-broken request.
        console.error(
          `[chat] mistral upstream failed: ${upstream.status} ${lastDetail}`,
        );
        throw new HttpError(
          502,
          'upstream_error',
          'The chat service is currently unavailable',
        );
      }

      // 429 path: retry within current model if attempts remain;
      // otherwise fall through to the next model in the ladder.
      const isLastAttemptOnThisModel = attempt === attempts - 1;
      if (!isLastAttemptOnThisModel) {
        const retryAfter = Number.parseInt(
          upstream.headers.get('retry-after') ?? '',
          10,
        );
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 2500)
            : backoffsMs[attempt] ?? 1000;
        console.warn(
          `[chat] mistral 429 on ${model}, retrying in ${wait}ms (attempt ${attempt + 1}/${attempts})`,
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      // Exhausted attempts on this model — log and move on to next model.
      console.warn(
        `[chat] mistral 429 exhausted on ${model}, trying next model in ladder`,
      );
    }
  }

  // Both models exhausted on 429 — surface a friendly error.
  console.error(`[chat] mistral 429 ladder exhausted: ${lastDetail}`);
  throw new HttpError(
    429,
    'rate_limited',
    "I'm being rate-limited by the AI provider. Wait a few seconds and try again.",
  );
}

/**
 * Execute the `web_search` tool call. The Mistral tool-call argument
 * payload is a JSON-encoded string we must parse before handing to
 * Tavily.
 */
async function runWebSearch(rawArgs: string) {
  let args: { query?: unknown; time_range?: unknown };
  try {
    args = JSON.parse(rawArgs);
  } catch {
    throw new Error('web_search received malformed arguments');
  }

  if (typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('web_search requires a non-empty query');
  }

  const timeRange =
    args.time_range === 'day' ||
    args.time_range === 'week' ||
    args.time_range === 'month' ||
    args.time_range === 'year'
      ? args.time_range
      : undefined;

  return tavilySearch({
    query: args.query.trim().slice(0, 200),
    searchDepth: 'basic',
    maxResults: 5,
    timeRange,
  });
}


/**
 * Execute one of the Google Workspace tool calls.
 *
 * The four supported actions (`list_unread_emails`,
 * `check_calendar_availability`, `create_calendar_event`,
 * `create_doc`) are forwarded to the user's Apps Script Web App
 * via `callGoogleAction`. We parse + normalize the Mistral-supplied
 * arguments here so the wire payload to the bridge is the typed
 * `GoogleAction` discriminated union rather than the raw tool args.
 *
 * ISO 8601 datetime strings are converted to unix seconds; the bridge
 * accepts seconds because Apps Script's `Date` constructor is flaky
 * with timezone-suffixed strings on certain locales.
 */
/**
 * Translate a Mistral tool call's parsed args into the typed
 * `GoogleAction` discriminated union. Returns either a tagged
 * `value` (success) or a tagged `error` (validation failed) so the
 * caller can synthesise a tool-message + ToolEvent without throwing.
 *
 * ISO 8601 datetime strings are converted to unix seconds; the bridge
 * accepts seconds because Apps Script's `Date` constructor is flaky
 * with timezone-suffixed strings on certain locales.
 */
function buildGoogleAction(
  name: string,
  args: Record<string, unknown>,
):
  | { kind: 'value'; value: GoogleAction }
  | { kind: 'error'; error: string } {
  if (name === 'list_unread_emails') {
    const max =
      typeof args.max === 'number' && Number.isFinite(args.max)
        ? Math.max(1, Math.min(10, Math.floor(args.max)))
        : undefined;
    return { kind: 'value', value: { kind: 'list_unread_emails', max } };
  }
  if (name === 'search_emails') {
    if (typeof args.query !== 'string' || args.query.trim().length === 0) {
      return { kind: 'error', error: 'search_emails requires a query string' };
    }
    const max =
      typeof args.max === 'number' && Number.isFinite(args.max)
        ? Math.max(1, Math.min(10, Math.floor(args.max)))
        : undefined;
    return {
      kind: 'value',
      value: {
        kind: 'search_emails',
        query: args.query.trim().slice(0, 300),
        max,
      },
    };
  }
  if (name === 'check_calendar_availability') {
    const startSec = isoToUnixSec(args.start_iso);
    const endSec = isoToUnixSec(args.end_iso);
    if (startSec == null || endSec == null) {
      return {
        kind: 'error',
        error:
          'check_calendar_availability requires start_iso and end_iso as ISO 8601 strings',
      };
    }
    return {
      kind: 'value',
      value: { kind: 'check_calendar_availability', startSec, endSec },
    };
  }
  if (name === 'create_calendar_event') {
    if (typeof args.title !== 'string' || args.title.trim().length === 0) {
      return { kind: 'error', error: 'create_calendar_event requires a title' };
    }
    const startSec = isoToUnixSec(args.start_iso);
    if (startSec == null) {
      return {
        kind: 'error',
        error: 'create_calendar_event requires start_iso (ISO 8601)',
      };
    }
    const endSec = isoToUnixSec(args.end_iso) ?? undefined;
    return {
      kind: 'value',
      value: {
        kind: 'create_calendar_event',
        title: args.title.trim().slice(0, 200),
        startSec,
        endSec,
        description:
          typeof args.description === 'string'
            ? args.description.slice(0, 4000)
            : undefined,
      },
    };
  }
  if (name === 'create_doc') {
    if (typeof args.title !== 'string' || args.title.trim().length === 0) {
      return { kind: 'error', error: 'create_doc requires a title' };
    }
    if (typeof args.body !== 'string') {
      return { kind: 'error', error: 'create_doc requires a body' };
    }
    return {
      kind: 'value',
      value: {
        kind: 'create_doc',
        title: args.title.trim().slice(0, 200),
        body: args.body.slice(0, 100_000),
        folderId:
          typeof args.folder_id === 'string' ? args.folder_id : undefined,
      },
    };
  }
  return { kind: 'error', error: `unknown google tool: ${name}` };
}

/**
 * Best-effort ISO 8601 → unix seconds conversion. Returns null when
 * the input is missing or not a valid datetime.
 */
function isoToUnixSec(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Best-effort parse of the JSON-encoded tool argument string Mistral
 * sends. Returns an empty object on any parse failure so the caller
 * can shape a fallback ToolEvent without throwing.
 */
function safeParseArgs(rawArgs: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

/**
 * Convert the raw {@link callGoogleAction} envelope into the typed
 * {@link ToolEvent} the frontend renders. Args are passed through
 * unchanged (already normalized by `runGoogleAction`); the response
 * payload is shape-checked at runtime so a malformed bridge response
 * cannot crash the persistence path.
 */
function buildGoogleToolEvent(
  toolName:
    | 'list_unread_emails'
    | 'search_emails'
    | 'check_calendar_availability'
    | 'create_calendar_event'
    | 'create_doc',
  rawArgs: Record<string, unknown>,
  result: { ok: boolean; data?: unknown; error?: string },
): ToolEvent {
  if (toolName === 'list_unread_emails') {
    const args = {
      max:
        typeof rawArgs.max === 'number' && Number.isFinite(rawArgs.max)
          ? Math.floor(rawArgs.max)
          : undefined,
    };
    if (!result.ok) {
      return {
        kind: 'list_unread_emails',
        status: 'error',
        args,
        error: result.error ?? 'Failed to read inbox.',
      };
    }
    const data = (result.data ?? {}) as {
      messages?: Array<Record<string, unknown>>;
    };
    return {
      kind: 'list_unread_emails',
      status: 'success',
      args,
      data: {
        messages: (data.messages ?? []).map((m) => ({
          id: typeof m.id === 'string' ? m.id : '',
          from: typeof m.from === 'string' ? m.from : '',
          subject: typeof m.subject === 'string' ? m.subject : '(no subject)',
          receivedAtSec:
            typeof m.receivedAtSec === 'number' ? m.receivedAtSec : 0,
          snippet: typeof m.snippet === 'string' ? m.snippet : '',
        })),
      },
    };
  }

  if (toolName === 'search_emails') {
    const args = {
      query: typeof rawArgs.query === 'string' ? rawArgs.query : '',
      max:
        typeof rawArgs.max === 'number' && Number.isFinite(rawArgs.max)
          ? Math.floor(rawArgs.max)
          : undefined,
    };
    if (!result.ok) {
      return {
        kind: 'search_emails',
        status: 'error',
        args,
        error: result.error ?? 'Failed to search inbox.',
      };
    }
    const data = (result.data ?? {}) as {
      query?: string;
      messages?: Array<Record<string, unknown>>;
    };
    return {
      kind: 'search_emails',
      status: 'success',
      args,
      data: {
        query: typeof data.query === 'string' ? data.query : args.query,
        messages: (data.messages ?? []).map((m) => ({
          id: typeof m.id === 'string' ? m.id : '',
          from: typeof m.from === 'string' ? m.from : '',
          subject: typeof m.subject === 'string' ? m.subject : '(no subject)',
          receivedAtSec:
            typeof m.receivedAtSec === 'number' ? m.receivedAtSec : 0,
          snippet: typeof m.snippet === 'string' ? m.snippet : '',
          isUnread: typeof m.isUnread === 'boolean' ? m.isUnread : false,
        })),
      },
    };
  }

  if (toolName === 'check_calendar_availability') {
    const args = {
      startSec: isoToUnixSec(rawArgs.start_iso) ?? 0,
      endSec: isoToUnixSec(rawArgs.end_iso) ?? 0,
    };
    if (!result.ok) {
      return {
        kind: 'check_calendar_availability',
        status: 'error',
        args,
        error: result.error ?? 'Failed to read calendar.',
      };
    }
    const data = (result.data ?? {}) as {
      events?: Array<Record<string, unknown>>;
      isFree?: boolean;
    };
    return {
      kind: 'check_calendar_availability',
      status: 'success',
      args,
      data: {
        events: (data.events ?? []).map((e) => ({
          id: typeof e.id === 'string' ? e.id : '',
          title: typeof e.title === 'string' ? e.title : '(untitled)',
          startSec: typeof e.startSec === 'number' ? e.startSec : 0,
          endSec: typeof e.endSec === 'number' ? e.endSec : 0,
        })),
        isFree: typeof data.isFree === 'boolean' ? data.isFree : false,
      },
    };
  }

  if (toolName === 'create_calendar_event') {
    const args = {
      title: typeof rawArgs.title === 'string' ? rawArgs.title : '',
      startSec: isoToUnixSec(rawArgs.start_iso) ?? 0,
      endSec: isoToUnixSec(rawArgs.end_iso) ?? undefined,
      description:
        typeof rawArgs.description === 'string' ? rawArgs.description : undefined,
    };
    if (!result.ok) {
      return {
        kind: 'create_calendar_event',
        status: 'error',
        args,
        error: result.error ?? 'Failed to create event.',
      };
    }
    const data = (result.data ?? {}) as Record<string, unknown>;
    return {
      kind: 'create_calendar_event',
      status: 'success',
      args,
      data: {
        id: typeof data.id === 'string' ? data.id : '',
        title: typeof data.title === 'string' ? data.title : args.title,
        startSec: typeof data.startSec === 'number' ? data.startSec : args.startSec,
        endSec:
          typeof data.endSec === 'number'
            ? data.endSec
            : args.endSec ?? args.startSec,
        htmlLink: typeof data.htmlLink === 'string' ? data.htmlLink : undefined,
      },
    };
  }

  // create_doc
  const args = {
    title: typeof rawArgs.title === 'string' ? rawArgs.title : '',
    folderId:
      typeof rawArgs.folder_id === 'string' ? rawArgs.folder_id : undefined,
  };
  if (!result.ok) {
    return {
      kind: 'create_doc',
      status: 'error',
      args,
      error: result.error ?? 'Failed to create document.',
    };
  }
  const data = (result.data ?? {}) as Record<string, unknown>;
  return {
    kind: 'create_doc',
    status: 'success',
    args,
    data: {
      id: typeof data.id === 'string' ? data.id : '',
      url: typeof data.url === 'string' ? data.url : '',
      warning: typeof data.warning === 'string' ? data.warning : undefined,
    },
  };
}


/**
 * Ask Mistral for a short conversation title based on the first user
 * message and the assistant's first reply. Uses a smaller/faster model
 * so the post-reply title-naming round-trip stays cheap.
 *
 * Returns the trimmed title (max ~48 chars) or null if Mistral failed
 * or returned something unusable; the caller falls back to a derived
 * title in that case so the UI never shows a stale "New chat" label.
 */
async function generateTitle(
  apiKey: string,
  firstUser: string,
  firstAssistant: string,
): Promise<string | null> {
  const prompt = [
    {
      role: 'system' as const,
      content:
        'You name chat sessions. Given the opening exchange, reply with ONLY a short, ' +
        'human-readable title (max 6 words, no quotes, no trailing punctuation). ' +
        'Match the language the user wrote in (default English when unclear). Examples: ' +
        '"Math homework help", "24h race plan", "Stripe checkout setup", "Belajar laplace transform". ' +
        'Do not prefix with "Title:".',
    },
    {
      role: 'user' as const,
      content: `User: ${firstUser.slice(0, 600)}\nAssistant: ${firstAssistant.slice(0, 600)}`,
    },
  ];

  const res = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Use small for titles — fast + cheap.
      model: 'mistral-small-latest',
      messages: prompt,
      temperature: 0.2,
      max_tokens: 24,
    }),
  });

  if (!res.ok) {
    console.error(`[chat] title generation failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  // Strip surrounding quotes and trailing punctuation, cap length.
  const cleaned = raw
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[.!?…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  if (cleaned.length > 60) return cleaned.slice(0, 57).trimEnd() + '…';
  return cleaned;
}
