import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import * as fs from 'node:fs'
import * as path from 'node:path'
import React from 'react'
import { render } from '@testing-library/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ListItem, type ListItemTone } from '@/components/ui/list-item'

/**
 * **Validates: Requirement 5.7**
 *
 * Property 14: Elevation above level 1 never coexists with a visible border
 *
 * The Design_System mandates that elements with elevation above level 1
 * (shadow-e2, shadow-e3, shadow-e4) rely on shadow for depth, not borders.
 * Combining high elevation with a visible border is a visual anti-pattern
 * that muddies the surface hierarchy.
 *
 * This property test scans all component source files and verifies that
 * no className string (within a single cn(...) call, className attribute,
 * or cva variant line) combines a high-elevation shadow class with a
 * border class.
 */

// Elevation classes that represent levels above 1
const HIGH_ELEVATION_CLASSES = ['shadow-e2', 'shadow-e3', 'shadow-e4'] as const

// Border patterns that indicate a visible border on the same element
// We look for `border` as a standalone class (not border-color-only utilities)
const BORDER_PATTERN = /\bborder\b(?!-(color|opacity|spacing))/

/**
 * Recursively collect all .tsx and .ts files from a directory.
 */
function collectComponentFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectComponentFiles(fullPath))
    } else if (entry.isFile() && /\.(tsx?|css)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Extract className segments from a source file. Each segment represents
 * a single element's class list — either from a `className={cn(...)}` call,
 * a `className="..."` attribute, or a cva variant value string.
 *
 * We extract contiguous class strings that would apply to the same element.
 */
function extractClassSegments(source: string): { segment: string; line: number }[] {
  const segments: { segment: string; line: number }[] = []

  // Strategy: find all string literals and template literals that contain
  // Tailwind class-like content (shadow-e* or border). We group by the
  // enclosing cn() call or className attribute.

  // Match cn(...) calls — these group multiple string args into one element's classes
  const cnCallRegex = /\bcn\s*\(([\s\S]*?)\)/g
  let match: RegExpExecArray | null

  while ((match = cnCallRegex.exec(source)) !== null) {
    const cnBody = match[1]
    const lineNumber = source.substring(0, match.index).split('\n').length
    // Collect all string literals within the cn() call
    const strings: string[] = []
    const stringLiteralRegex = /'([^']*)'|"([^"]*)"|`([^`]*)`/g
    let strMatch: RegExpExecArray | null
    while ((strMatch = stringLiteralRegex.exec(cnBody)) !== null) {
      strings.push(strMatch[1] ?? strMatch[2] ?? strMatch[3] ?? '')
    }
    if (strings.length > 0) {
      segments.push({ segment: strings.join(' '), line: lineNumber })
    }
  }

  // Match className="..." attributes (static class strings)
  const classNameStaticRegex = /className\s*=\s*"([^"]*)"/g
  while ((match = classNameStaticRegex.exec(source)) !== null) {
    const lineNumber = source.substring(0, match.index).split('\n').length
    segments.push({ segment: match[1], line: lineNumber })
  }

  return segments
}

/**
 * Check if a class segment violates the elevation/border exclusivity rule.
 * Returns true if a high-elevation class coexists with a visible border class.
 */
function violatesElevationBorderRule(segment: string): boolean {
  const hasHighElevation = HIGH_ELEVATION_CLASSES.some((cls) =>
    segment.includes(cls)
  )
  if (!hasHighElevation) return false

  // Check for border class that indicates a visible border
  // We need to be careful: `border-border` is a color utility (border color = border token)
  // `border` alone or `border-r`, `border-t`, etc. indicate a visible border
  const hasBorder = BORDER_PATTERN.test(segment)
  return hasBorder
}

