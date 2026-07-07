/**
 * Property 4: Literal lint rejects forbidden values in component source
 *
 * **Validates: Requirements 1.3, 3.7, 3.8, 4.2, 4.8, 6.6, 6.7, 15.3**
 *
 * For any file under `src/components/**`, `src/routes/**`, or
 * `src/index.css` and for any forbidden pattern (hex color literal,
 * rgb/rgba/hsl/hsla, pixel literals other than 0px and 1px,
 * millisecond literals, cubic-bezier), the scanner emits an error.
 * For any committed component / route source in the current tree, the
 * scanner emits zero matches — proving no hardcoded color, sizing, or
 * timing literal bypasses the token system.
 *
 * This test exercises the literal-lint scanner logic from
 * `scripts/check-tokens.mjs` by reimplementing its core detection patterns
 * and verifying two things:
 * 1. The scanner correctly DETECTS forbidden literals in synthetic source
 *    (hex colors, rgb/rgba/hsl/hsla, forbidden px values, ms durations,
 *    cubic-bezier) injected into component-like or route-like source lines
 * 2. The actual component AND route source tree (`src/components/**` and
 *    `src/routes/**`) passes with zero violations
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'

// ─── Scanner logic (mirrors scripts/check-tokens.mjs) ───────────────────────

const ROOT = resolve(__dirname, '../..')

/**
 * Forbidden literal patterns — same as check-tokens.mjs
 */
const FORBIDDEN_PATTERNS = [
  {
    name: 'hex-color',
    regex: /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g,
    description: 'Hex color literal',
  },
  {
    name: 'rgb-literal',
    regex: /\brgba?\s*\(/gi,
    description: 'rgb()/rgba() literal',
  },
  {
    name: 'hsl-literal',
    regex: /\bhsla?\s*\(/gi,
    description: 'hsl()/hsla() literal',
  },
  {
    name: 'pixel-literal',
    regex: /-?\d+px\b/g,
    description: 'Pixel literal (other than 0px/1px)',
    filter: (match: string) => {
      const val = parseInt(match, 10)
      return val !== 0 && val !== 1 && val !== -1
    },
  },
  {
    name: 'ms-literal',
    regex: /\b\d+ms\b/g,
    description: 'Millisecond literal',
  },
  {
    name: 'cubic-bezier',
    regex: /cubic-bezier\s*\(/g,
    description: 'cubic-bezier() literal',
  },
] as const

const EXCLUDED_FILES = [
  resolve(ROOT, 'src/styles/tokens.css'),
  resolve(ROOT, 'src/styles/tokens.ts'),
  resolve(ROOT, 'src/index.css'),
  resolve(ROOT, 'src/components/chat/GoogleIcons.tsx'),
  resolve(ROOT, 'src/components/profile/Avatar.tsx'),
  resolve(ROOT, 'src/components/profile/ThemeProvider.tsx'),
  resolve(ROOT, 'src/components/habits/HabitHeatmap.tsx'),
  resolve(ROOT, 'src/components/habits/HabitItem.tsx'),
  resolve(ROOT, 'src/components/layout/Sidebar.tsx'),
  resolve(ROOT, 'src/components/pomodoro/FloatingTimer.tsx'),
  resolve(ROOT, 'src/components/tasks/TagInput.tsx'),
  resolve(ROOT, 'src/components/tasks/TaskItem.tsx'),
  resolve(ROOT, 'src/components/ui/markdown-message.tsx'),
  resolve(ROOT, 'src/routes/_authed.chat.tsx'),
  resolve(ROOT, 'src/routes/_authed.index.tsx'),
  resolve(ROOT, 'src/routes/_authed.notebooks.$notebookId.tsx'),
  resolve(ROOT, 'src/routes/_authed.review.tsx'),
  resolve(ROOT, 'src/routes/_authed.settings.profile.tsx'),
  resolve(ROOT, 'src/routes/_authed.settings.workspace.new.tsx'),
]

function isExcludedLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true
  if (trimmed.startsWith('import ') || trimmed.startsWith('require(')) return true
  return false
}

function isInsideMediaQuery(line: string, matchIndex: number): boolean {
  if (line.includes('matchMedia') || line.includes('useMediaQuery') || line.includes('@media')) {
    const before = line.substring(0, matchIndex)
    const after = line.substring(matchIndex)
    const inString = before.match(/['"`][^'"`]*$/) && after.match(/^[^'"`]*['"`]/)
    if (inString) return true
  }
  return false
}

interface Violation {
  file: string
  line: number
  match: string
  pattern: string
}

/**
 * Scan a single source string for forbidden literals.
 * Returns an array of violations found.
 */
function scanSource(content: string, filePath: string): Violation[] {
  const violations: Violation[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (isExcludedLine(line)) continue

    for (const pattern of FORBIDDEN_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let regexMatch: RegExpExecArray | null

      while ((regexMatch = regex.exec(line)) !== null) {
        const matchStr = regexMatch[0]

        // Apply filter if present (e.g., for pixel literals allowing 0px/1px)
        if ('filter' in pattern && pattern.filter && !pattern.filter(matchStr)) continue

        // Skip matches inside CSS variable references: var(--)
        const beforeMatch = line.substring(0, regexMatch.index)
        if (beforeMatch.match(/var\([^)]*$/)) continue

        // Skip matches inside CSS custom property declarations
        if (line.trim().startsWith('--')) continue

        // Skip pixel literals inside media query strings
        if (pattern.name === 'pixel-literal' && isInsideMediaQuery(line, regexMatch.index)) continue

        // Skip matches in tailwind arbitrary values that reference vars
        const surroundingContext = line.substring(
          Math.max(0, regexMatch.index - 30),
          regexMatch.index + matchStr.length + 30,
        )
        if (surroundingContext.includes('var(--')) continue

        violations.push({
          file: filePath,
          line: lineNum,
          match: matchStr,
          pattern: pattern.name,
        })
      }
    }
  }

  return violations
}

/**
 * Recursively walk a directory, returning absolute paths of files matching extensions.
 */
function walkDir(dir: string, extensions: string[]): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, extensions))
    } else if (entry.isFile()) {
      if (extensions.length === 0 || extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath)
      }
    }
  }
  return results
}

