/**
 * Property 6: Bundle budget invariant
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 *
 * Uses fast-check to enumerate every JS chunk in `dist/assets/*.js` and
 * asserts that `gzipBytes(chunk) ≤ BundleBudget[bucket(chunk)]` where
 * `bucket` classifies by filename pattern:
 *   - `entry-*` / `index-*` / `main-*` → entry
 *   - `route-*` → per-route
 *   - `vendor-*` → vendor
 *
 * The test is skipped (via `it.skip`) if `dist/` is absent so that
 * unit-test runs without a prior build don't fail.
 *
 * Running order:
 *   npm run build && vitest run tests/integration/perf
 *
 * Spec references:
 *   Requirements 2.1, 2.2, 2.3, 2.4, 12.1
 *   Design: Property 6, PBT-2
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Import budget constants and classifier from the single source of truth.
// Using dynamic path resolution so the .mjs module is accessible from tests.
import {
  BUNDLE_BUDGET,
  classifyChunk,
  thresholdFor,
} from '../../../scripts/bundle-budget.mjs'

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets')
const distExists = existsSync(DIST_ASSETS)

/**
 * Collect all JS chunk files from dist/assets/ with their gzip sizes and
 * bucket classification.
 */
function collectChunks(): Array<{
  filename: string
  gzipBytes: number
  bucket: ReturnType<typeof classifyChunk>
}> {
  if (!distExists) return []
  const entries = readdirSync(DIST_ASSETS)
  return entries
    .filter((name) => /\.(?:m?js|cjs)$/.test(name))
    .map((name) => {
      const buf = readFileSync(join(DIST_ASSETS, name))
      return {
        filename: name,
        gzipBytes: gzipSync(buf).length,
        bucket: classifyChunk(name),
      }
    })
}

const chunks = collectChunks()

// Build a fast-check arbitrary that samples from the actual chunk list.
// This lets fast-check enumerate all chunks as individual test cases,
// providing shrunk counterexamples on failure.
const chunkArbitrary =
  chunks.length > 0
    ? fc.constantFrom(...chunks)
    : fc.constant({ filename: '__placeholder__', gzipBytes: 0, bucket: 'other' as const })

describe('Bundle budget invariant (Property 6)', () => {
  const shouldSkip = !distExists || chunks.length === 0

  // Per-chunk budget: each chunk's gzip size must be within its bucket threshold
  const testFn = shouldSkip ? it.skip : it

  testFn(
    'every JS chunk gzip size ≤ BundleBudget[bucket] for its category',
    () => {
      // Only test chunks that have a defined budget (entry, route, vendor)
      const budgetedChunks = chunks.filter(
        (c) => thresholdFor(c.bucket) !== null,
      )

      if (budgetedChunks.length === 0) {
        // No budgeted chunks found — nothing to assert
        return
      }

      const budgetedArbitrary = fc.constantFrom(...budgetedChunks)

      fc.assert(
        fc.property(budgetedArbitrary, (chunk) => {
          const threshold = thresholdFor(chunk.bucket)!
          expect(
            chunk.gzipBytes,
            `[${chunk.bucket}] ${chunk.filename}: ${chunk.gzipBytes} B gzip exceeds budget of ${threshold} B`,
          ).toBeLessThanOrEqual(threshold)
        }),
        { numRuns: budgetedChunks.length * 10 }, // enumerate all chunks multiple times
      )
    },
  )

  // Total first-paint budget: entry + all vendors + worst-case route ≤ 184_320
  testFn(
    'total first-paint gzip (entry + vendors + worst route) ≤ totalFirstPaintGzipMaxBytes',
    () => {
      const entryGzip = chunks
        .filter((c) => c.bucket === 'entry')
        .reduce((sum, c) => sum + c.gzipBytes, 0)
      const vendorGzip = chunks
        .filter((c) => c.bucket === 'vendor')
        .reduce((sum, c) => sum + c.gzipBytes, 0)
      const routeChunks = chunks.filter((c) => c.bucket === 'route')
      const worstRouteGzip =
        routeChunks.length > 0
          ? Math.max(...routeChunks.map((c) => c.gzipBytes))
          : 0

      const totalFirstPaint = entryGzip + vendorGzip + worstRouteGzip

      expect(
        totalFirstPaint,
        `First-paint total gzip: entry(${entryGzip}) + vendors(${vendorGzip}) + worstRoute(${worstRouteGzip}) = ${totalFirstPaint} B exceeds budget of ${BUNDLE_BUDGET.totalFirstPaintGzipMaxBytes} B`,
      ).toBeLessThanOrEqual(BUNDLE_BUDGET.totalFirstPaintGzipMaxBytes)
    },
  )

  // Property: bucket classification is exhaustive — every .js file gets a
  // known bucket (no chunk falls through to an unexpected category)
  testFn(
    'every JS chunk is classified into a known bucket (entry | route | vendor | other)',
    () => {
      fc.assert(
        fc.property(chunkArbitrary, (chunk) => {
          expect(['entry', 'route', 'vendor', 'css', 'other']).toContain(
            chunk.bucket,
          )
        }),
        { numRuns: chunks.length * 5 },
      )
    },
  )
})
