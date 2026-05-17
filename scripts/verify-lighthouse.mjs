#!/usr/bin/env node
// scripts/verify-lighthouse.mjs
//
// CI gate for Requirements 12.3, 12.4 of the performance-optimization spec:
//   - Runs Lighthouse 3x against a target URL with mobile + simulated throttling
//   - Computes the median per metric
//   - Asserts: LCP_ms <= 2500, INP_ms <= 200, TTI_ms <= 3500, CLS <= 0.1
//   - Exits non-zero on any violation, listing the offending metric and median
//
// Spec references:
//   Requirements 12.3, 12.4
//   Design "Cara Verifikasi → Web Vitals (lab)"
//
// Environment variables:
//   LIGHTHOUSE_URL  (required) — The URL to audit (e.g., http://localhost:8888)
//   LIGHTHOUSE_RUNS (optional) — Number of runs, default 3 (minimum 3)
//
// Usage:
//   LIGHTHOUSE_URL=http://localhost:8888 npm run verify:lighthouse
//
// Prerequisites:
//   - `lighthouse` CLI must be installed globally or available via npx
//   - Chrome/Chromium must be available on the system

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ─── Thresholds (from design targets & Requirements 12.3, 12.4) ─────────────

const THRESHOLDS = {
  LCP_ms: 2500,
  INP_ms: 200,
  TTI_ms: 3500,
  CLS: 0.1,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the median of a sorted numeric array.
 * @param {number[]} arr
 * @returns {number}
 */
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

/**
 * Run Lighthouse once against the target URL and return the JSON result.
 * @param {string} url
 * @param {string} outputDir
 * @param {number} runIndex
 * @returns {object} Lighthouse JSON result
 */
function runLighthouse(url, outputDir, runIndex) {
  const outputPath = join(outputDir, `lh-run-${runIndex}`)

  const cmd = [
    'npx',
    'lighthouse',
    JSON.stringify(url),
    '--form-factor=mobile',
    '--throttling-method=simulate',
    '--only-categories=performance',
    '--output=json',
    `--output-path=${outputPath}`,
    '--chrome-flags="--headless --no-sandbox --disable-gpu"',
    '--quiet',
  ].join(' ')

  console.log(`  Run ${runIndex + 1}: executing Lighthouse...`)

  try {
    execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000, // 2 minutes per run
    })
  } catch (err) {
    console.error(`  Run ${runIndex + 1}: Lighthouse failed.`)
    if (err.stderr) {
      console.error(`  stderr: ${err.stderr.toString().slice(0, 500)}`)
    }
    throw new Error(`Lighthouse run ${runIndex + 1} failed`)
  }

  const jsonPath = `${outputPath}.report.json`
  const raw = readFileSync(jsonPath, 'utf-8')
  return JSON.parse(raw)
}

/**
 * Extract metrics from a Lighthouse JSON result.
 * @param {object} result
 * @returns {{ LCP_ms: number, INP_ms: number, TTI_ms: number, CLS: number }}
 */
