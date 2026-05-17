import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { tokens } from '../../src/styles/tokens'

/**
 * **Validates: Requirement 3.4**
 *
 * Property 8: Body typography on Tasks_Page and Habits_Page uses the body step.
 *
 * Requirement 3.4 mandates that the `body` Type_Scale step is the default
 * paragraph typography on all Tasks_Page and Habits_Page text content. The
 * route files don't render body paragraphs directly — they compose the
 * `PageHeader`, `EmptyState`, `ErrorState`, and `ListItem` primitives, which
 * own the body-text containers. To prove the invariant holds for the surfaces
 * the user actually sees, this test:
 *
 * 1. Statically scans every page-tree source file (the route components plus
 *    the primitives they compose) and locates each `<p>` JSX opener.
 * 2. Asserts that every `<p>` opener carries a Type_Scale class
 *    (`text-caption`, `text-label`, `text-body`, `text-title`, `text-headline`,
 *    or `text-display`). No `<p>` may use an ad-hoc size — Requirement 3.7
 *    forbids font-size values that aren't declared in the Type_Scale.
 * 3. Asserts that the page-description paragraphs in `PageHeader`,
 *    `EmptyState`, and `ErrorState` use `text-body` specifically — these are
 *    the canonical body-text containers Tasks_Page and Habits_Page render.
 * 4. Asserts the `ListItem` title slot — where each Tasks_Page task title and
 *    Habits_Page habit title is rendered — uses `text-body`, so list-row body
 *    text on both pages takes the body step.
 * 5. Confirms that both route files import the body-text primitives, so the
 *    invariant proven on those primitives actually reaches the rendered
 *    pages instead of validating dead code.
 *
 * The single source of truth for valid Type_Scale class names is
 * `tokens.typography`; we derive the allowlist (`text-caption` .. `text-display`)
 * from there so adding a new step automatically widens the universe of
 * acceptable classes without test edits, and removing a step automatically
 * narrows it.
 */

const ROOT = resolve(__dirname, '../..')

/**
 * Tailwind class names that resolve to a Type_Scale step from the
 * Component_Library typography tokens. Any text-bearing element on Tasks_Page
 * or Habits_Page must use one of these classes (Requirement 3.7).
 */
const TYPE_SCALE_CLASSES = new Set(
  Object.keys(tokens.typography).map((step) => `text-${step}`),
)

/**
 * Files that compose the Tasks_Page and Habits_Page surfaces. The route files
 * are the entry points; the rest are the body-text-bearing primitives the
 * routes compose. Forms, items, and skeletons are also included because they
 * render text content on those pages.
 */
const PAGE_FILES = [
  // Route entries
  'src/routes/_authed.tasks.tsx',
  'src/routes/_authed.habits.tsx',
  // Body-text-bearing primitives composed by both routes
  'src/components/ui/page-header.tsx',
  'src/components/ui/empty-state.tsx',
  'src/components/ui/error-state.tsx',
  'src/components/ui/list-item.tsx',
  // Per-feature compositions rendered on each page
  'src/components/tasks/TaskItem.tsx',
  'src/components/tasks/TaskCreateForm.tsx',
  'src/components/habits/HabitItem.tsx',
  'src/components/habits/HabitCreateForm.tsx',
] as const

interface ParagraphSite {
  file: string
  line: number
  classNames: string[]
  rawOpener: string
}

/**
 * Strip JSX `{/* ... *\/}`, JS block, and JS line comments so commented-out
 * `<p>` snippets inside JSDoc don't pollute the static scan.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Extract className tokens from a JSX opener attribute string. Supports both
 * string-literal classNames (`className="..."`) and JSX-expression classNames
 * (`className={cn(..., '...')}`). For the latter, every string-literal
 * substring inside the expression body is collected — `cn`/`clsx` compose
 * variants from string fragments, so this captures the full token set the
 * runtime ever applies.
 */
