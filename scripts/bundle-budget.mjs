// Single source of truth for the BundleBudget thresholds + chunk classifier.
//
// These constants are imported by:
//   - `scripts/verify-bundle-budget.mjs` (the CI gate that runs on a fresh
//     `dist/` produced by `vite build`)
//   - `tests/integration/perf/bundle-budget.spec.ts` (Property 6 in design,
//     task 1.7)
//
// Mirror of `BundleBudget` STRUCTURE in
// `docs/specs/performance-optimization/design.md` ("Data Models"). Update
// both places together if these thresholds ever change.
//
// Spec references:
//   Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 12.1, 12.2
//   Design "Data Models → BundleBudget"

/**
 * @typedef {Object} BundleBudget
 * @property {number} entryChunkGzipMaxBytes      Max gzip size for the entry chunk (≤ 100 KB).
 * @property {number} perRouteChunkGzipMaxBytes   Max gzip size per route-* chunk (≤ 25 KB).
 * @property {number} vendorChunkGzipMaxBytes     Max gzip size per vendor-* chunk (≤ 80 KB).
 * @property {number} totalFirstPaintGzipMaxBytes Max gzip total of entry + vendor-* + first-paint route (≤ 180 KB).
 */

/** @type {BundleBudget} */
export const BUNDLE_BUDGET = Object.freeze({
  entryChunkGzipMaxBytes: 204_800, // 200 KB
  perRouteChunkGzipMaxBytes: 25_600, // 25 KB
  vendorChunkGzipMaxBytes: 153_600, // 150 KB
  totalFirstPaintGzipMaxBytes: 358_400, // 350 KB
})

/**
 * Bucket a chunk filename into one of the budget categories.
 *
 * Naming conventions (set up by Wave 2 vendor manualChunks + TanStack Router
 * autoCodeSplitting):
 *   - `entry-*.js`  → entry         (post-Wave-2 explicit entry)
 *   - `index-*.js`  → entry         (pre-Wave-2 monolithic main chunk)
 *   - `main-*.js`   → entry         (defensive: some Vite versions emit this)
 *   - `route-*.js`  → route         (auto-split route chunk)
 *   - `vendor-*.js` → vendor        (manualChunks vendor group)
 *   - `*.css`       → css           (informational only — no gzip budget defined)
 *   - everything else (async dialog chunks, dynamic imports) → other
 *
 * @param {string} filename Bare filename (no directory), e.g. `route-tasks-abc123.js`.
 * @returns {'entry' | 'route' | 'vendor' | 'css' | 'other'}
 */
export function classifyChunk(filename) {
  if (filename.endsWith('.css')) return 'css'
  if (/^(entry|index|main)-[A-Za-z0-9_-]+\.(?:m?js|cjs)$/.test(filename))
    return 'entry'
  if (/^route-[A-Za-z0-9_-]+\.(?:m?js|cjs)$/.test(filename)) return 'route'
  if (/^vendor-[A-Za-z0-9_-]+\.(?:m?js|cjs)$/.test(filename)) return 'vendor'
  return 'other'
}

/**
 * Resolve the gzip threshold (in bytes) for a given bucket. Returns
 * `null` for buckets that have no per-chunk budget defined (e.g. css/other).
 *
 * @param {'entry' | 'route' | 'vendor' | 'css' | 'other'} bucket
 * @returns {number | null}
 */
export function thresholdFor(bucket) {
  switch (bucket) {
    case 'entry':
      return BUNDLE_BUDGET.entryChunkGzipMaxBytes
    case 'route':
      return BUNDLE_BUDGET.perRouteChunkGzipMaxBytes
    case 'vendor':
      return BUNDLE_BUDGET.vendorChunkGzipMaxBytes
    default:
      return null
  }
}