describe('Property 14: Elevation above level 1 never coexists with a visible border', () => {
  const componentsDir = path.resolve(__dirname, '../../src/components')
  const componentFiles = collectComponentFiles(componentsDir)

  it('component files exist for scanning', () => {
    expect(componentFiles.length).toBeGreaterThan(0)
  })

  it('no component element combines elevation > 1 with a visible border', () => {
    // Build a list of all (file, segment) pairs that contain high elevation
    const highElevationSegments: {
      file: string
      segment: string
      line: number
    }[] = []

    for (const file of componentFiles) {
      const source = fs.readFileSync(file, 'utf-8')
      const segments = extractClassSegments(source)

      for (const { segment, line } of segments) {
        if (HIGH_ELEVATION_CLASSES.some((cls) => segment.includes(cls))) {
          highElevationSegments.push({
            file: path.relative(componentsDir, file),
            segment,
            line,
          })
        }
      }
    }

    // There must be at least some high-elevation elements to validate
    expect(highElevationSegments.length).toBeGreaterThan(0)

    // Property: for any high-elevation segment, it must not also have a border
    fc.assert(
      fc.property(
        fc.constantFrom(...highElevationSegments),
        (entry) => {
          const hasBorder = BORDER_PATTERN.test(entry.segment)
          if (hasBorder) {
            // Provide a clear failure message
            expect.fail(
              `Elevation/border exclusivity violated in ${entry.file}:${entry.line}\n` +
                `  Segment contains both high elevation and border:\n` +
                `  "${entry.segment.substring(0, 200)}..."`,
            )
          }
          expect(hasBorder).toBe(false)
        },
      ),
      { numRuns: highElevationSegments.length },
    )
  })

  it('high-elevation components (dialog, tooltip, toast) do not declare border classes', () => {
    // Specifically verify the known high-elevation components
    const knownHighElevationFiles = [
      'ui/dialog.tsx',
      'ui/tooltip.tsx',
      'ui/toast.tsx',
    ]

    fc.assert(
      fc.property(
        fc.constantFrom(...knownHighElevationFiles),
        (relFile) => {
          const fullPath = path.join(componentsDir, relFile)
          if (!fs.existsSync(fullPath)) return // skip if file doesn't exist

          const source = fs.readFileSync(fullPath, 'utf-8')
          const segments = extractClassSegments(source)

          for (const { segment, line } of segments) {
            const hasHighElevation = HIGH_ELEVATION_CLASSES.some((cls) =>
              segment.includes(cls),
            )
            if (hasHighElevation) {
              const hasBorder = BORDER_PATTERN.test(segment)
              if (hasBorder) {
                expect.fail(
                  `${relFile}:${line} — high-elevation element has a border class.\n` +
                    `  Classes: "${segment.substring(0, 200)}"`,
                )
              }
            }
          }
        },
      ),
      { numRuns: knownHighElevationFiles.length },
    )
  })

  it('low-elevation elements (shadow-e0, shadow-e1) may have borders', () => {
    // Sanity check: elements with elevation 0 or 1 ARE allowed to have borders
    // (e.g., list-item uses shadow-e0 + border). This confirms the rule is
    // directional — only high elevation is restricted.
    const listItemFile = path.join(componentsDir, 'ui/list-item.tsx')
    if (!fs.existsSync(listItemFile)) return

    const source = fs.readFileSync(listItemFile, 'utf-8')
    const segments = extractClassSegments(source)

    const lowElevationWithBorder = segments.some(
      ({ segment }) =>
        (segment.includes('shadow-e0') || segment.includes('shadow-e1')) &&
        BORDER_PATTERN.test(segment),
    )

    // This is expected and valid — low elevation + border is fine
    expect(lowElevationWithBorder).toBe(true)
  })
})