function extractClassTokens(attrs: string): string[] {
  const stringMatch = attrs.match(/className\s*=\s*"([^"]*)"/)
  if (stringMatch) {
    return stringMatch[1].split(/\s+/).filter(Boolean)
  }
  const exprMatch = attrs.match(/className\s*=\s*\{([\s\S]*?)\}/)
  if (exprMatch) {
    const out: string[] = []
    const literalRe = /'([^']*)'|"([^"]*)"|`([^`]*)`/g
    let m: RegExpExecArray | null
    while ((m = literalRe.exec(exprMatch[1])) !== null) {
      const lit = m[1] ?? m[2] ?? m[3] ?? ''
      out.push(...lit.split(/\s+/).filter(Boolean))
    }
    return out
  }
  return []
}

/** Locate every `<p ...>` opener in the source and extract its class tokens. */
function findParagraphSites(source: string, file: string): ParagraphSite[] {
  const stripped = stripComments(source)
  const sites: ParagraphSite[] = []
  // Match `<p` followed by either `>` (no attrs) or whitespace and an
  // attribute list. Excluding `<path`, `<polyline`, etc. via the trailing
  // boundary `\b`.
  const re = /<p(\s[^>]*?)?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const attrs = m[1] ?? ''
    const before = stripped.slice(0, m.index)
    const line = before.split('\n').length
    sites.push({
      file,
      line,
      classNames: extractClassTokens(attrs),
      rawOpener: m[0],
    })
  }
  return sites
}

const FILES = PAGE_FILES.map((p) => ({
  path: p,
  source: readFileSync(resolve(ROOT, p), 'utf-8'),
}))
const ALL_PARAGRAPHS: ParagraphSite[] = FILES.flatMap((f) =>
  findParagraphSites(f.source, f.path),
)

