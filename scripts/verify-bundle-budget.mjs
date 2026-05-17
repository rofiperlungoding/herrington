#!/usr/bin/env node
// scripts/verify-bundle-budget.mjs
//
// CI gate for Requirement 2 of the performance-optimization spec:
//   - Reads every dist/assets/*.js and dist/assets/*.css
//   - Computes raw + gzip size per chunk
//   - Asserts each chunk against the BundleBudget thresholds defined in
//     `scripts/bundle-budget.mjs` (single source of truth, also imported by
//     the property test in tests/integration/perf/bundle-budget.spec.ts)
//   - Exits non-zero on any violation, logging the offending chunk name,
//     actual gzip size, threshold, and the budget bucket
//
// Spec references:
//   Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 12.1, 12.2
//   Design "Cara Verifikasi → Build / bundle metrics", "BundleBudget"
//
// Usage:
//   npm run build && npm run verify:bundle-budget
//
// On the pre-Wave-2 build this script is *expected* to exit non-zero — the
// monolithic entry chunk currently exceeds both the entry-chunk budget and
// the total first-paint budget. That failure is the gate that Wave 2 + Wave 3
// work to satisfy; do not silence it.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

import {
  BUNDLE_BUDGET,
  classifyChunk,
  thresholdFor,
} from './bundle-budget.mjs'

const ASSETS_DIR = join(process.cwd(), 'dist', 'assets')

/**
 * Format a byte count as `<bytes> B (<KB> KB)` for readable log output.
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  return `${n} B (${(n / 1024).toFixed(1)} KB)`
}

/**
 * gzip with Node's default compression level (6). Same level used by
 * scripts/baseline-bundle-metrics.mjs and rollup's gzip estimator, so
 * the numbers are reproducible across tooling.
 * @param {Buffer} buf
 * @returns {number}
 */
function gzipSize(buf) {
  return gzipSync(buf).length
}

/**
 * @returns {Array<{ filename: string, rawBytes: number, gzipBytes: number, bucket: ReturnType<typeof classifyChunk> }>}
 */
function readChunks() {
  if (!existsSync(ASSETS_DIR)) {
    console.error(
      `[verify-bundle-budget] dist/assets/ does not exist. Run \`vite build\` first.`,
    )
    process.exit(2)
  }
  const entries = readdirSync(ASSETS_DIR)
  const chunks = []
  for (const name of entries) {
    const full = join(ASSETS_DIR, name)
    const st = statSync(full)
    if (!st.isFile()) continue
    if (!/\.(?:m?js|cjs|css)$/.test(name)) continue
    const buf = readFileSync(full)
    chunks.push({
      filename: basename(full),
      rawBytes: buf.byteLength,
      gzipBytes: gzipSize(buf),
      bucket: classifyChunk(name),
    })
  }
  return chunks
}

function main() {
  const chunks = readChunks()
  if (chunks.length === 0) {
    console.error(
      `[verify-bundle-budget] No JS/CSS files found in ${ASSETS_DIR}.`,
    )
    process.exit(2)
  }

  /** @type {Array<{ filename: string, bucket: string, gzipBytes: number, threshold: number }>} */
  const violations = []

  // Per-chunk budget enforcement (Requirements 2.1, 2.2, 2.3, 2.5)
  for (const ch of chunks) {
    const threshold = thresholdFor(ch.bucket)
    if (threshold === null) continue // css / other have no per-chunk budget
    if (ch.gzipBytes > threshold) {
      violations.push({
        filename: ch.filename,
        bucket: ch.bucket,
        gzipBytes: ch.gzipBytes,
        threshold,
      })
    }
  }

  // First-paint total budget (Requirement 2.4): entry + all vendor-* + the
  // single largest route-* chunk (worst-case first paint route).
  const entry = chunks.filter((c) => c.bucket === 'entry')
  const vendors = chunks.filter((c) => c.bucket === 'vendor')
  const routes = chunks.filter((c) => c.bucket === 'route')

  const entryGz = entry.reduce((acc, c) => acc + c.gzipBytes, 0)
  const vendorsGz = vendors.reduce((acc, c) => acc + c.gzipBytes, 0)
  const worstRouteGz = routes.length
    ? Math.max(...routes.map((c) => c.gzipBytes))
    : 0
  const firstPaintGz = entryGz + vendorsGz + worstRouteGz

  // Render summary table
  console.log('\nBundle budget report')
  console.log('─'.repeat(72))
  console.log(
    'bucket'.padEnd(8),
    'gzip'.padStart(12),
    'raw'.padStart(12),
    '  filename',
  )
  console.log('─'.repeat(72))
  for (const ch of [...chunks].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
    console.log(
      ch.bucket.padEnd(8),
      `${ch.gzipBytes}`.padStart(12),
      `${ch.rawBytes}`.padStart(12),
      `  ${ch.filename}`,
    )
  }
  console.log('─'.repeat(72))
  console.log(
    `first-paint total gzip = entry(${entryGz}) + vendors(${vendorsGz}) + worstRoute(${worstRouteGz}) = ${firstPaintGz} B`,
  )
  console.log(
    `thresholds: entry≤${BUNDLE_BUDGET.entryChunkGzipMaxBytes} route≤${BUNDLE_BUDGET.perRouteChunkGzipMaxBytes} vendor≤${BUNDLE_BUDGET.vendorChunkGzipMaxBytes} firstPaint≤${BUNDLE_BUDGET.totalFirstPaintGzipMaxBytes}`,
  )
  console.log('')

  if (violations.length > 0) {
    console.error(`✘ Per-chunk budget violations (${violations.length}):`)
    for (const v of violations) {
      console.error(
        `  - [${v.bucket}] ${v.filename}: ${fmt(v.gzipBytes)} > threshold ${fmt(v.threshold)}`,
      )
    }
  }

  let firstPaintViolation = false
  if (firstPaintGz > BUNDLE_BUDGET.totalFirstPaintGzipMaxBytes) {
    firstPaintViolation = true
    console.error(
      `✘ First-paint total budget violated: ${fmt(firstPaintGz)} > threshold ${fmt(BUNDLE_BUDGET.totalFirstPaintGzipMaxBytes)}`,
    )
  }

  if (violations.length > 0 || firstPaintViolation) {
    console.error('')
    console.error(
      `[verify-bundle-budget] FAIL — bundle budget not met. See offenders above.`,
    )
    process.exit(1)
  }

  console.log(
    `[verify-bundle-budget] OK — all chunks within budget (${chunks.length} files inspected).`,
  )
}

// Entry point: only run when invoked directly, not when imported (so tests
// can reuse helpers without triggering process.exit).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  main()
}

export { readChunks, gzipSize }
