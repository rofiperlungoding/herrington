# Development Guide

This guide covers day-to-day development on the Life Management codebase. The high-level overview lives in `README.md`; this document focuses on workflows, conventions, and operational details that matter mid-iteration.

---

## Table of Contents

- [Development Server](#development-server)
- [Build and Verification](#build-and-verification)
- [Testing](#testing)
- [Database Workflow](#database-workflow)
- [Edge Functions](#edge-functions)
- [Authentication](#authentication)
- [AI Integration](#ai-integration)
- [Design System](#design-system)
- [Specifications Workflow](#specifications-workflow)
- [Coding Conventions](#coding-conventions)
- [Troubleshooting](#troubleshooting)

---

## Development Server

A single command, a single port:

```bash
npm run dev
# → http://localhost:5173
```

### How It Works

The development server is plain Vite. The custom Vite plugin at `scripts/edge-dev-plugin.ts` performs three roles during the `serve` lifecycle:

1. **Loads `.env`** into `process.env` so server-side variables (`AUTH_JWT_SECRET`, `TURSO_AUTH_TOKEN`, `MISTRAL_API_KEY`, etc.) are available to edge functions running under Node.
2. **Installs a `globalThis.Deno.env` shim** that forwards `Deno.env.get(...)` to `process.env`. This allows the edge functions to remain Deno-portable for production deployment without runtime-specific branching.
3. **Mounts each file under `netlify/edge-functions/*.ts`** at `/api/<file-stem>` via a connect middleware. Vite's SSR module loader handles compilation; an in-plugin `transform` hook rewrites Deno-style `.ts` imports so they resolve through Vite's module graph.

The development port is pinned with `strictPort: true`. If port 5173 is unavailable the dev server fails immediately with a clear error rather than silently incrementing to 5174 (the silent jump previously caused difficult-to-diagnose 404s on `/api/*`).

### Production-Equivalent Stack

For the rare case where Netlify-specific behavior must be validated locally (header rules, redirect priority, edge runtime quirks):

```bash
npm run dev:netlify
```

This is the only place `netlify dev` is invoked. Production deployments use the standard Netlify build pipeline.

### Hot Module Replacement for Edge Functions

The dev plugin watches `netlify/edge-functions/` and reloads handlers on file change. Look for `[edge-dev] reloaded /api/<name>` in the terminal. When a shared library file (`_lib/*.ts` or `src/shared/*.ts`) changes, every handler is re-loaded. Transient compilation errors during typing are tolerated — the most recently working handler stays mounted until the file compiles cleanly.

## Build and Verification

| Script | Purpose |
|---|---|
| `npm run build` | Token parity check (`scripts/check-tokens.mjs`) followed by a production build |
| `npm run build:analyze` | Production build with `dist/stats.html` treemap |
| `npm run preview` | Serve the production build locally |
| `npm run check:tokens` | Validate `tokens.css` ↔ `tokens.ts` parity |
| `npm run verify:bundle-budget` | Build and assert chunk sizes against thresholds |
| `npm run verify:db-indexes` | Confirm Turso has the critical indexes |
| `npm run verify:lighthouse` | Run Lighthouse against the preview build |

## Testing

```bash
npx vitest --run            # full suite once
npx vitest                  # watch mode
npx vitest <pattern>        # filter by file path
npm run test:slow           # opt-in heavy chunk-stability suite (sets SLOW_TESTS=1)
```

Suites are organized by concern:

| Directory | Focus |
|---|---|
| `tests/tokens/` | Token parity, type scale, contrast, primary color, focus ring |
| `tests/components/` | UI primitive rendered states |
| `tests/shell/` | AppShell responsive behavior, sidebar, sign-out |
| `tests/pages/` | Heading order, typography |
| `tests/motion/` | `prefers-reduced-motion` handling |
| `tests/integration/perf/` | Bundle budget, cache headers, content-encoding, route loaders, optimistic mutations |
| `tests/nonregression/` | MVP behavioral parity, streak invariants |
| `tests/unit/` | Pure-logic tests (no DOM, no network) |

Per-suite conventions are documented in `tests/unit/README.md` and `tests/integration/README.md`.

## Database Workflow

Turso (libSQL) is accessed via Drizzle ORM. The schema lives in `src/shared/db/schema.ts`; numbered SQL migrations live in `drizzle/`.

### Applying a Migration

The `drizzle-kit migrate` command does not complete reliably on Windows against Turso, so the project uses a custom runner:

```bash
node scripts/apply-migration.mjs drizzle/<file>.sql
```

The runner splits statements on `--> statement-breakpoint` markers. It tolerates duplicate-column errors so re-running a partially-applied migration is safe; destructive statements should be reviewed before running.

### Adding a Migration

1. Update `src/shared/db/schema.ts`.
2. Run `npx drizzle-kit generate` to emit a new SQL file under `drizzle/`.
3. Inspect the generated SQL — Drizzle is conservative but not omniscient.
4. Apply with `node scripts/apply-migration.mjs drizzle/<new-file>.sql`.
5. Commit the schema change and the SQL file together.

### Query Conventions

- Every query is scoped by the authenticated `userId` from the verified JWT. Do not trust client-supplied user identifiers.
- Use Drizzle's `.get()` for single rows, `.all()` for lists, and `.run()` for inserts, updates, and deletes.
- For vector retrieval, use `vector_top_k` first; fall back to brute-force cosine when the index is sparse (see `netlify/edge-functions/notebooks.ts`).

## Edge Functions

Edge functions live under `netlify/edge-functions/`. They are stateless TypeScript handlers that compile under both Deno (production) and Node (development, via the dev plugin).

### Structure

```
netlify/edge-functions/
├── _lib/
│   ├── auth.ts          requireAuth — verifies the local JWT (HS256) against AUTH_JWT_SECRET
│   ├── db.ts            createDrizzleClient — fresh client per request
│   ├── handler.ts       composeHandler + HttpError — turns thrown errors into JSON envelopes
│   ├── json.ts          jsonResponse, errorResponse helpers
│   ├── localDay.ts      Local-day boundary computation for streak math
│   ├── tavily.ts        Round-robin web search across the Tavily key pool
│   ├── chunking.ts      Document chunking for embedding storage
│   ├── embedding.ts     Mistral embedding wrapper
│   └── skills/          AI persona, voice, formatting, research skill modules
├── ai.ts                /api/ai/* — task parsing, slicing, break recommendations
├── briefing.ts          /api/briefing — morning dashboard rollup
├── chat.ts              /api/chat/*  — multi-session chat with tool-calling
├── habits.ts            /api/habits/* — CRUD + check-off
├── notebooks.ts         /api/notebooks/* — RAG + ingestion
├── pomodoro.ts          /api/pomodoro/sessions — focus session ledger
├── profile.ts           /api/profile — profile and preferences
├── review.ts            /api/review — weekly aggregate
└── tasks.ts             /api/tasks/* — CRUD + completion + reschedule
```

### Adding a New Route

1. Create `netlify/edge-functions/<feature>.ts` with the standard pattern:
   ```typescript
   export default composeHandler(async (req) => {
     const auth = await requireAuth(req)
     // …Drizzle queries scoped by auth.userId…
     return jsonResponse(200, dto)
   })
   ```
2. Register the route in `netlify.toml`:
   ```toml
   [[edge_functions]]
     function = "<feature>"
     path = "/api/<feature>"
   ```
3. The dev plugin auto-mounts the handler on the next request; production deploys pick it up at the next build.

### Logging

Edge functions log to the development terminal. Use a `[<feature>]` prefix on `console.error` to keep the stream readable:

```typescript
console.error('[chat] mistral round had no choice', { round })
```

Avoid logging request bodies that contain user content.

## Authentication

- The application uses a custom JWT-based authentication system backed by Turso. The `@supabase/auth-js` dependency has been completely removed from the project.
- User sign-up, sign-in, sign-out, and token refresh are handled via custom local endpoints: `/api/sign-up`, `/api/sign-in`, `/api/sign-out`, and `/api/refresh`.
- `src/lib/authStore.ts` manages the session (containing `access_token`, `refresh_token`, `expires_at`, and user info) and persists it in `localStorage` under `custom-auth-session`.
- An automated bootstrap flow checks `localStorage` at startup and refreshes the token asynchronously if it expires in less than 5 minutes.
- `useAuthedApi` reads the cached token synchronously — there is no `getSession()` round-trip per request.
- React-query consumers gate their `enabled` flag on `ready && !!session` to avoid the brief pre-bootstrap window where the cached token is `null`.
- Edge functions verify JWTs against the shared `AUTH_JWT_SECRET` (HS256 signature verification) using the `jose` library.

## AI Integration

- **Mistral** is the chat and embedding provider. Chat uses `mistral-small-latest` with tool-calling to ensure fast responses and lower rate-limiting on the free tier; embeddings use the 1024-dimension model.
- **Tavily** powers web search via Mistral tool calls. Up to four keys rotate round-robin in `_lib/tavily.ts`. The tool-calling loop in `chat.ts` caps at three rounds to prevent runaway searches.
- **Citations** are stored as JSON on the assistant message row. The client renders them as inline pills with hover-only previews; clicking is a no-operation. Sources open from the dedicated panel.
- **Notebook embeddings** are stored in Turso `F32_BLOB` columns and retrieved with `vector_top_k`. When the top match falls below a confidence threshold, the function fires a Tavily search, ingests the results as `kind='web'` sources, and re-runs retrieval before responding.

## Google Workspace Bridge (Optional)

The assistant can read Gmail, check Calendar availability, create Calendar events, and create Google Docs by forwarding tool calls to a Google Apps Script Web App that runs inside the user's own Google account. The bridge is deliberately optional — the application functions normally without it.

### Architecture

```
Mistral tool call ──► chat.ts ──► _lib/google.ts ──► Apps Script Web App ──► Gmail / Calendar / Drive
                                       │
                                       └── X-Secret header gates the webhook
```

### Tools exposed to the AI

| Tool | Action |
|---|---|
| `list_unread_emails` | Returns the most recent unread Gmail messages with subject, sender, and snippet. |
| `check_calendar_availability` | Returns the events in a given time window plus an `isFree` flag. |
| `create_calendar_event` | Creates a Calendar event with title, start, optional end, and optional description. |
| `create_doc` | Creates a Google Doc in the user's Drive with title, body, and optional folder ID. |

### Setup

The Apps Script source code lives in `scripts/google-apps-script/Code.gs`. The full deployment guide is in `scripts/google-apps-script/README.md`. In short:

1. Paste `Code.gs` into a new project at [script.google.com](https://script.google.com).
2. Set a `SECRET` script property (any random string).
3. Deploy as a Web app (`Execute as: Me`, `Who has access: Anyone`).
4. Copy the Web app URL.
5. Set `GOOGLE_GAS_WEBHOOK_URL` and `GOOGLE_GAS_SECRET` in `.env`.
6. Restart the dev server.

### Disabled state

When either env var is missing, `callGoogleAction` throws `GoogleNotConfiguredError`. The chat handler catches the error and returns a structured "not configured" payload to Mistral; the assistant tells the user the integration is not set up rather than pretending the action succeeded.

## Design System

- `src/styles/tokens.css` declares CSS custom properties for color, elevation, motion, and typography. `src/styles/tokens.ts` mirrors them as TypeScript values for build-time validation and Tailwind configuration.
- `tailwind.config.ts` wires both layers into utility classes.
- The default spacing scale is **replaced**, not extended. Only `4, 8, 12, 16, 20, 24, 32, 40, 48, 64` exist. Utilities such as `gap-2`, `py-1`, and `h-14` do not compile.
- Arbitrary pixel utilities such as `w-[44px]` typically work, but for size-sensitive elements (switches, sliders, badges) prefer inline `style` properties to bypass the scale entirely.
- Focus rings are globally suppressed via `src/index.css`. Do not introduce `focus-visible:ring-*` utilities.

## Specifications Workflow

Feature work is tracked alongside the codebase in development checkouts. Each spec carries `requirements.md`, `design.md`, and `tasks.md`. When picking up a spec task:

1. Read the matching item in `tasks.md`.
2. Cross-reference the cited requirement (numbered, e.g., `Requirement 7.3`) and the relevant design section (e.g., `S2.4`).
3. Implement, run the relevant tests, and commit with the task identifier in the message.
4. Mark the task complete in `tasks.md`.

The baseline test suites in `tests/unit/` and `tests/integration/` are the regression line. They must not be modified while landing redesign work.

## Coding Conventions

| Convention | Rule |
|---|---|
| Spacing | Use the locked scale (`gap-12`, `p-16`, `mt-24`). Reach for arbitrary values only when none fit. |
| Color | Always go through role tokens (`bg-surface`, `text-on-surface`, `border-border`). Hard-coded hex values are reserved for one-off swatches in pickers. |
| Animations | Use the utility classes from `src/index.css`: `.anim-fade-in`, `.anim-scale-in`, `.anim-stagger > *` (with `--anim-i`). All respect `prefers-reduced-motion`. |
| Citations | Hover-only inline pills. Clicking is a no-operation. Sources open from the side panel. |
| Language | UI strings are English-first. The AI mirrors the user's input language; Indonesian markers are recognition hints for the parser only. |
| Confirmations | Use a toast for confirmations. Use inline state for everything else. Modal confirmation dialogs are reserved for destructive actions only. |
| Imports in edge code | Deno-style explicit `.ts` extensions on relative imports. The dev plugin rewrites them automatically. |

## Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| `Port 5173 already in use` | An orphaned Vite or Netlify CLI process | `netstat -ano \| findstr :5173`, then `Stop-Process -Id <PID> -Force` |
| `Drizzle migrations hang` | `drizzle-kit migrate` is unreliable on this stack | Use `node scripts/apply-migration.mjs <file.sql>` |
| `Generated path "/" for route "/_authed" did not match` | A typed `<Link to="/">` clashes when a layout route and its index share `fullPath: '/'` | Render the home link as a plain `<a>` with `useNavigate` (already in `Sidebar` and `BottomNav`) |
| Switch/slider renders misaligned | The locked Tailwind spacing scale clips arbitrary pixel utilities | Use inline `style` for size-sensitive primitives |
| Mistral 502 after a tool call | Mistral occasionally returns empty `content` after `web_search` | The chat handler falls back to the Tavily answer + citations. If a 502 persists, check the edge log for `[chat] mistral round had no choice` |
| `/api/*` returns 401 immediately | Stale custom refresh token in `localStorage` | Clear `custom-auth-session` key from the application's local storage and sign in again. |
| `[auth] verify failed: AUTH_JWT_SECRET is not set` | `.env` was not loaded | Restart `npm run dev`. The dev plugin reads `.env` at startup. |
| Vite Fast Refresh invalidates after edits | A module exports both components and non-component values | A full reload is harmless; the warning is a Fast Refresh limitation, not a bug |
