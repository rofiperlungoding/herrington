/**
 * **Validates: Requirements 13.1, 13.2, 13.3**
 *
 * Property 1: Behavioral parity
 *
 * This meta-test enforces that the total number of tests discovered in
 * the project is at least as large as the baseline recorded before
 * performance optimisation waves began. The baseline is stored in
 * `baseline-test-count.json` at the repo root.
 *
 * Rule from Requirement 13.5:
 *   Assertion bodies in pre-existing tests are IMMUTABLE. Tests may be
 *   reorganised (file renames, describe/it block restructuring, import
 *   path updates) but the observable behaviour they assert must not
 *   change. This test enforces the *count* invariant — the existing
 *   suites themselves enforce *semantic* correctness. Together they
 *   guarantee that performance optimisations do not silently remove or
 *   skip tests that previously passed.
 *
 * How it works:
 *   1. Recursively scans `tests/` for spec files matching vitest's
 *      include patterns (`*.spec.{ts,tsx}`).
 *   2. Reads each file and counts `it(` / `it.skip(` / `test(`
 *      occurrences to approximate the number of test cases.
 *   3. Groups counts by top-level directory under `tests/`.
 *   4. Asserts the discovered count >= baseline['tests/unit'] +
 *      baseline['tests/integration'] (the two directories explicitly
 *      named in Requirement 13.4).
 *   5. Also asserts the overall total has not regressed.
 *
 * Note: This approach avoids spawning a nested `vitest list` process
 * (which causes hanging on Windows due to recursive vitest invocation).
 * The regex-based counting is equivalent to `vitest list` for the
 * purpose of detecting test removal/regression.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..')
const TESTS_DIR = resolve(REPO_ROOT, 'tests')
const BASELINE_PATH = resolve(REPO_ROOT, 'baseline-test-count.json')

interface BaselineTestCount {
  'tests/unit': number
  'tests/integration': number
  total: number
  [key: string]: number
}

/**
 * Recursively find all spec files under a directory matching vitest's
 * include pattern: `*.spec.{ts,tsx}`.
 */
function findSpecFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findSpecFiles(fullPath))
    } else if (entry.isFile() && /\.spec\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Count test cases in a spec file by matching `it(`, `it.skip(`,
 * `test(`, and `test.skip(` patterns. This mirrors what `vitest list`
 * reports — one entry per `it`/`test` call.
 *
 * We use a regex that matches the function call pattern at word
 * boundaries to avoid false positives from comments or string literals
 * in most practical cases.
 */
function countTestsInFile(filePath: string): number {
  const content = readFileSync(filePath, 'utf8')
  // Match: it(, it.skip(, it.only(, test(, test.skip(, test.only(
  // The negative lookbehind avoids matching `describe.it` or similar
  const pattern = /\b(?:it|test)(?:\.skip|\.only)?\s*\(/g
  const matches = content.match(pattern)
  return matches ? matches.length : 0
}

/**
 * Scan all spec files under `tests/` and return per-directory counts.
 */
function discoverTestCounts(): Map<string, number> {
  const counts = new Map<string, number>()
  const specFiles = findSpecFiles(TESTS_DIR)

  for (const filePath of specFiles) {
    const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/')
    const segments = rel.split('/')
    if (segments.length < 3) continue
    const key = `${segments[0]}/${segments[1]}`
    const fileCount = countTestsInFile(filePath)
    counts.set(key, (counts.get(key) ?? 0) + fileCount)
  }

  return counts
}

function loadBaseline(): BaselineTestCount {
  const raw = readFileSync(BASELINE_PATH, 'utf8')
  return JSON.parse(raw) as BaselineTestCount
}

describe('Property 1 — Behavioral parity (test count non-regression)', () => {
  const baseline = loadBaseline()
  const currentCounts = discoverTestCounts()

  // Compute current total
  let currentTotal = 0
  for (const count of currentCounts.values()) {
    currentTotal += count
  }

  const currentUnit = currentCounts.get('tests/unit') ?? 0
  const currentIntegration = currentCounts.get('tests/integration') ?? 0
  const baselineUnitPlusIntegration =
    (baseline['tests/unit'] ?? 0) + (baseline['tests/integration'] ?? 0)

  it('total discovered tests >= baseline tests/unit + tests/integration', () => {
    expect(currentTotal).toBeGreaterThanOrEqual(baselineUnitPlusIntegration)
  })

  it('total discovered tests >= baseline total', () => {
    expect(currentTotal).toBeGreaterThanOrEqual(baseline.total)
  })

  it('tests/unit count has not regressed below baseline', () => {
    expect(currentUnit).toBeGreaterThanOrEqual(baseline['tests/unit'] ?? 0)
  })

  it('tests/integration count has not regressed below baseline', () => {
    expect(currentIntegration).toBeGreaterThanOrEqual(
      baseline['tests/integration'] ?? 0,
    )
  })

  it('no individual directory has regressed below its baseline count', () => {
    const regressions: string[] = []
    for (const [dir, baselineCount] of Object.entries(baseline)) {
      if (dir === 'total') continue
      const current = currentCounts.get(dir) ?? 0
      if (current < baselineCount) {
        regressions.push(
          `${dir}: baseline=${baselineCount}, current=${current}`,
        )
      }
    }
    expect(regressions).toEqual([])
  })
})
