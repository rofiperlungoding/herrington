import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **Validates: Requirements 15.1, 15.2**
 *
 * Property 4: Streak determinism — static-analysis purity assertion.
 *
 * This test reads the source text of `computeNextStreak.ts` and asserts it
 * contains zero occurrences of non-deterministic or impure symbols. This
 * proves the module remains a pure function of its arguments, with no
 * dependency on runtime state, environment, network, filesystem, or database.
 *
 * The check complements the property-based tests in `mvp-baseline.spec.ts`
 * (Property 25) which verify behavioural correctness. Together they ensure
 * that performance optimisations (Drizzle memoize, JWKS cache, token cache)
 * cannot accidentally introduce side effects into the streak computation.
 */

const STREAK_MODULE_PATH = resolve(
  __dirname,
  '../../src/shared/streak/computeNextStreak.ts',
)

/**
 * Strip single-line (`// ...`) and multi-line (`/* ... *​/`) comments from
 * TypeScript source so that documentation mentioning forbidden symbols
 * (e.g., "no `Date.now()`") does not trigger false positives.
 */
function stripComments(source: string): string {
  // Remove multi-line comments (non-greedy)
  let result = source.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove single-line comments
  result = result.replace(/\/\/[^\n]*/g, '')
  return result
}

/**
 * Impure symbols that must NOT appear in the streak module source.
 * Each entry is a substring that would indicate a non-deterministic or
 * side-effectful dependency.
 */
const FORBIDDEN_SYMBOLS = [
  // Non-deterministic time/random sources
  'Date.now',
  'new Date(',
  'Math.random',

  // Environment variable access
  'process.env',

  // Filesystem I/O
  "import 'fs'",
  'import "fs"',
  "from 'fs'",
  'from "fs"',
  "from 'node:fs'",
  'from "node:fs"',
  "require('fs')",
  'require("fs")',

  // Network / DB symbols (Drizzle)
  'drizzle',
  'createDrizzleClient',
  'libsql',
  '@libsql',

  // Network / DB symbols (Supabase)
  'supabase',
  'createClient',
  'SupabaseClient',

  // Generic network
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
] as const

describe('Property 4 — Streak module purity (static analysis)', () => {
  const rawSource = readFileSync(STREAK_MODULE_PATH, 'utf-8')
  const executableSource = stripComments(rawSource)

  it('computeNextStreak.ts source file is readable and non-empty', () => {
    expect(rawSource.length).toBeGreaterThan(0)
    expect(executableSource.trim().length).toBeGreaterThan(0)
  })

  for (const symbol of FORBIDDEN_SYMBOLS) {
    it(`does not contain impure symbol: "${symbol}"`, () => {
      expect(executableSource).not.toContain(symbol)
    })
  }

  it('summary: zero impure symbols found in streak module executable code', () => {
    const violations = FORBIDDEN_SYMBOLS.filter((sym) =>
      executableSource.includes(sym),
    )
    expect(violations).toEqual([])
  })
})
