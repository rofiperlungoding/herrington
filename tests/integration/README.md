# Integration Tests

Test suites that exercise more than one layer at a time: React-Query against a stubbed API, route loaders, the authentication bootstrap path, and edge-function contract behavior. JSDOM is in play for most of these tests.

---

## Layout

```
tests/integration/
└── perf/
    ├── auth-bootstrap-deadline.spec.tsx   Bootstrap completes within 10 seconds
    ├── bundle-budget.spec.ts              Production chunks remain under per-chunk thresholds
    ├── cache-headers.spec.ts              netlify.toml header rules apply to the right paths
    ├── content-encoding.spec.ts           Vary: Accept-Encoding is set on /api/*
    ├── optimistic-mutations.spec.tsx      Rollback and reconcile paths for tasks and habits
    ├── route-loader.spec.tsx              TanStack Router loaders prefetch and share data
    ├── token-cache.spec.ts                Cached access token flows through useAuthedApi
    └── vendor-chunk-stability.spec.ts     Opt-in heavy suite (set SLOW_TESTS=1)
```

## Running

```bash
# Default suite
npx vitest --run tests/integration

# Include the heavy chunk-stability suite
npm run test:slow
```

## Authoring Conventions

- A test belongs here when it crosses at least two architectural layers — for example, a hook plus an `apiFetch` stub, or a route loader plus the query client.
- For HTTP, stub `fetch` with `vi.spyOn(globalThis, 'fetch')` and return shaped responses. There is no real server.
- For Supabase authentication, prime `useAuthStore` directly. Do not mount a real `onAuthStateChange` listener; tests would coupling to the Supabase SDK's network behavior.
- For TanStack Query, instantiate a fresh `QueryClient` per test to prevent cache bleed between cases.
- Prefer testing the contract (request shape, response shape, error envelope) over implementation details.

## Related Suites

| Suite | Focus |
|---|---|
| `tests/unit/` | Pure-logic tests (no React, no network) |
| `tests/components/` | Single-component render tests |
| `tests/shell/` | AppShell, Sidebar, BottomNav layout and behavior |
| `tests/nonregression/` | MVP behavioral parity and streak invariants |
| `tests/tokens/` | Design-system token parity (CSS ↔ TS ↔ Tailwind) |

## Regression Contract

These tests are tracked under `ui-redesign-tests-and-regression` (Requirements 16.1–16.8). They define the baseline behavior the redesign and performance work must preserve. They must not be modified while landing changes from those specifications.