/**
 * **Validates: Requirement 5.6**
 *
 * Property 13: Dialogs lift with elevation 3 or 4 and render a scrim
 *
 * The Design_System mandates that any rendered dialog/modal applies an
 * Elevation_Scale level of `3` or `4` to its content surface AND renders
 * a dimmed overlay (scrim) behind it using the `overlay` color role.
 *
 * This property test renders the `Dialog` primitive open with a variety
 * of content shapes (title text, description text, body content) and
 * verifies that on every render:
 *  - the dialog content element carries `shadow-e3` or `shadow-e4`
 *  - an overlay element exists in the document and carries `bg-overlay`
 *  - the content element does NOT additionally use a low elevation step
 *    (which would contradict the dialog's lifted depth).
 *
 * The test uses Radix's portal so it queries the document, not the
 * render container. After each property iteration the rendered tree is
 * unmounted to avoid leaking dialogs across runs.
 */

const HIGH_ELEVATIONS = ['shadow-e3', 'shadow-e4'] as const
const LOW_ELEVATIONS = ['shadow-e0', 'shadow-e1', 'shadow-e2'] as const

describe('Property 13: Dialogs lift with elevation 3 or 4 and render a scrim', () => {
  it('every open Dialog renders content with shadow-e3 or shadow-e4 plus a bg-overlay scrim', () => {
    fc.assert(
      fc.property(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 60 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 120 }), {
            nil: undefined,
          }),
          body: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        ({ title, description, body }) => {
          const ui = (
            <Dialog open>
              <DialogContent>
                <DialogTitle>{title}</DialogTitle>
                {description != null ? (
                  <DialogDescription>{description}</DialogDescription>
                ) : null}
                <div>{body}</div>
              </DialogContent>
            </Dialog>
          )

          const { unmount } = render(ui)

          try {
            // Scrim: an overlay element rendered into the document carries
            // `bg-overlay` (Requirement 5.6 — dimmed overlay behind dialog).
            const overlays = Array.from(
              document.querySelectorAll<HTMLElement>('[class*="bg-overlay"]'),
            )
            expect(overlays.length).toBeGreaterThan(0)

            // Content surface: the Radix dialog content node is queryable
            // via its role. It must carry shadow-e3 or shadow-e4.
            const contentNodes = Array.from(
              document.querySelectorAll<HTMLElement>('[role="dialog"]'),
            )
            expect(contentNodes.length).toBeGreaterThan(0)

            for (const content of contentNodes) {
              const classes = content.className
              const hasHighElevation = HIGH_ELEVATIONS.some((cls) =>
                classes.includes(cls),
              )
              expect(hasHighElevation).toBe(true)

              // Sanity: the same element must not also apply a contradicting
              // low-elevation token. (Property 14 already forbids combining
              // elevation > 1 with a border; this guards the lift direction.)
              const hasLowElevation = LOW_ELEVATIONS.some((cls) =>
                classes.includes(cls),
              )
              expect(hasLowElevation).toBe(false)
            }
          } finally {
            unmount()
          }
        },
      ),
      { numRuns: 12 },
    )
  })

  it('Dialog source declares both bg-overlay (scrim) and shadow-e3/e4 (lift)', () => {
    // Static cross-check of the Dialog primitive source. This complements
    // the runtime property by guaranteeing the tokens are wired in the
    // component itself, even if a future refactor changes the DOM shape.
    // We scan raw source rather than reusing `extractClassSegments` because
    // the Dialog file contains comments with parentheses that break the
    // non-greedy `cn(...)` regex; tokens must be present in the source
    // regardless of how the cn() arguments are split across lines.
    const dialogPath = path.resolve(
      __dirname,
      '../../src/components/ui/dialog.tsx',
    )
    expect(fs.existsSync(dialogPath)).toBe(true)
    const source = fs.readFileSync(dialogPath, 'utf-8')

    // Scrim: overlay element styled with bg-overlay
    expect(source).toContain('bg-overlay')

    // Lift: content surface uses shadow-e3 or shadow-e4
    const usesHighElevation = HIGH_ELEVATIONS.some((cls) =>
      source.includes(cls),
    )
    expect(usesHighElevation).toBe(true)
  })
})

