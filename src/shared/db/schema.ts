import { sqliteTable, text, integer, customType, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';


// 1. Custom Type untuk Turso Vector (F32_BLOB)
// Ini diperlukan agar Drizzle bisa menyimpan hasil embedding AI untuk fitur NotebookLM/Research
const f32Vector = customType<{ data: number[]; driverData: Buffer }>({
  dataType() {
    return 'F32_BLOB';
  },
  toDriver(value: number[]): Buffer {
    return Buffer.from(new Float32Array(value).buffer);
  },
  fromDriver(value: Buffer): number[] {
    return Array.from(new Float32Array(value.buffer));
  },
});


// NOTE: Authentication and user metadata live in Turso.
// The `user_id` columns below reference `users.id` (a UUIDv4).
// Cross-database FKs are no longer an issue as everything is in Turso,
// but for legacy reasons (and to keep the schema simple), some tables
// don't enforce foreign keys. Ownership is enforced at the API layer
// by folding `eq(*.user_id, auth.userId)` into every query's where-clause.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshToken: text('refresh_token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (t) => ({
  byRefreshToken: index('idx_sessions_refresh_token').on(t.refreshToken),
  byUserId: index('idx_sessions_user_id').on(t.userId),
}));


// 2. Tasks Table
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(), // e.g., 'engineering', 'personal'
    isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    deadline: integer('deadline', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
    /**
     * How many consecutive times the user has rescheduled this task to a
     * later day. Bumped by `/api/tasks/:id/reschedule`. Resets to 0 the
     * moment the task is completed or its deadline is moved earlier (e.g.
     * via PATCH). The frontend uses this to show an AI-flavored nudge
     * after the third consecutive reschedule.
     */
    rescheduleCount: integer('reschedule_count').notNull().default(0),
    /**
     * Comma-separated free-form tags. Augments the single `category`
     * field with multi-axis context (e.g. "kuliah,urgent"). The
     * client splits on `,`, trims, lower-cases, and dedupes; the
     * server stores whatever the client sends (after the same
     * normalization) so round-trips are stable.
     */
    tags: text('tags').notNull().default(''),
  },
  (t) => ({
    byUser: index('idx_tasks_user').on(t.userId),
    byUserCreated: index('idx_tasks_user_created').on(t.userId, t.createdAt),
  }),
);


// 3. Habits Table
//
// Two kinds:
//   - 'daily': recurring tracker. Check off resets at midnight; row stays
//     in the DB so the streak survives across days.
//   - 'one_time': single goal. Check off once → row is deleted from the
//     DB after the UI countdown. No streak meaning.
//
// `kind` defaults to 'daily' for backward compatibility with rows created
// before this column existed.
export const habits = sqliteTable(
  'habits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('daily'),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastCompletedDate: integer('last_completed_date', { mode: 'timestamp' }),
  },
  (t) => ({
    byUser: index('idx_habits_user').on(t.userId),
  }),
);


// 4. AI Chat Sessions (each user has multiple conversations, like ChatGPT)
export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    /**
     * Rolling summary of messages older than the recent context window.
     * Nullable when no summary has been produced yet (fresh session or
     * conversation still under the recent-window threshold).
     */
    summary: text('summary'),
    /**
     * How many messages from the beginning of the conversation have
     * been folded into `summary`. Used to detect when new "older"
     * messages have accumulated and the summary needs to be refreshed.
     */
    summaryThrough: integer('summary_through').notNull().default(0),
    /**
     * CSV of `workspace_connections.id` values that are currently
     * "enabled" for this conversation — i.e. eligible targets when
     * the assistant fires a Workspace tool. NULL means "use the user's
     * default connection". Empty string means the user explicitly
     * disabled all accounts for this thread.
     */
    activeConnectionIds: text('active_connection_ids'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    byUserUpdated: index('idx_chat_sessions_user_updated').on(t.userId, t.updatedAt),
  }),
);

