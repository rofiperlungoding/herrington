import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit test: `formatLocal` Intl.DateTimeFormat instance reuse.
 *
 * Validates: Requirements 9.5
 *
 * The module `src/lib/date.ts` hoists a single `Intl.DateTimeFormat` instance
 * at module scope so that `formatLocal` never constructs a new formatter per
 * invocation. This test spies on the `Intl.DateTimeFormat` constructor and
 * asserts that calling `formatLocal` 100 times with different timestamps does
 * NOT trigger additional constructor calls beyond the initial module-level
 * allocation.
 */
describe('formatLocal — Intl.DateTimeFormat instance reuse', () => {
  const OriginalDateTimeFormat = Intl.DateTimeFormat
  let callCount: number

  beforeEach(() => {
    callCount = 0
    // Replace Intl.DateTimeFormat with a wrapper that counts calls but
    // delegates to the real constructor so the returned instance works.
    ;(globalThis.Intl as any).DateTimeFormat = function (...args: any[]) {
      callCount++
      return new OriginalDateTimeFormat(...args)
    }
    // Preserve prototype so instanceof checks still work
    ;(globalThis.Intl.DateTimeFormat as any).prototype =
      OriginalDateTimeFormat.prototype
    ;(globalThis.Intl.DateTimeFormat as any).supportedLocalesOf =
      OriginalDateTimeFormat.supportedLocalesOf
  })

  afterEach(() => {
    globalThis.Intl.DateTimeFormat = OriginalDateTimeFormat
  })

  it('does not create a new Intl.DateTimeFormat on each call (at most once per unique option combination)', async () => {
    // Reset the module registry so the module re-evaluates with our spy active.
    vi.resetModules()

    // Dynamically import to trigger fresh module evaluation with the spy.
    const { formatLocal } = await import('../../../src/lib/date')

    // Record how many constructor calls happened during module load.
    // The module creates exactly one instance at module scope.
    const callsAfterImport = callCount
    expect(callsAfterImport).toBeLessThanOrEqual(1)

    // Call formatLocal 100 times with different Unix-second timestamps
    // spanning a wide range of dates.
    const baseTimestamp = 1_700_000_000 // ~Nov 2023
    for (let i = 0; i < 100; i++) {
      const result = formatLocal(baseTimestamp + i * 86_400) // each call is a different day
      // Sanity: the function should return a non-empty string
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    }

    // After 100 calls, the constructor should NOT have been called again.
    // The total calls should still be the same as right after import
    // (at most 1 per unique option combination — in this case just 1).
    const additionalCalls = callCount - callsAfterImport
    expect(additionalCalls).toBe(0)
  })

  it('reuses the cached instance across varied timestamp inputs', async () => {
    vi.resetModules()

    const { formatLocal } = await import('../../../src/lib/date')
    const callsAfterImport = callCount

    // Use a diverse set of timestamps: past, present, future
    const timestamps = [
      0, // epoch
      946_684_800, // 2000-01-01
      1_609_459_200, // 2021-01-01
      1_700_000_000, // ~Nov 2023
      1_735_689_600, // 2025-01-01
      2_000_000_000, // ~May 2033
    ]

    for (const ts of timestamps) {
      const result = formatLocal(ts)
      expect(result).toBeTruthy()
    }

    // No additional DateTimeFormat instances should have been created
    const additionalCalls = callCount - callsAfterImport
    expect(additionalCalls).toBe(0)
  })
})