/**
 * **Validates: Requirement 5.5**
 *
 * Property 12: Resting cards and list items use elevation 0 or 1
 *
 * In the resting state — i.e. without `:hover`, `:focus-visible`, or
 * `:active` modifiers — every card or list-item container declares either
 * `shadow-e0` or `shadow-e1` (which resolve to `var(--elevation-0)` and
 * `var(--elevation-1)` respectively via Tailwind's tokenized boxShadow
 * scale). Higher elevation is reserved for lifted surfaces such as
 * dialogs, popovers, and toasts.
 *
 * This property is exercised two ways:
 *   1. Render: drive the shared `ListItem` primitive across its full prop
 *      space and assert the rendered `<li>` carries a resting elevation
 *      class in {shadow-e0, shadow-e1} and never one above level 1.
 *   2. Static scan: inspect the resting-card source files (`list-item.tsx`)
 *      and verify their resting class strings reference only
 *      `var(--elevation-0)` / `var(--elevation-1)` (or the Tailwind
 *      `shadow-e0` / `shadow-e1` utilities that map to them).
 */

const RESTING_ELEVATIONS = ['shadow-e0', 'shadow-e1'] as const
const NON_RESTING_ELEVATIONS = ['shadow-e2', 'shadow-e3', 'shadow-e4'] as const

const TONES: ReadonlyArray<ListItemTone> = ['default', 'error', 'success']

/**
 * Strip Tailwind state-modifier prefixes (`hover:`, `focus:`, `focus-visible:`,
 * `active:`, `data-[state=open]:`, `peer-focus:`, etc.) from a className
 * string. What remains is the resting-state class set.
 *
 * The pattern matches any token that contains a `:` after a non-whitespace
 * prefix — Tailwind variant separators always sit between a non-whitespace
 * variant name and the underlying utility.
 */
function restingClasses(allClasses: string): string {
  return allClasses
    .split(/\s+/)
    .filter((token) => token.length > 0)
    // A modifier token has the form `<variant>:<utility>` (possibly nested,
    // e.g. `data-[state=open]:bg-primary` or `motion-safe:animate-pulse`).
    // Resting tokens have no `:` separator.
    .filter((token) => !token.includes(':'))
    .join(' ')
}

