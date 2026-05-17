import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * **Validates: Requirements 13.4, 13.5**
 *
 * Property 7: Non-regression test parity
 *
 * Performance optimisations must NOT reduce the number of tests in any
 * directory. Tests may be added but never removed or permanently skipped
 * as a result of restructuring for optimisation purposes.
 *
 * This test reads the current test file counts per directory and compares
 * them against the baseline recorded in `baseline-test-count.json` at the
 * project root. Each directory must have a count >= its baseline value.
 *
 * Rule from Requirement 13.5: assertion bodies in pre-existing tests are
 * immutable; this test enforces count parity, the existing suites enforce
 * semantics.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const BASELINE_PATH = path.join(PROJECT_ROOT, 'baseline-test-count.json')

interface BaselineTestCount {
  [directory: string]: number
}

/**
 * Count test files (*.spec.ts, *.spec.tsx) recursively in a directory.
 */
function countTestFiles(dir: string): number {
  const absoluteDir = path.resolve(PROJECT_ROOT, dir)
  if (!fs.existsSync(absoluteDir)) return 0

  let count = 0
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      count += countTestFiles(path.relative(PROJECT_ROOT, fullPath))
    } else if (entry.isFile() && /\.spec\.(ts|tsx)$/.test(entry.name)) {
      count++
    }
  }

  return count
}

/**
 * Count individual test cases (it/test calls) in all spec files within a
 * directory. This provides a more granular count than just file count.
 */
function countTestCases(dir: string): number {
  const absoluteDir = path.resolve(PROJECT_ROOT, dir)
  if (!fs.existsSync(absoluteDir)) return 0

  let count = 0
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      count += countTestCases(path.relative(PROJECT_ROOT, fullPath))
    } else if (entry.isFile() && /\.spec\.(ts|tsx)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      // Count it(...) and test(...) calls — top-level test case declarations.
      // Matches: it('...', it## ("...", test('...', test("...", it.skip(, etc.
      const matches = content.match(/\b(?:it|test)\s*(?:\.\w+\s*)?\(/g)
      count += matches ? matches.length : 0
    }
  }

  return count
}

describe('Property 7 — Non-regression test parity', () => {
  it('baseline-test-count.json exists and is valid JSON', () => {
    expect(fs.existsSync(BASELINE_PATH)).toBe(true)
    const raw = fs.readFileSync(BASELINE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as BaselineTestCount
    expect(typeof parsed).toBe('object')
    expect(parsed).not.toBeNull()
  })

  it('no test directory has regressed below its baseline count', () => {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf-8')
    const baseline = JSON.parse(raw) as BaselineTestCount

    const regressions: string[] = []

    for (const [dir, baselineCount] of Object.entries(baseline)) {
      // Skip the "total" key — we check it separately
      if (dir === 'total') continue

      const currentCount = countTestCases(dir)

      if (currentCount < baselineCount) {
        regressions.push(
          `${dir}: current=${currentCount}, baseline=${baselineCount} (regressed by ${baselineCount - currentCount})`,
        )
      }
    }

    expect(
      regressions,
      `Test count regression detected:\n${regressions.join('\n')}`,
    ).toHaveLength(0)
  })

  it('total test count across all directories has not regressed', () => {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf-8')
    const baseline = JSON.parse(raw) as BaselineTestCount

    const baselineTotal = baseline['total'] ?? 0

    // Sum current counts across all baseline directories (excluding "total")
    let currentTotal = 0
    for (const dir of Object.keys(baseline)) {
      if (dir === 'total') continue
      currentTotal += countTestCases(dir)
    }

    expect(currentTotal).toBeGreaterThanOrEqual(baselineTotal)
  })

  it('each baseline directory still exists in the project', () => {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf-8')
    const baseline = JSON.parse(raw) as BaselineTestCount

    const missing: string[] = []

    for (const dir of Object.keys(baseline)) {
      if (dir === 'total') continue
      const absoluteDir = path.resolve(PROJECT_ROOT, dir)
      if (!fs.existsSync(absoluteDir)) {
        missing.push(dir)
      }
    }

    expect(
      missing,
      `Baseline test directories no longer exist:\n${missing.join('\n')}\nTest directories must not be removed during optimisation.`,
    ).toHaveLength(0)
  })
})
