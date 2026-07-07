// @vitest-environment jsdom
/**
 * Property 5: Same-origin auth invariant
 *
 * **Validates: Requirements 10.3, 10.4**
 *
 * Uses fast-check to enumerate event sequences over
 * { SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT } and asserts that after each
 * event, `getCachedAccessToken()` returns the value from the latest
 * SIGNED_IN/TOKEN_REFRESHED event (or `null` after SIGNED_OUT).
 *
 * This proves the token cache never lags one step behind — the invariant
 * required by the synchronous token read in `useAuthedApi`.
 *
 * Spec references:
 *   Requirements: 10.3, 10.4
 *   Design: Property 5, PBT-1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ─── Types ──────────────────────────────────────────────────────────────────

type AuthEvent = 'SIGNED_IN' | 'TOKEN_REFRESHED' | 'SIGNED_OUT'

interface AuthEventEntry {
  event: AuthEvent
  /** Token string for SIGNED_IN / TOKEN_REFRESHED; null for SIGNED_OUT */
  token: string | null
}

// ─── Mock setup ─────────────────────────────────────────────────────────────

// Supabase is no longer used. The token cache is driven directly by authStore.setSession().

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSession(accessToken: string) {
  return {
    access_token: accessToken,
    refresh_token: 'refresh_' + accessToken,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', email: 'test@example.com' },
  }
}

let __globalUseAuthStore: any; // captured in beforeEach

/**
 * Simulate an auth event by setting the session directly in the store.
 */
function fireAuthEvent(entry: AuthEventEntry) {
  const session = entry.token ? makeSession(entry.token) : null
  if (__globalUseAuthStore) {
    __globalUseAuthStore.getState().setSession(session)
  }
}

/**
 * Compute the expected token after processing a sequence of auth events.
 * The expected value is the token from the last SIGNED_IN or TOKEN_REFRESHED
 * event, or null if the last relevant event was SIGNED_OUT.
 */
function expectedTokenAfterSequence(events: AuthEventEntry[]): string | null {
  let token: string | null = null
  for (const entry of events) {
    if (entry.event === 'SIGNED_IN' || entry.event === 'TOKEN_REFRESHED') {
      token = entry.token
    } else if (entry.event === 'SIGNED_OUT') {
      token = null
    }
  }
  return token
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Generate a unique token string for each event */
const tokenArb = fc.uuid().map((uuid) => `tok_${uuid}`)

/** Generate a single auth event entry */
const authEventEntryArb: fc.Arbitrary<AuthEventEntry> = fc.oneof(
  tokenArb.map((token) => ({ event: 'SIGNED_IN' as const, token })),
  tokenArb.map((token) => ({ event: 'TOKEN_REFRESHED' as const, token })),
  fc.constant({ event: 'SIGNED_OUT' as const, token: null }),
)

/** Generate a non-empty sequence of auth events (1–20 events) */
const authEventSequenceArb = fc.array(authEventEntryArb, { minLength: 1, maxLength: 20 })

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Token cache state invariant (Property 5)', () => {
  let getCachedAccessToken: () => string | null
  let useAuthStore: { getState: () => { accessToken: string | null }; setState: (state: Record<string, unknown>) => void }

  beforeEach(async () => {
    // Stub localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })

    // Dynamically import the auth store so it is fresh.
    vi.resetModules()

    const authModule = await import('@/lib/authStore')
    getCachedAccessToken = authModule.getCachedAccessToken
    useAuthStore = authModule.useAuthStore as unknown as typeof useAuthStore
    __globalUseAuthStore = useAuthStore

    // Reset store to initial state
    useAuthStore.setState({
      session: null,
      accessToken: null,
      ready: false,
      timedOut: false,
    })
  })

  it('getCachedAccessToken() always reflects the latest auth event token (never lags)', () => {
    fc.assert(
      fc.property(authEventSequenceArb, (events) => {
        // Reset store state before each property run
        useAuthStore.setState({
          session: null,
          accessToken: null,
          ready: false,
          timedOut: false,
        })

        // Fire each event and verify the invariant holds after EVERY step
        for (let i = 0; i < events.length; i++) {
          fireAuthEvent(events[i])

          // The expected token is determined by the subsequence up to this point
          const expected = expectedTokenAfterSequence(events.slice(0, i + 1))
          const actual = getCachedAccessToken()

          expect(
            actual,
            `After event #${i + 1} (${events[i].event}), expected token "${expected}" but got "${actual}"`,
          ).toBe(expected)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('getCachedAccessToken() returns null when no events have been fired', () => {
    // After module load with no events, token should be null
    expect(getCachedAccessToken()).toBeNull()
  })

  it('SIGNED_OUT always clears the token regardless of prior state', () => {
    fc.assert(
      fc.property(
        // Generate 1-10 SIGNED_IN/TOKEN_REFRESHED events followed by SIGNED_OUT
        fc.array(
          fc.oneof(
            tokenArb.map((token) => ({ event: 'SIGNED_IN' as const, token })),
            tokenArb.map((token) => ({ event: 'TOKEN_REFRESHED' as const, token })),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (priorEvents) => {
          // Reset store
          useAuthStore.setState({
            session: null,
            accessToken: null,
            ready: false,
            timedOut: false,
          })

          // Fire prior events to establish a non-null token
          for (const entry of priorEvents) {
            fireAuthEvent(entry)
          }

          // Token should be non-null after SIGNED_IN/TOKEN_REFRESHED events
          expect(getCachedAccessToken()).not.toBeNull()

          // Fire SIGNED_OUT
          fireAuthEvent({ event: 'SIGNED_OUT', token: null })

          // Token must be null
          expect(getCachedAccessToken()).toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('TOKEN_REFRESHED updates the token to the new value (not stale)', () => {
    fc.assert(
      fc.property(
        tokenArb,
        tokenArb,
        (initialToken, refreshedToken) => {
          // Reset store
          useAuthStore.setState({
            session: null,
            accessToken: null,
            ready: false,
            timedOut: false,
          })

          // Sign in with initial token
          fireAuthEvent({ event: 'SIGNED_IN', token: initialToken })
          expect(getCachedAccessToken()).toBe(initialToken)

          // Refresh to new token
          fireAuthEvent({ event: 'TOKEN_REFRESHED', token: refreshedToken })
          expect(getCachedAccessToken()).toBe(refreshedToken)
        },
      ),
      { numRuns: 100 },
    )
  })
})
