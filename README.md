# Herrington

> *In good order.*

Herrington is a personal life-management workspace — tasks, habits, an AI assistant with retrieval-augmented knowledge bases, a morning briefing, and time tracking — combined under a single quiet shell. Built as a thin React surface over a stateless edge-function API and a Turso (libSQL) database.

The application targets a single user (the developer-owner) but is engineered to enterprise standards: token-driven design system, single-source authentication, optimistic mutations with rollback, contract-validated API responses, and a regression-tested baseline.

For brand identity, voice, and visual standards see [`BRAND.md`](./BRAND.md).

---

## Table of Contents

- [Capabilities](#capabilities)
- [Technology Stack](#technology-stack)
- [Repository Layout](#repository-layout)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Architectural Principles](#architectural-principles)
- [Specifications & Documentation](#specifications--documentation)
- [License](#license)

---

## Capabilities

| Module | Description |
|---|---|
| **Tasks** | Natural-language input parsed by Mistral into structured records (title, category, deadline, tags). Includes a manual form, multi-tag filtering, AI-assisted task slicing, and a single-task focus mode. |
| **Habits** | Daily and one-time habits with a streak engine. Streak transitions are computed by a pure function shared between client (optimistic) and server (authoritative) so the two never diverge. |
| **AI Assistant** | Multi-session chat with persona awareness (preferred name, focus areas, headline), time awareness (local date/time injected per turn), and live web research via Tavily tool-calling. Sources are stored as inline citation pills. |
| **Notebooks** | Client-side document extraction (PDF, DOCX, XLSX, CSV, TXT) with embedding storage in Turso `F32_BLOB`. Retrieval uses `vector_top_k` with a brute-force cosine fallback; thin matches automatically trigger external research and re-retrieval. |
| **Pomodoro** | Per-task focus sessions logged to a server-side append-only ledger. A floating timer persists across navigation and writes a session row at completion or early stop (≥ 60 s). |
| **Weekly Review** | Server-aggregated rollup of the last seven days: completion rate, reschedule offenders, habit skip rate, total focus minutes, and tag breakdown. |
| **Smart Notifications** | Browser-native push for deadlines under two hours and end-of-day streak preservation reminders. Client-only, opt-in, no third-party push provider. |
| **Google Workspace bridge** *(optional)* | Read recent unread Gmail, check Calendar availability, create Calendar events and Google Docs — through an Apps Script Web App that runs in the user's own Google account. No third-party automation service, no paid integration tier. See [`scripts/google-apps-script/README.md`](./scripts/google-apps-script/README.md). |
| **Profile** | Identity, avatar (emoji + tint), accent palette, and per-tile dashboard preferences. Drives personalization in Chat and Dashboard. |
| **Morning Briefing** | Editorial dashboard combining live FX, equities, crypto, and weather alongside a today-task summary. |

## Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18, Vite 5, TypeScript 5 | SWC-powered Fast Refresh |
| Routing | TanStack Router | File-based, automatic code splitting |
| State | Zustand (UI), TanStack Query (server) | Optimistic mutations with cached-snapshot rollback |
| Styling | Tailwind 3 + design-system tokens | Default spacing scale replaced with an editorial scale |
| UI primitives | Radix Primitives + custom shadcn-style set | All components live under `src/components/ui` |
| Backend | Edge functions (Deno-compatible TypeScript) | Mounted by an in-process Vite plugin in development |
| Database | Turso (libSQL) via Drizzle ORM | Vector search via `F32_BLOB` |
| Auth | Supabase Auth (`@supabase/auth-js` directly) | Auth-only client; full SDK is excluded from the bundle |
| AI | Mistral (chat + embeddings), Tavily (web search) | Round-robin Tavily keys for free-tier extension |
| Hosting | Netlify (static front-end + edge functions) | Used in production only; development is plain Vite |

## Repository Layout

```
.
├── src/
│   ├── routes/                 TanStack Router file-based routes
│   ├── components/
│   │   ├── ui/                 Token-driven UI primitives
│   │   ├── layout/             AppShell, Sidebar, BottomNav
│   │   ├── tasks/ habits/ chat/ notebooks/ pomodoro/ profile/
│   ├── hooks/                  Data and domain hooks
│   ├── lib/                    apiFetch, authStore, queryClient, timezone, supabaseClient
│   ├── shared/                 Cross-runtime contracts: db schema, API zod schemas, pure logic
│   ├── stores/                 Zustand stores (UI + Pomodoro engine state)
│   └── styles/                 tokens.css and tokens.ts (CSS / TS mirrors)
├── netlify/
│   └── edge-functions/         Stateless API handlers
│       └── _lib/               Auth, DB client, JSON helpers, AI skills, Tavily pool
├── drizzle/                    Numbered SQL migrations
├── scripts/                    Build verification, migration runner, edge-dev-plugin
├── tests/                      Vitest suites with per-folder READMEs
├── public/                     Static assets (favicon, fonts)
├── netlify.toml                Production routing and cache headers
├── DEVELOPMENT.md              Day-to-day workflow guide
└── README.md                   This file
```

## Getting Started

### Prerequisites

- Node.js 20 or newer
- A Supabase project (URL plus publishable key)
- A Turso database (URL plus auth token)
- API keys for Mistral and Tavily (one to four Tavily keys are accepted)
- Netlify CLI **only** if you intend to validate Netlify-specific behavior locally

### Installation

```bash
npm install
cp .env.example .env
# populate .env with the values described in `.env.example`
npm run dev
```

The development server runs on `http://localhost:5173` and serves the front-end and edge-function API on the same port. See `DEVELOPMENT.md` for the full workflow, database migration procedure, and edge-function reload behavior.

### Required Environment Variables

The complete reference, including comments, lives in `.env.example`. The most-used variables:

| Variable | Scope | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser | New-style publishable auth key |
| `SUPABASE_URL` | Edge | Same URL; used to fetch JWKS for token verification |
| `TURSO_DATABASE_URL` | Edge | libSQL endpoint |
| `TURSO_AUTH_TOKEN` | Edge | Database auth token |
| `MISTRAL_API_KEY` | Edge | Chat completions and embeddings |
| `TAVILY_API_KEYS` | Edge | Comma-separated; rotated round-robin per request |
| `GOOGLE_GAS_WEBHOOK_URL` | Edge | Optional. URL of the user's deployed Apps Script Web App. |
| `GOOGLE_GAS_SECRET` | Edge | Optional. Shared secret for the GAS Web App; required when the URL is set. |

## Available Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite development server with edge functions on `http://localhost:5173` |
| `npm run dev:netlify` | Run the production-equivalent stack via Netlify CLI for header-rule and proxy validation |
| `npm run build` | Token parity check followed by a production build |
| `npm run build:analyze` | Production build with `dist/stats.html` bundle visualisation |
| `npm run preview` | Serve the production build locally |
| `npm run check:tokens` | Validate parity between `tokens.css` and `tokens.ts` |
| `npm run verify:bundle-budget` | Build and assert chunk sizes against the per-chunk thresholds |
| `npm run verify:db-indexes` | Confirm the production database has the indexes that hot queries require |
| `npm run verify:lighthouse` | Run Lighthouse against the local preview build |
| `npx vitest --run` | Execute the full test suite once |
| `npm run test:slow` | Opt-in heavy chunk-stability suite |

## Architectural Principles

### Single Breakpoint
A single `md: 768px` media query drives the responsive layout. Below it, the application uses a bottom navigation bar; at or above it, a left-hand sidebar. There are no `sm` / `lg` / `xl` / `2xl` breakpoints in the configuration.

### Locked Spacing Scale
Tailwind's default spacing scale is **replaced** (not extended) with an editorial scale of `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Utilities such as `gap-2` or `py-1` do not compile. Size-sensitive elements (switches, sliders) use inline `style` properties to bypass the scale entirely.

### Token Parity
Color, elevation, motion, and typography tokens live in `src/styles/tokens.css` and are mirrored as TypeScript values in `src/styles/tokens.ts`. The `scripts/check-tokens.mjs` script enforces parity at build time.

### Synchronous Authentication
A module-level subscription to `supabase.auth.onAuthStateChange` populates a Zustand store before any component renders. The API fetcher reads the cached access token synchronously, eliminating the per-request `await getSession()` round-trip.

### Optimistic by Default
All write paths (tasks, habits, profile, pomodoro) use `useMutation` with `onMutate` snapshotting and `onError` rollback. The user interface updates first; the server confirms second.

### Stateless Edge Functions
Each edge function validates the Supabase JWT, opens a fresh Drizzle client, and scopes every query by the verified `userId`. There is no server-side session state.

### Pure Streak Logic
The streak transition function in `src/shared/streak/computeNextStreak.ts` is the single source of truth and is shared verbatim between the client (optimistic update) and the server (authoritative update). They cannot diverge.

### Inline Citations
Citations are rendered as inline pills with hover-only previews. Clicking is a no-operation; the source panel on the side opens documents.

### Single-Port Development
The development server runs Vite on port 5173 with `strictPort: true`. A custom Vite plugin (`scripts/edge-dev-plugin.ts`) mounts every file under `netlify/edge-functions/*.ts` at the corresponding `/api/*` path and shims `globalThis.Deno.env` so the edge code runs unchanged under Node.

## Specifications & Documentation

Feature specifications and design notes live alongside the codebase in development checkouts. Per-folder documentation is maintained for the test suites:

- `tests/unit/README.md` — pure-logic test conventions
- `tests/integration/README.md` — multi-layer integration test conventions

## License

Proprietary. This repository is not open-source and is not licensed for redistribution.