// 5. AI Chat History — messages now belong to a session.
//
// `sessionId` is nullable so legacy rows from the pre-session schema
// continue to exist in the database without blocking the migration.
// Application code filters by `sessionId IS NOT NULL` so orphaned rows
// are simply invisible.
export const aiChatHistory = sqliteTable(
  'ai_chat_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id'),
    role: text('role').notNull(), // 'user' | 'assistant' | 'system'
    content: text('content').notNull(),
    /**
     * Optional JSON-encoded array of `{ title, url, snippet }` records
     * for assistant messages that were grounded by web-search tool
     * calls. Null on user/system messages and on assistant messages
     * that didn't trigger a search.
     */
    citations: text('citations'),
    /**
     * Optional JSON-encoded array of structured tool-event records
     * `{ kind, status, args, data, error }` produced during this
     * assistant turn. Drives Gemini-style cards (Calendar events,
     * email lists, Doc creation confirmations) on the client. Null on
     * messages that didn't invoke any tool.
     */
    toolEvents: text('tool_events'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    bySessionCreated: index('idx_chat_session_created').on(t.sessionId, t.createdAt),
    byUserCreated: index('idx_chat_user_created').on(t.userId, t.createdAt),
  }),
);


// 5. Idea Vault (Menyimpan hasil brainstorming Hackathon)
export const ideaVault = sqliteTable('idea_vault', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  keywords: text('keywords').notNull(), // comma separated
  generatedConcept: text('generated_concept').notNull(), // Markdown format
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});


// 6. NotebookLM Mode — knowledge bases with vector search.
//
// Hierarchy:
//   notebooks  (1) ─< notebook_sources (1) ─< documents (chunks)
//
// Each "notebook" is a folder of source files. Each source is one
// uploaded file. Each chunk is a 1024-dim embedded slice of that
// file. Q&A on a notebook embeds the question, runs vector_top_k
// against the chunks scoped to that notebook, and feeds the top
// matches to Mistral as context.

export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    byUserUpdated: index('idx_notebooks_user_updated').on(t.userId, t.updatedAt),
  }),
);

export const notebookSources = sqliteTable(
  'notebook_sources',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull(),
    userId: text('user_id').notNull(),
    /**
     * 'file' = uploaded by the user (PDF/DOCX/XLSX/CSV/TXT etc.).
     * 'web'  = scraped from the web by the AI research tool — the
     *          original `url` is stored alongside.
     */
    kind: text('kind').notNull().default('file'),
    /** Only set when `kind === 'web'`. */
    url: text('url'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    textLength: integer('text_length'),
    chunkCount: integer('chunk_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    byNotebook: index('idx_notebook_sources_notebook').on(t.notebookId, t.createdAt),
    byUser: index('idx_notebook_sources_user').on(t.userId),
  }),
);

/**
 * Persistent Q&A for a notebook. One row per turn (user or assistant).
 * Assistant rows may carry a JSON-encoded `citations` array referencing
 * the chunks that grounded the answer.
 */
export const notebookMessages = sqliteTable(
  'notebook_messages',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    citations: text('citations'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    byNotebookCreated: index('idx_notebook_messages_notebook_created').on(
      t.notebookId,
      t.createdAt,
    ),
    byUser: index('idx_notebook_messages_user').on(t.userId),
  }),
);

// Documents / Knowledge Base chunks.
//
// `notebook_id` and `source_id` link a chunk to its parent file/notebook.
// They're nullable for backward compatibility with any rows that
// existed before the notebooks feature shipped. New rows always set
// both.
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    notebookId: text('notebook_id'),
    sourceId: text('source_id'),
    /** Position of this chunk within its source file (0-indexed). */
    chunkIndex: integer('chunk_index').notNull().default(0),
    title: text('title').notNull(),
    contentChunk: text('content_chunk').notNull(),
    embedding: f32Vector('embedding'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    byNotebook: index('idx_documents_notebook').on(t.notebookId),
    bySource: index('idx_documents_source').on(t.sourceId),
  }),
);


// 7. User profile / preferences (single row per user).
//
// All fields are optional. UI fills sensible defaults from this row
// when present, otherwise the app behaves as before. Lazy-created on
// first profile write.
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name'),
  preferredName: text('preferred_name'),
  headline: text('headline'),
  avatarEmoji: text('avatar_emoji'),
  avatarColor: text('avatar_color'),
  locationLabel: text('location_label'),
  /** Comma-separated free-form tags. */
  focusAreas: text('focus_areas'),
  theme: text('theme').notNull().default('auto'),
  accent: text('accent').notNull().default('default'),
  dateFormat: text('date_format').notNull().default('long'),
  showMarkets: integer('show_markets', { mode: 'boolean' }).notNull().default(true),
  showWeather: integer('show_weather', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s', 'now'))`),
})