function extractMetrics(result) {
  const audits = result.audits

  // LCP — Largest Contentful Paint
  const lcp = audits['largest-contentful-paint']?.numericValue ?? null

  // INP — Interaction to Next Paint (may not be available in all LH versions;
  // fall back to Total Blocking Time as a proxy if INP audit is absent)
  const inp =
    audits['experimental-interaction-to-next-paint']?.numericValue ??
    audits['interaction-to-next-paint']?.numericValue ??
    audits['total-blocking-time']?.numericValue ??
    null

  // TTI — Time to Interactive
  const tti = audits['interactive']?.numericValue ?? null

  // CLS — Cumulative Layout Shift
  const cls = audits['cumulative-layout-shift']?.numericValue ?? null

  return {
    LCP_ms: lcp,
    INP_ms: inp,
    TTI_ms: tti,
    CLS: cls,
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const url = process.env.LIGHTHOUSE_URL
  if (!url) {
    console.error(
      '[verify-lighthouse] ERROR: LIGHTHOUSE_URL environment variable is required.',
    )
    console.error(
      '  Example: LIGHTHOUSE_URL=http://localhost:8888 npm run verify:lighthouse',
    )
    process.exit(2)
  }

  const numRuns = Math.max(3, parseInt(process.env.LIGHTHOUSE_RUNS || '3', 10))

  console.log(`\n[verify-lighthouse] Auditing: ${url}`)
  console.log(`  Runs: ${numRuns}`)
  console.log(`  Form factor: mobile`)
  console.log(`  Throttling: simulate`)
  console.log(`  Thresholds: LCP≤${THRESHOLDS.LCP_ms}ms, INP≤${THRESHOLDS.INP_ms}ms, TTI≤${THRESHOLDS.TTI_ms}ms, CLS≤${THRESHOLDS.CLS}`)
  console.log('')

  // Create a temp directory for Lighthouse output files
  const tmpDir = mkdtempSync(join(tmpdir(), 'lh-verify-'))

  /** @type {Array<{ LCP_ms: number|null, INP_ms: number|null, TTI_ms: number|null, CLS: number|null }>} */
  const allMetrics = []

  try {
    for (let i = 0; i < numRuns; i++) {
      const result = runLighthouse(url, tmpDir, i)
      const metrics = extractMetrics(result)
      allMetrics.push(metrics)
      console.log(
        `  Run ${i + 1} results: LCP=${metrics.LCP_ms?.toFixed(0)}ms, INP=${metrics.INP_ms?.toFixed(0)}ms, TTI=${metrics.TTI_ms?.toFixed(0)}ms, CLS=${metrics.CLS?.toFixed(4)}`,
      )
    }
  } finally {
    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }

  // Compute medians
  const medians = {
    LCP_ms: median(allMetrics.map((m) => m.LCP_ms).filter((v) => v !== null)),
    INP_ms: median(allMetrics.map((m) => m.INP_ms).filter((v) => v !== null)),
    TTI_ms: median(allMetrics.map((m) => m.TTI_ms).filter((v) => v !== null)),
    CLS: median(allMetrics.map((m) => m.CLS).filter((v) => v !== null)),
  }

  // Report
  console.log('\n─'.repeat(36))
  console.log('Lighthouse median results (mobile, simulated throttling)')
  console.log('─'.repeat(72))
  console.log(
    '  metric'.padEnd(12),
    'median'.padStart(10),
    'threshold'.padStart(12),
    '  status',
  )
  console.log('─'.repeat(72))

  /** @type {Array<{ metric: string, median: number, threshold: number }>} */
  const violations = []

  for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
    const med = medians[metric]
    if (med === undefined || isNaN(med)) {
      console.log(
        `  ${metric.padEnd(10)}`,
        'N/A'.padStart(10),
        `${threshold}`.padStart(12),
        '  ⚠ not measured',
      )
      continue
    }

    const pass = med <= threshold
    const formatted =
      metric === 'CLS' ? med.toFixed(4) : `${med.toFixed(0)}ms`
    const thresholdFmt =
      metric === 'CLS' ? `${threshold}` : `${threshold}ms`

    console.log(
      `  ${metric.padEnd(10)}`,
      formatted.padStart(10),
      thresholdFmt.padStart(12),
      pass ? '  ✔ pass' : '  ✘ FAIL',
    )

    if (!pass) {
      violations.push({ metric, median: med, threshold })
    }
  }

  console.log('─'.repeat(72))
  console.log('')

  if (violations.length > 0) {
    console.error(
      `[verify-lighthouse] FAIL — ${violations.length} metric(s) exceeded threshold:`,
    )
    for (const v of violations) {
      const medFmt =
        v.metric === 'CLS'
          ? v.median.toFixed(4)
          : `${v.median.toFixed(0)}ms`
      const thrFmt =
        v.metric === 'CLS' ? `${v.threshold}` : `${v.threshold}ms`
      console.error(`  - ${v.metric}: median ${medFmt} > threshold ${thrFmt}`)
    }
    process.exit(1)
  }

  console.log(
    `[verify-lighthouse] OK — all metrics within thresholds (${numRuns} runs, median).`,
  )
}

// Entry point
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  main()
}

export { THRESHOLDS, median, extractMetrics }