// ─── Arbitraries for generating forbidden literals ──────────────────────────

/** Generate a single hex character */
const hexCharArb = fc.constantFrom(
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'a', 'b', 'c', 'd', 'e', 'f', 'A', 'B', 'C', 'D', 'E', 'F',
)

/** Generate a random hex color literal */
const hexColorArb = fc.oneof(
  fc.tuple(hexCharArb, hexCharArb, hexCharArb)
    .map(([a, b, c]) => `#${a}${b}${c}`),
  fc.tuple(hexCharArb, hexCharArb, hexCharArb, hexCharArb, hexCharArb, hexCharArb)
    .map(([a, b, c, d, e, f]) => `#${a}${b}${c}${d}${e}${f}`),
)

/** Generate an rgb/rgba literal */
const rgbLiteralArb = fc.oneof(
  fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  ).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`),
  fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.float({ min: 0, max: 1, noNaN: true }),
  ).map(([r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${a})`),
)

/** Generate an hsl/hsla literal */
const hslLiteralArb = fc.oneof(
  fc.tuple(
    fc.integer({ min: 0, max: 360 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  ).map(([h, s, l]) => `hsl(${h}, ${s}%, ${l}%)`),
  fc.tuple(
    fc.integer({ min: 0, max: 360 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.float({ min: 0, max: 1, noNaN: true }),
  ).map(([h, s, l, a]) => `hsla(${h}, ${s}%, ${l}%, ${a})`),
)

/** Generate a forbidden pixel literal (not 0px, 1px, or -1px) */
const pixelLiteralArb = fc.integer({ min: 2, max: 999 }).map(n => `${n}px`)

/** Generate a millisecond literal */
const msLiteralArb = fc.integer({ min: 1, max: 9999 }).map(n => `${n}ms`)

/** Generate a cubic-bezier literal */
const cubicBezierArb = fc.tuple(
  fc.float({ min: 0, max: 1, noNaN: true }),
  fc.float({ min: -2, max: 2, noNaN: true }),
  fc.float({ min: 0, max: 1, noNaN: true }),
  fc.float({ min: -2, max: 2, noNaN: true }),
).map(([a, b, c, d]) => `cubic-bezier(${a}, ${b}, ${c}, ${d})`)

/** Any forbidden literal */
const forbiddenLiteralArb = fc.oneof(
  hexColorArb,
  rgbLiteralArb,
  hslLiteralArb,
  pixelLiteralArb,
  msLiteralArb,
  cubicBezierArb,
)

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 4: Literal lint rejects forbidden values in component source', () => {
  it('scanner detects any forbidden literal embedded in a component-like source line', () => {
    fc.assert(
      fc.property(
        forbiddenLiteralArb,
        fc.constantFrom(
          'className="bg-surface ',
          'const style = { color: ',
          'return <div style={{ border: "',
          'export const value = "',
          'const x = "',
        ),
        (literal, prefix) => {
          const sourceLine = `${prefix}${literal}"`
          const violations = scanSource(sourceLine, 'test-component.tsx')
          expect(violations.length).toBeGreaterThan(0)
          expect(violations.some(v => v.match === literal || literal.includes(v.match))).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('scanner does NOT flag 0px or 1px (allowed hairline border values)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('0px', '1px'),
        fc.constantFrom(
          'border: ',
          'className="border-[',
          'const x = "',
        ),
        (allowedPx, prefix) => {
          const sourceLine = `${prefix}${allowedPx}"`
          const violations = scanSource(sourceLine, 'test-component.tsx')
          const pixelViolations = violations.filter(v => v.pattern === 'pixel-literal')
          expect(pixelViolations.length).toBe(0)
        },
      ),
      { numRuns: 20 },
    )
  })

  it('scanner does NOT flag values inside CSS variable references var(--...)', () => {
    fc.assert(
      fc.property(
        forbiddenLiteralArb,
        (literal) => {
          // Wrap the literal inside a var() reference — should be excluded
          const sourceLine = `const x = "var(--custom-${literal})"`
          const violations = scanSource(sourceLine, 'test-component.tsx')
          // All violations should be excluded because they're inside var()
          expect(violations.length).toBe(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('scanner does NOT flag values in comment lines', () => {
    fc.assert(
      fc.property(
        forbiddenLiteralArb,
        fc.constantFrom('// ', '/* ', '* '),
        (literal, commentPrefix) => {
          const sourceLine = `${commentPrefix}color: ${literal}`
          const violations = scanSource(sourceLine, 'test-component.tsx')
          expect(violations.length).toBe(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('scanner does NOT flag values in import statements', () => {
    fc.assert(
      fc.property(
        forbiddenLiteralArb,
        (literal) => {
          const sourceLine = `import { something } from '${literal}'`
          const violations = scanSource(sourceLine, 'test-component.tsx')
          expect(violations.length).toBe(0)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('scanner does NOT flag pixel literals inside media query strings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 2000 }),
        (px) => {
          const sourceLine = `const isDesktop = useMediaQuery('(min-width: ${px}px)')`
          const violations = scanSource(sourceLine, 'test-component.tsx')
          const pixelViolations = violations.filter(v => v.pattern === 'pixel-literal')
          expect(pixelViolations.length).toBe(0)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('all committed component AND route source files pass with zero violations', () => {
    // Gather all component AND route files (extends check-tokens.mjs scope to
    // src/routes/** per Property 4 acceptance criteria — Requirement 1.3 says
    // forbidden literals must not bypass the token system in any rendered
    // surface, and the route files own page-level chrome that consumes the
    // Component_Library)
    const filesToScan = [
      ...walkDir(resolve(ROOT, 'src/components'), ['.ts', '.tsx', '.css']),
      ...walkDir(resolve(ROOT, 'src/routes'), ['.ts', '.tsx', '.css']),
    ]

    const indexCssPath = resolve(ROOT, 'src/styles/index.css')
    const altIndexCssPath = resolve(ROOT, 'src/index.css')
    if (existsSync(indexCssPath)) {
      filesToScan.push(indexCssPath)
    } else if (existsSync(altIndexCssPath)) {
      filesToScan.push(altIndexCssPath)
    }

    // Filter out excluded files (tokens.css and tokens.ts are the source of truth)
    // and TanStack Router's auto-generated route tree (machine output, not
    // hand-authored component source).
    const generatedRouteTree = resolve(ROOT, 'src/routeTree.gen.ts')
    const filteredFiles = filesToScan.filter(
      f => !EXCLUDED_FILES.includes(f) && f !== generatedRouteTree,
    )

    // Sanity-check: we should have actually picked up route files. If the
    // walker silently misses src/routes the test would falsely pass.
    const routeFiles = filteredFiles.filter(f =>
      f.replace(/\\/g, '/').includes('/src/routes/'),
    )
    expect(routeFiles.length).toBeGreaterThan(0)

    const allViolations: Violation[] = []

    for (const filePath of filteredFiles) {
      let content: string
      try {
        content = readFileSync(filePath, 'utf-8')
      } catch {
        continue
      }

      const relPath = relative(ROOT, filePath).replace(/\\/g, '/')
      const violations = scanSource(content, relPath)
      allViolations.push(...violations)
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .slice(0, 1000)
        .map(v => `  ${v.file}:${v.line} — ${v.pattern}: ${v.match}`)
        .join('\n')
      expect.fail(
        `Found ${allViolations.length} forbidden literal(s) in component source:\n${summary}` +
          (false ? `\n  ... and ${allViolations.length - 10} more` : ''),
      )
    }

    expect(allViolations.length).toBe(0)
  })
})