describe('Property 12: Resting cards and list items use elevation 0 or 1', () => {
  describe('Render: ListItem resting elevation across the prop space', () => {
    it('every ListItem render emits exactly one resting elevation in {shadow-e0, shadow-e1}', () => {
      // Generators
      const titleArb = fc.string({ minLength: 1, maxLength: 40 })
      const metaArb = fc.option(fc.string({ minLength: 0, maxLength: 60 }), {
        nil: undefined,
      })
      const toneArb = fc.constantFrom<ListItemTone>(...TONES)
      const hasLeadingArb = fc.boolean()
      const hasTrailingArb = fc.boolean()
      // Optional consumer-supplied class extension (callers may pass
      // `className` to ListItem). Whatever they pass must NOT push the
      // resting elevation above level 1, but it should not be required to
      // add elevation either.
      const extraClassArb = fc.constantFrom('', 'mt-8', 'opacity-90')

      fc.assert(
        fc.property(
          titleArb,
          metaArb,
          toneArb,
          hasLeadingArb,
          hasTrailingArb,
          extraClassArb,
          (title, meta, tone, hasLeading, hasTrailing, extraClass) => {
            const { container } = render(
              <ListItem
                title={title}
                meta={meta}
                tone={tone}
                leading={
                  hasLeading ? (
                    <span data-testid="leading">L</span>
                  ) : undefined
                }
                trailing={
                  hasTrailing ? (
                    <span data-testid="trailing">T</span>
                  ) : undefined
                }
                className={extraClass || undefined}
              />,
            )

            const li = container.querySelector('li') as HTMLElement
            expect(li).not.toBeNull()

            const allClasses = li.className
            const resting = restingClasses(allClasses)

            // Resting class set MUST contain exactly one of {shadow-e0, shadow-e1}
            const restingTokens = resting.split(/\s+/)
            const restingElevations = restingTokens.filter((tok) =>
              (RESTING_ELEVATIONS as readonly string[]).includes(tok),
            )
            expect(restingElevations.length).toBe(1)

            // Resting class set MUST NOT contain shadow-e2, shadow-e3, or shadow-e4
            for (const high of NON_RESTING_ELEVATIONS) {
              expect(restingTokens).not.toContain(high)
            }
          },
        ),
        { numRuns: 50 },
      )
    })

    it('the resting elevation token resolves to var(--elevation-0) or var(--elevation-1)', () => {
      // Sanity-check the token mapping: `shadow-e0` and `shadow-e1` are the
      // ONLY Tailwind utilities that the Design_System exposes for the
      // resting band. They are wired in tailwind.config.ts to
      // tokens.elevation[0] / tokens.elevation[1], which are CSS variables.
      // Each variable is declared in tokens.css under :root.
      const tokensCssPath = path.resolve(
        __dirname,
        '../../src/styles/tokens.css',
      )
      const tokensSource = fs.readFileSync(tokensCssPath, 'utf-8')

      // --elevation-0 must be declared (Requirement 5.2: 'none' or no shadow)
      expect(tokensSource).toMatch(/--elevation-0:\s*none\s*;/)

      // --elevation-1 must be declared (Requirement 5.3: soft, short shadow)
      expect(tokensSource).toMatch(/--elevation-1:[^;]+;/)
    })
  })

  describe('Static scan: resting-card source files use elevation 0 or 1', () => {
    // The shared list-item primitive owns the resting card / list-item
    // surface treatment. Both TaskItem and HabitItem render through it
    // (Requirement 13.3), so verifying it is sufficient to validate every
    // resting card and list item in the application.
    const RESTING_CARD_SOURCES = [
      path.resolve(__dirname, '../../src/components/ui/list-item.tsx'),
    ]

    it('every resting-card source file declares a resting elevation in {shadow-e0, shadow-e1}', () => {
      fc.assert(
        fc.property(fc.constantFrom(...RESTING_CARD_SOURCES), (file) => {
          expect(fs.existsSync(file)).toBe(true)

          const source = fs.readFileSync(file, 'utf-8')

          // Find every Tailwind shadow-e* token in the file. We then split
          // each into resting (no modifier prefix) vs. state-prefixed
          // (e.g. `hover:shadow-e1`).
          const allShadowMatches = source.match(/(?:[a-z0-9:_\-[\]=]+:)*shadow-e[0-9]+/g) ?? []

          // Partition into resting (unprefixed) and prefixed (state-only) sets.
          const restingShadows = allShadowMatches.filter(
            (tok) => !tok.includes(':'),
          )

          // The file MUST declare at least one resting elevation.
          expect(restingShadows.length).toBeGreaterThan(0)

          // Every resting elevation token MUST be in {shadow-e0, shadow-e1}.
          for (const tok of restingShadows) {
            expect(RESTING_ELEVATIONS as readonly string[]).toContain(tok)
          }
        }),
        { numRuns: RESTING_CARD_SOURCES.length },
      )
    })

    it('resting-card source files do not declare shadow-e2/3/4 in their resting class set', () => {
      // This is the dual of the test above, framed against the forbidden
      // band so the failure message points at the offending token if a
      // future refactor lifts a resting card too high.
      const file = path.resolve(__dirname, '../../src/components/ui/list-item.tsx')
      const source = fs.readFileSync(file, 'utf-8')

      const restingHigh = (
        source.match(/(?:[a-z0-9:_\-[\]=]+:)*shadow-e[0-9]+/g) ?? []
      ).filter(
        (tok) =>
          !tok.includes(':') &&
          (NON_RESTING_ELEVATIONS as readonly string[]).includes(tok),
      )

      expect(restingHigh).toEqual([])
    })
  })
})