// 8. Habit Completions (one row per check-off, powers the heatmap)
//
// Each row records a single successful check-off. We index on
// `(habit_id, date)` so the heatmap query can fetch the last N days for
// a given habit in a single index scan, and use `date` instead of a
// timestamp so SQLite stores a 4-byte integer instead of an 8-byte one.
//
// `date` is days-since-epoch (Math.floor(unixSeconds / 86400)) computed
// at the user's Local_Today, so two check-offs on the same calendar day
// in their timezone always collide on the same `(habit_id, date)` pair.
// The check-off endpoint upserts on that pair to make double-tap safe.
export const habitCompletions = sqliteTable(
  'habit_completions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    habitId: text('habit_id').notNull(),
    /** Days since unix epoch in the user's local timezone. */
    date: integer('date').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    byHabitDate: index('idx_habit_completions_habit_date').on(
      t.habitId,
      t.date,
    ),
    byUser: index('idx_habit_completions_user').on(t.userId),
  }),
)


// 9. Pomodoro Sessions (append-only focus session log)
//
// Each row records ONE completed focus session. Sessions can attach to
// a task (`taskId` set) or float free (`taskId IS NULL`, "I just want
// to focus for 25 min").
//
// Stored as unix-seconds integers throughout — no Date objects on this
// row. The Weekly Review aggregates across `userId + startedAt` ranges,
// and the per-task rollup aggregates across `taskId + startedAt`.
//
// Sessions shorter than 60 seconds are dropped on the client before
// they reach this table; we keep that policy in the client layer to
// keep this schema policy-free.
export const pomodoroSessions = sqliteTable(
  'pomodoro_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    /** Optional FK-by-convention to `tasks.id`. Cross-table FKs are
     * intentionally not enforced; ownership is checked at the API
     * layer by `userId`. Orphaned rows (parent task deleted) are
     * preserved — they still represent real focus time. */
    taskId: text('task_id'),
    /** Actual elapsed seconds the timer ran. */
    durationSec: integer('duration_sec').notNull(),
    /** Unix seconds when the timer started. */
    startedAt: integer('started_at').notNull(),
    /** Unix seconds when the session ended (always >= startedAt). */
    completedAt: integer('completed_at').notNull(),
    /** Free-form note attached to the session. Optional. */
    label: text('label'),
  },
  (t) => ({
    byUserStarted: index('idx_pomodoro_user_started').on(t.userId, t.startedAt),
    byTaskStarted: index('idx_pomodoro_task_started').on(t.taskId, t.startedAt),
  }),
)


// 11. Workspace connections (multi-account, BYO Apps Script)
//
// Each row is one Google Apps Script bridge a user has connected.
// A user may connect several (Personal / Work / Kuliah / etc); exactly
// one is the default. The default is used when the assistant doesn't
// have an explicit account hint from the user.
//
// `secretEncrypted` is the GAS shared secret encrypted with AES-GCM
// (key = WORKSPACE_SECRET_KEY env var). The webhook URL is stored
// plaintext — without the secret, the URL alone cannot trigger any
// action against the user's Google account.
export const workspaceConnections = sqliteTable(
  'workspace_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    /** Human-friendly label shown in chips and pickers. Unique per user. */
    label: text('label').notNull(),
    /** Discriminator for future providers. Today: `'google_gas'`. */
    provider: text('provider').notNull().default('google_gas'),
    webhookUrl: text('webhook_url').notNull(),
    /** AES-GCM encrypted blob: `v1:base64iv:base64cipher`. */
    secretEncrypted: text('secret_encrypted').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' })
      .notNull()
      .default(false),
    connectedAt: integer('connected_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
    lastTestAt: integer('last_test_at', { mode: 'timestamp' }),
    lastTestOk: integer('last_test_ok', { mode: 'boolean' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  },
  (t) => ({
    byUserId: index('idx_workspace_connections_user_id').on(t.userId),
  }),
)