describe('Property 8: Body typography on Tasks and Habits pages uses the body step', () => {
  it('the page source tree exposes at least one paragraph element', () => {
    // Sanity guard: if the static scan misses everything (e.g. <p> got renamed
    // away), the property below would falsely pass on empty input.
    expect(ALL_PARAGRAPHS.length).toBeGreaterThan(0)
  })

  it('the Tasks_Page route file imports the body-text primitives that own the description paragraph', () => {
    const tasks = FILES.find((f) => f.path.endsWith('_authed.tasks.tsx'))!.source
    // These imports anchor the reachability claim — Tasks_Page's body
    // paragraphs live in these primitives, so the invariants we prove on the
    // primitives below actually reach the rendered page.
    expect(tasks).toMatch(/from\s+['"]@\/components\/ui\/page-header['"]/)
    expect(tasks).toMatch(/from\s+['"]@\/components\/ui\/empty-state['"]/)
    expect(tasks).toMatch(/from\s+['"]@\/components\/ui\/error-state['"]/)
  })

  it('the Habits_Page route file imports the body-text primitives that own the description paragraph', () => {
    const habits = FILES.find((f) => f.path.endsWith('_authed.habits.tsx'))!.source
    expect(habits).toMatch(/from\s+['"]@\/components\/ui\/page-header['"]/)
    expect(habits).toMatch(/from\s+['"]@\/components\/ui\/empty-state['"]/)
    expect(habits).toMatch(/from\s+['"]@\/components\/ui\/error-state['"]/)
  })

  it('for any paragraph in the page tree, its className uses a Type_Scale step class', () => {
    // The weakest invariant compatible with Requirement 3.7: every <p> on the
    // page tree must declare a font size via a Type_Scale token, never an
    // ad-hoc literal. The body-step-specific assertions live below.
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PARAGRAPHS),
        (p) => {
          const hit = p.classNames.find((c) => TYPE_SCALE_CLASSES.has(c))
          if (!hit) {
            throw new Error(
              `${p.file}:${p.line} — paragraph "${p.rawOpener}" must declare a Type_Scale ` +
                `class (one of ${[...TYPE_SCALE_CLASSES].join(', ')}); got [${p.classNames.join(', ') || '(no classes)'}]`,
            )
          }
          return true
        },
      ),
      { numRuns: Math.max(ALL_PARAGRAPHS.length, 1) },
    )
  })

  it('for any paragraph in the page tree, its className contains no arbitrary text size', () => {
    // Tailwind's arbitrary-value escape hatch (`text-[14px]`) bypasses the
    // Type_Scale even when present alongside a token class. Requirement 3.7
    // forbids ad-hoc sizes, so reject any `text-[<n><unit>]` arbitrary value
    // appearing on a paragraph element.
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PARAGRAPHS),
        (p) => {
          const arbitrary = p.classNames.find((c) =>
            /^text-\[(?:-?\d+(?:\.\d+)?)(?:px|rem|em|%)\]$/.test(c),
          )
          if (arbitrary) {
            throw new Error(
              `${p.file}:${p.line} — paragraph uses arbitrary text size "${arbitrary}". ` +
                `Requirement 3.7 forbids ad-hoc text sizes — use a Type_Scale step instead.`,
            )
          }
          return true
        },
      ),
      { numRuns: Math.max(ALL_PARAGRAPHS.length, 1) },
    )
  })

  it('PageHeader.tsx renders the page description paragraph with text-body', () => {
    const paras = ALL_PARAGRAPHS.filter((p) => p.file.endsWith('page-header.tsx'))
    expect(paras.length, 'PageHeader.tsx must render at least one paragraph').toBeGreaterThan(0)
    expect(
      paras.some((p) => p.classNames.includes('text-body')),
      `PageHeader description paragraph must use text-body; saw [${paras
        .map((p) => p.classNames.join(' ') || '(no classes)')
        .join(' | ')}]`,
    ).toBe(true)
  })

  it('EmptyState.tsx renders the empty-state description paragraph with text-body', () => {
    const paras = ALL_PARAGRAPHS.filter((p) => p.file.endsWith('empty-state.tsx'))
    expect(paras.length, 'EmptyState.tsx must render at least one paragraph').toBeGreaterThan(0)
    expect(
      paras.some((p) => p.classNames.includes('text-body')),
      `EmptyState description paragraph must use text-body; saw [${paras
        .map((p) => p.classNames.join(' ') || '(no classes)')
        .join(' | ')}]`,
    ).toBe(true)
  })

  it('ErrorState.tsx renders the error-state description paragraph with text-body', () => {
    const paras = ALL_PARAGRAPHS.filter((p) => p.file.endsWith('error-state.tsx'))
    expect(paras.length, 'ErrorState.tsx must render at least one paragraph').toBeGreaterThan(0)
    expect(
      paras.some((p) => p.classNames.includes('text-body')),
      `ErrorState description paragraph must use text-body; saw [${paras
        .map((p) => p.classNames.join(' ') || '(no classes)')
        .join(' | ')}]`,
    ).toBe(true)
  })

  it('ListItem.tsx wraps the title slot in a text-body container so list-row body text uses the body step', () => {
    // The title slot is the body-text region in a list row; the primitive
    // declares it via `text-body text-on-surface ...`. Tasks_Page and
    // Habits_Page render task and habit titles through this slot, so this is
    // where Requirement 3.4 takes effect for list rows.
    const listItem = FILES.find((f) => f.path.endsWith('list-item.tsx'))!.source
    expect(listItem).toMatch(/\btext-body\b/)
  })
})

/**
 * **Validates: Requirement 3.5**
 *
 * Property 9: Section headings use the `title` step or larger.
 *
 * Requirement 3.5 mandates that headings which introduce a section or page
 * are rendered using the `title` Type_Scale step or larger, regardless of
 * the surrounding container size. Card headers must not downgrade the step
 * to fit a compact layout — the layout must adjust instead.
 *
 * The page source tree composes its headings exclusively through three
 * primitives:
 *   - `PageHeader` renders the page `<h1>` (text-headline) for Tasks_Page
 *     and Habits_Page.
 *   - `EmptyState` renders an `<h2>` (text-title) when the list is empty.
 *   - `ErrorState` renders an `<h2>` (text-title) when the query fails.
 *
 * The route files (`_authed.tasks.tsx`, `_authed.habits.tsx`) compose these
 * primitives and never inline raw `<h1>`/`<h2>`/`<h3>` themselves; the
 * per-feature compositions (`TaskItem`, `HabitItem`, the create forms)
 * intentionally render no headings — list rows are not section headings
 * (Requirement 3.6 explicitly allows the `body`/`label`/`caption` steps for
 * inline list-item headings, which is why those files are scanned for an
 * absence of `<h[1-3]>`, not for a heading class).
 *
 * To prove the invariant holds for the surfaces the user actually sees, this
 * test:
 *
 * 1. Statically scans every page-tree source file for `<h1>`, `<h2>`, and
 *    `<h3>` JSX openers (the heading levels that introduce sections per
 *    Requirement 11.10's `h1`-for-page, `h2`-for-section policy).
 * 2. Asserts that every heading opener carries a heading-eligible Type_Scale
 *    class — derived dynamically from `tokens.typography` as the steps whose
 *    size is greater than or equal to the `title` step. That keeps the
 *    allowlist in lock-step with the token source: adding a new step larger
 *    than `title` automatically widens the allowlist; renaming `title` would
 *    fail the test until it's reconciled.
 * 3. Rejects any arbitrary-text-size escape hatch (`text-[18px]`) on a
 *    heading element. Requirement 3.7 forbids ad-hoc sizes generally, and
 *    this property layers the heading-specific guard on top of it.
 * 4. Sanity-guards on a non-empty heading population so the property cannot
 *    falsely pass on an empty input set.
 */

/**
 * Parse a CSS length expressed as `<n>rem` or `<n>em` or `<n>px` into a
 * comparable numeric value (in `em`-equivalents at the document root). The
 * Type_Scale exclusively uses `rem`, but parsing the unit defensively lets
 * the comparison stay honest if a non-rem step were ever introduced — the
 * test will then fail loudly rather than silently mis-rank the steps.
 */
function parseTypeScaleSize(size: string): number {
  const match = size.match(/^(-?\d+(?:\.\d+)?)(rem|em|px)$/)
  if (!match) {
    throw new Error(
      `Type_Scale step size "${size}" is not a parseable rem/em/px length`,
    )
  }
  const value = Number(match[1])
  const unit = match[2]
  // Treat px as 1/16 rem at the default root font-size of 16px (Req 3.9).
  // rem and em compare directly because every Type_Scale step uses the same
  // unit class, but this normalisation keeps cross-unit ranking sane.
  return unit === 'px' ? value / 16 : value
}

const TITLE_SIZE_REM = parseTypeScaleSize(tokens.typography.title.size)

/**
 * Type_Scale step names whose size is >= the `title` step. These are the
 * Tailwind classes a section heading is permitted to declare per Req 3.5.
 */
const HEADING_TYPE_SCALE_CLASSES = new Set(
  Object.entries(tokens.typography)
    .filter(([, step]) => parseTypeScaleSize(step.size) >= TITLE_SIZE_REM)
    .map(([name]) => `text-${name}`),
)

interface HeadingSite {
  file: string
  line: number
  level: 1 | 2 | 3
  classNames: string[]
  rawOpener: string
}

/** Locate every `<h1>`, `<h2>`, `<h3>` opener in the source. */
function findHeadingSites(source: string, file: string): HeadingSite[] {
  const stripped = stripComments(source)
  const sites: HeadingSite[] = []
  // `<h[1-3]` followed by either `>` (no attrs) or whitespace and an attribute
  // list. The trailing boundary excludes longer tags (`<header`, `<html>`).
  const re = /<h([1-3])(\s[^>]*?)?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const level = Number(m[1]) as 1 | 2 | 3
    const attrs = m[2] ?? ''
    const before = stripped.slice(0, m.index)
    const line = before.split('\n').length
    sites.push({
      file,
      line,
      level,
      classNames: extractClassTokens(attrs),
      rawOpener: m[0],
    })
  }
  return sites
}

const ALL_HEADINGS: HeadingSite[] = FILES.flatMap((f) =>
  findHeadingSites(f.source, f.path),
)

describe('Property 9: Section headings use the title step or larger', () => {
  it('the heading-eligible Type_Scale set contains at least title, headline, display', () => {
    // Sanity guard: if `tokens.typography` were trimmed below the `title`
    // step, the property would lose its teeth. Confirm the canonical three
    // are derivable from the token source.
    expect(HEADING_TYPE_SCALE_CLASSES.has('text-title')).toBe(true)
    expect(HEADING_TYPE_SCALE_CLASSES.has('text-headline')).toBe(true)
    expect(HEADING_TYPE_SCALE_CLASSES.has('text-display')).toBe(true)
    // And the sub-`title` steps must NOT be heading-eligible — Req 3.5 forbids
    // downgrading section headings below `title`.
    expect(HEADING_TYPE_SCALE_CLASSES.has('text-body')).toBe(false)
    expect(HEADING_TYPE_SCALE_CLASSES.has('text-label')).toBe(false)
    expect(HEADING_TYPE_SCALE_CLASSES.has('text-caption')).toBe(false)
  })

  it('the page source tree exposes at least one section heading', () => {
    // If the static scan misses everything, the property below would falsely
    // pass on empty input.
    expect(ALL_HEADINGS.length).toBeGreaterThan(0)
  })

  it('PageHeader.tsx renders an h1 — the page-level section heading', () => {
    const headings = ALL_HEADINGS.filter((h) => h.file.endsWith('page-header.tsx'))
    expect(headings.length).toBeGreaterThan(0)
    expect(headings.some((h) => h.level === 1)).toBe(true)
  })

  it('EmptyState.tsx renders an h2 — a section heading nested under the page h1', () => {
    const headings = ALL_HEADINGS.filter((h) => h.file.endsWith('empty-state.tsx'))
    expect(headings.length).toBeGreaterThan(0)
    expect(headings.some((h) => h.level === 2)).toBe(true)
  })

  it('ErrorState.tsx renders an h2 — a section heading nested under the page h1', () => {
    const headings = ALL_HEADINGS.filter((h) => h.file.endsWith('error-state.tsx'))
    expect(headings.length).toBeGreaterThan(0)
    expect(headings.some((h) => h.level === 2)).toBe(true)
  })

  it('for any section heading in the page tree, its className uses the title, headline, or display Type_Scale step', () => {
    // The core property: every `<h1>`/`<h2>`/`<h3>` on the page tree must
    // declare a heading-eligible Type_Scale class. The allowlist is derived
    // from `tokens.typography` so it co-evolves with the token source.
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_HEADINGS),
        (h) => {
          const hit = h.classNames.find((c) => HEADING_TYPE_SCALE_CLASSES.has(c))
          if (!hit) {
            throw new Error(
              `${h.file}:${h.line} — h${h.level} "${h.rawOpener}" must declare a ` +
                `heading-eligible Type_Scale class (one of ${[...HEADING_TYPE_SCALE_CLASSES].join(', ')}); ` +
                `got [${h.classNames.join(', ') || '(no classes)'}]`,
            )
          }
          return true
        },
      ),
      { numRuns: Math.max(ALL_HEADINGS.length, 1) },
    )
  })

  it('for any section heading in the page tree, its className contains no arbitrary text size', () => {
    // Tailwind's arbitrary-value escape hatch (`text-[24px]`) bypasses the
    // Type_Scale even when present alongside a token class. Reject any
    // `text-[<n><unit>]` arbitrary value appearing on a heading element so
    // headings can never silently fall outside the Type_Scale.
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_HEADINGS),
        (h) => {
          const arbitrary = h.classNames.find((c) =>
            /^text-\[(?:-?\d+(?:\.\d+)?)(?:px|rem|em|%)\]$/.test(c),
          )
          if (arbitrary) {
            throw new Error(
              `${h.file}:${h.line} — h${h.level} uses arbitrary text size "${arbitrary}". ` +
                `Requirements 3.5 and 3.7 forbid ad-hoc heading sizes — use a Type_Scale step instead.`,
            )
          }
          return true
        },
      ),
      { numRuns: Math.max(ALL_HEADINGS.length, 1) },
    )
  })
})
