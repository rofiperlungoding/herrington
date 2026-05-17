import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **Validates: Requirements 15.1, 15.3, 15.5**
 *
 * Property 3: Color tokens are scoped to [data-theme]
 *
 * For any `--color-*` custom property declaration in `tokens.css`, the enclosing
 * selector contains `[data-theme=`. Structural tokens (spacing, radius, motion,
 * typography metrics) are declared on `:root`, never inside a `[data-theme]` block.
 */

const TOKENS_CSS_PATH = resolve(__dirname, '../../src/styles/tokens.css')

interface CssDeclaration {
  property: string
  selector: string
  line: number
}

/**
 * Parses tokens.css and extracts all custom property declarations with their
 * enclosing selector context.
 */
function parseCustomProperties(css: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = []
  const lines = css.split('\n')

  // Track the current selector context as we walk through the file
  let currentSelector = ''
  let braceDepth = 0
  const selectorStack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip comments
    const trimmed = line.trim()
    if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      continue
    }

    // Count braces to track nesting
    for (let j = 0; j < line.length; j++) {
      const char = line[j]

      if (char === '{') {
        // The text before this brace (on this line or accumulated) is the selector
        const beforeBrace = line.substring(0, j).trim()
        if (beforeBrace) {
          currentSelector = beforeBrace
        }
        selectorStack.push(currentSelector)
        braceDepth++
      } else if (char === '}') {
        selectorStack.pop()
        braceDepth--
        currentSelector = selectorStack.length > 0 ? selectorStack[selectorStack.length - 1] : ''
      }
    }

    // Check for custom property declarations (--something: value)
    const propMatch = trimmed.match(/^(--[\w-]+)\s*:/)
    if (propMatch) {
      const property = propMatch[1]
      const selector = selectorStack.length > 0 ? selectorStack[selectorStack.length - 1] : ''
      declarations.push({ property, selector, line: i + 1 })
    }
  }

  return declarations
}

describe('Property 3: Color tokens are scoped to [data-theme]', () => {
  const css = readFileSync(TOKENS_CSS_PATH, 'utf-8')
  const declarations = parseCustomProperties(css)

  const colorDeclarations = declarations.filter(d => d.property.startsWith('--color-'))
  const structuralDeclarations = declarations.filter(d => !d.property.startsWith('--color-'))

  it('tokens.css contains color declarations to test', () => {
    expect(colorDeclarations.length).toBeGreaterThan(0)
  })

  it('tokens.css contains structural declarations to test', () => {
    expect(structuralDeclarations.length).toBeGreaterThan(0)
  })

  it('every --color-* token is declared inside a [data-theme] selector', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...colorDeclarations),
        (decl: CssDeclaration) => {
          const isInsideDataTheme = decl.selector.includes('[data-theme')
          if (!isInsideDataTheme) {
            throw new Error(
              `Color token "${decl.property}" at line ${decl.line} is declared under selector "${decl.selector}" which is NOT inside a [data-theme] block. ` +
              `All color tokens must be scoped to [data-theme] per Requirements 15.1, 15.3, 15.5.`
            )
          }
          return true
        }
      ),
      { numRuns: colorDeclarations.length }
    )
  })

  it('structural tokens (non-color) are declared on :root, not inside [data-theme]', () => {
    // Filter to only structural tokens that are NOT inside @media blocks
    // (reduced-motion overrides of duration tokens inside :root are acceptable)
    const nonMediaStructural = structuralDeclarations.filter(d => {
      // Tokens inside @media blocks (like prefers-reduced-motion) are acceptable on :root
      return !d.selector.includes('@media')
    })

    fc.assert(
      fc.property(
        fc.constantFrom(...nonMediaStructural),
        (decl: CssDeclaration) => {
          const isOnRoot = decl.selector === ':root' || decl.selector.trim() === ':root'
          const isInsideDataTheme = decl.selector.includes('[data-theme')
          if (isInsideDataTheme) {
            throw new Error(
              `Structural token "${decl.property}" at line ${decl.line} is declared inside a [data-theme] block (selector: "${decl.selector}"). ` +
              `Structural tokens (spacing, radius, motion, typography) should be on :root, not theme-scoped.`
            )
          }
          if (!isOnRoot) {
            throw new Error(
              `Structural token "${decl.property}" at line ${decl.line} is declared under selector "${decl.selector}" which is not :root. ` +
              `Structural tokens should be declared on :root.`
            )
          }
          return true
        }
      ),
      { numRuns: nonMediaStructural.length }
    )
  })
})

/**
 * **Validates: Requirements 1.5, 1.6**
 *
 * Property 2: Token identifiers are theme-agnostic
 *
 * Token names describe semantic roles (e.g. `--color-primary`, `--color-on-surface`,
 * `--color-error`), not specific colors or themes. No token identifier may embed
 *   - a literal color name (red, blue, green, ...),
 *   - a theme name (light, dark), or
 *   - a numeric color step (e.g. `--color-blue-500`).
 *
 * Per Requirement 1.6, when a second theme is added, it overrides the same
 * theme-agnostic names under a `[data-theme]` selector — no theme-suffixed names
 * are introduced.
 */

/** Literal color names that must never appear as a segment of a token identifier. */
const FORBIDDEN_COLOR_WORDS = [
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'magenta',
  'cyan',
  'brown',
  'gray',
  'grey',
  'black',
  'white',
  'amber',
  'lime',
  'teal',
  'indigo',
  'violet',
  'fuchsia',
  'rose',
  'sky',
  'emerald',
  'slate',
  'zinc',
  'neutral',
  'stone',
] as const

/** Theme names that must never appear as a segment of a token identifier. */
const FORBIDDEN_THEME_WORDS = ['light', 'dark'] as const

const FORBIDDEN_WORDS: readonly string[] = [
  ...FORBIDDEN_COLOR_WORDS,
  ...FORBIDDEN_THEME_WORDS,
]

/**
 * Splits a CSS custom-property name into its hyphen-separated segments
 * (excluding the leading `--`).
 *
 * `--color-on-surface` -> ['color', 'on', 'surface']
 */
function segmentsOf(name: string): string[] {
  return name.replace(/^--/, '').toLowerCase().split('-')
}

describe('Property 2: Token identifiers are theme-agnostic', () => {
  const css = readFileSync(TOKENS_CSS_PATH, 'utf-8')
  const declarations = parseCustomProperties(css)

  // Unique token identifiers (a token may be re-declared per theme).
  const allTokenNames = Array.from(new Set(declarations.map(d => d.property)))
  const colorTokenNames = allTokenNames.filter(name => name.startsWith('--color-'))

  it('tokens.css declares token identifiers to test', () => {
    expect(allTokenNames.length).toBeGreaterThan(0)
  })

  it('tokens.css declares --color-* identifiers to test', () => {
    expect(colorTokenNames.length).toBeGreaterThan(0)
  })

  it('no token identifier embeds a literal color name or theme name as a segment', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allTokenNames),
        fc.constantFrom(...FORBIDDEN_WORDS),
        (tokenName: string, forbidden: string) => {
          const segments = segmentsOf(tokenName)
          if (segments.includes(forbidden)) {
            throw new Error(
              `Token "${tokenName}" contains forbidden segment "${forbidden}". ` +
                `Token identifiers must be theme-agnostic and describe semantic roles ` +
                `(e.g. --color-primary, --color-on-surface, --color-error), ` +
                `not specific colors or themes (Requirements 1.5, 1.6).`,
            )
          }
          return true
        },
      ),
      { numRuns: allTokenNames.length * FORBIDDEN_WORDS.length },
    )
  })

  it('no --color-* identifier contains a numeric color step (e.g. -50, -500, -900)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...colorTokenNames),
        (tokenName: string) => {
          for (const segment of segmentsOf(tokenName)) {
            // A "numeric color step" is a 2- or 3-digit segment commonly used in
            // palette ladders like blue-500, gray-900. Single digits (e.g. the `0`
            // in --elevation-0) are not relevant because this assertion only runs
            // against --color-* tokens, and 4-or-more digit segments are not used
            // for color steps.
            if (/^\d{2,3}$/.test(segment)) {
              throw new Error(
                `Color token "${tokenName}" contains a numeric color step "${segment}". ` +
                  `Color tokens must describe semantic roles (e.g. --color-primary), ` +
                  `not numeric color steps like --color-blue-500 (Requirements 1.5, 1.6).`,
              )
            }
          }
          return true
        },
      ),
      { numRuns: colorTokenNames.length },
    )
  })
})

/**
 * **Validates: Requirements 1.1, 1.2, 1.7, 2.1, 3.2, 4.1, 4.3, 5.1, 6.1**
 *
 * Property 1: Token parity across CSS and TypeScript
 *
 * For any token name declared in `src/styles/tokens.css` under `:root` or any
 * `[data-theme]` selector, a key with an equivalent resolved value exists in
 * the `tokens` object exported by `src/styles/tokens.ts`; and for any key in
 * `tokens.ts`, an equivalent CSS custom property exists in `tokens.css`.
 *
 * The TypeScript mirror references colors, elevations, durations, and easings
 * indirectly via `var(--…)` so the active `[data-theme]` wins at runtime.
 * Spacing, radius, and typography sizes/line-heights are mirrored as literal
 * values, so we additionally verify literal equality on those categories.
 */

import { tokens } from '../../src/styles/tokens'

interface TokenCategory {
  /** Human-readable category name for failure messages. */
  name: string
  /** CSS custom property prefix used by this category. */
  cssPrefix: string
  /**
   * Map of CSS-property → expected TS value. The value is either a literal
   * string (when TS holds a literal that must match the CSS value) or a
   * `var(--…)` reference (when TS indirects through the CSS variable).
   */
  tsEntries: Map<string, string>
  /**
   * When true, the TS side mirrors the CSS literal verbatim and the
   * comparison is value-equal (after trimming). When false, the TS side
   * uses `var(--…)` indirection and we only verify that the referenced
   * custom property name matches the CSS property name.
   */
  literalParity: boolean
}

/**
 * Parse all custom property declarations under `:root` and `[data-theme*]`
 * selectors, returning a Map of property → declared value (raw text after `:`).
 *
 * We only consider declarations whose enclosing selector is `:root` (top-level,
 * outside any `@media` block) or any selector containing `[data-theme`. This
 * matches the parity contract in `scripts/check-tokens.mjs`.
 */
function parseCssTokenValues(css: string): Map<string, string> {
  const props = new Map<string, string>()

  // Strip block comments to simplify regex matching.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

  const ruleRegex = /([^{}@]+?)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = ruleRegex.exec(stripped)) !== null) {
    const selector = match[1].trim()
    const block = match[2]

    const isRoot = selector === ':root'
    const isThemed = /\[data-theme/.test(selector)
    if (!isRoot && !isThemed) continue

    const declRegex = /(--[\w-]+)\s*:\s*([^;]+);/g
    let decl: RegExpExecArray | null
    while ((decl = declRegex.exec(block)) !== null) {
      const propName = decl[1]
      const propValue = decl[2].trim()
      // The first declaration wins. Reduced-motion overrides live inside
      // `@media (prefers-reduced-motion: reduce)` rules whose enclosing
      // selector matches `:root` only at the outer scope; the regex above
      // does not descend into nested at-rule blocks, so we are safe.
      if (!props.has(propName)) {
        props.set(propName, propValue)
      }
    }
  }

  return props
}

const CSS_PROP_VALUES = parseCssTokenValues(readFileSync(TOKENS_CSS_PATH, 'utf-8'))

/**
 * Build the per-category catalog of TS entries the parity test will quantify
 * over. Each category is built directly from the imported `tokens` object,
 * so any change to `tokens.ts` automatically expands the property test.
 */
function buildCategories(): TokenCategory[] {
  const categories: TokenCategory[] = []

  // Spacing: tokens.spacing[N] = '<N>px' ↔ --space-N: <N>px
  const spacingEntries = new Map<string, string>()
  for (const [key, value] of Object.entries(tokens.spacing)) {
    spacingEntries.set(`--space-${key}`, value as string)
  }
  categories.push({ name: 'spacing', cssPrefix: '--space-', tsEntries: spacingEntries, literalParity: true })

  // Radius: tokens.radius[k] = '<value>' ↔ --radius-k: <value>
  const radiusEntries = new Map<string, string>()
  for (const [key, value] of Object.entries(tokens.radius)) {
    radiusEntries.set(`--radius-${key}`, value as string)
  }
  categories.push({ name: 'radius', cssPrefix: '--radius-', tsEntries: radiusEntries, literalParity: true })

  // Elevation: tokens.elevation[k] = 'var(--elevation-k)' ↔ --elevation-k: <shadow>
  const elevationEntries = new Map<string, string>()
  for (const [key, value] of Object.entries(tokens.elevation)) {
    elevationEntries.set(`--elevation-${key}`, value as string)
  }
  categories.push({ name: 'elevation', cssPrefix: '--elevation-', tsEntries: elevationEntries, literalParity: false })

  // Duration: tokens.duration[k] = 'var(--duration-k)'
  const durationEntries = new Map<string, string>()
  for (const [key, value] of Object.entries(tokens.duration)) {
    durationEntries.set(`--duration-${key}`, value as string)
  }
  categories.push({ name: 'duration', cssPrefix: '--duration-', tsEntries: durationEntries, literalParity: false })

  // Easing: tokens.easing[k] = 'var(--easing-k)'
  const easingEntries = new Map<string, string>()
  for (const [key, value] of Object.entries(tokens.easing)) {
    easingEntries.set(`--easing-${key}`, value as string)
  }
  categories.push({ name: 'easing', cssPrefix: '--easing-', tsEntries: easingEntries, literalParity: false })

  // Color: tokens.color[k] = 'var(--color-k)'
  const colorEntries = new Map<string, string>()
  for (const [key, value] of Object.entries(tokens.color)) {
    colorEntries.set(`--color-${key}`, value as string)
  }
  categories.push({ name: 'color', cssPrefix: '--color-', tsEntries: colorEntries, literalParity: false })

  // Typography: tokens.typography[step].size  ↔ --font-size-<step>
  //             tokens.typography[step].lineHeight ↔ --line-height-<step>
  const fontSizeEntries = new Map<string, string>()
  const lineHeightEntries = new Map<string, string>()
  for (const [step, metrics] of Object.entries(tokens.typography)) {
    fontSizeEntries.set(`--font-size-${step}`, (metrics as { size: string }).size)
    lineHeightEntries.set(`--line-height-${step}`, (metrics as { lineHeight: string }).lineHeight)
  }
  categories.push({ name: 'font-size', cssPrefix: '--font-size-', tsEntries: fontSizeEntries, literalParity: true })
  categories.push({ name: 'line-height', cssPrefix: '--line-height-', tsEntries: lineHeightEntries, literalParity: true })

  return categories
}

const CATEGORIES = buildCategories()

/** All CSS custom properties whose name falls into a tracked category. */
const TRACKED_CSS_PROPS: string[] = [...CSS_PROP_VALUES.keys()].filter(prop =>
  CATEGORIES.some(cat => prop.startsWith(cat.cssPrefix)),
)

/** All TS-side CSS-property names quantified across every category. */
const ALL_TS_PROPS: string[] = CATEGORIES.flatMap(cat => [...cat.tsEntries.keys()])

describe('Property 1: Token parity across CSS and TypeScript', () => {
  it('tokens.css yields tracked custom-property declarations', () => {
    expect(TRACKED_CSS_PROPS.length).toBeGreaterThan(0)
  })

  it('tokens.ts exposes parseable category entries', () => {
    expect(ALL_TS_PROPS.length).toBeGreaterThan(0)
  })

  it('every TypeScript token has a matching CSS custom property (with equivalent resolved value)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CATEGORIES), (category: TokenCategory) => {
        const tsEntries = [...category.tsEntries.entries()]
        if (tsEntries.length === 0) return true
        return fc.assert(
          fc.property(
            fc.constantFrom(...tsEntries),
            ([cssProp, tsValue]: [string, string]) => {
              if (!CSS_PROP_VALUES.has(cssProp)) {
                throw new Error(
                  `Token "${cssProp}" exists in tokens.ts (category: ${category.name}) but is NOT declared in tokens.css. ` +
                  `Per Requirement 1.7, every TypeScript token must mirror a CSS custom property.`,
                )
              }

              if (category.literalParity) {
                const cssValue = CSS_PROP_VALUES.get(cssProp)!
                if (cssValue.trim() !== tsValue.trim()) {
                  throw new Error(
                    `Token "${cssProp}" has mismatched values: tokens.css = "${cssValue}", tokens.ts = "${tsValue}". ` +
                    `Per Requirements 1.1 and 1.2, the TS mirror must resolve to the same value as the CSS source.`,
                  )
                }
              } else {
                // Indirected category: the TS value MUST be `var(--<same-name>)`.
                const expected = `var(${cssProp})`
                if (tsValue.trim() !== expected) {
                  throw new Error(
                    `Token "${cssProp}" in category "${category.name}" expects TS value "${expected}" ` +
                    `but tokens.ts has "${tsValue}". The TS mirror must reference the CSS variable by its exact name ` +
                    `so the active [data-theme] wins at runtime.`,
                  )
                }
              }

              return true
            },
          ),
          { numRuns: tsEntries.length },
        )
      }),
      { numRuns: CATEGORIES.length },
    )
  })

  it('every CSS custom property in a tracked category has a matching TypeScript token', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TRACKED_CSS_PROPS),
        (cssProp: string) => {
          const category = CATEGORIES.find(cat => cssProp.startsWith(cat.cssPrefix))
          if (!category) {
            // TRACKED_CSS_PROPS guarantees a category match; defensive guard only.
            throw new Error(`Internal: no category for "${cssProp}"`)
          }
          if (!category.tsEntries.has(cssProp)) {
            throw new Error(
              `CSS custom property "${cssProp}" is declared in tokens.css but is NOT exposed in tokens.ts (category: ${category.name}). ` +
              `Per Requirement 1.7, every CSS token must have a corresponding TypeScript entry.`,
            )
          }

          if (category.literalParity) {
            const cssValue = CSS_PROP_VALUES.get(cssProp)!
            const tsValue = category.tsEntries.get(cssProp)!
            if (cssValue.trim() !== tsValue.trim()) {
              throw new Error(
                `Token "${cssProp}" value mismatch: tokens.css = "${cssValue}", tokens.ts = "${tsValue}".`,
              )
            }
          } else {
            const tsValue = category.tsEntries.get(cssProp)!
            const expected = `var(${cssProp})`
            if (tsValue.trim() !== expected) {
              throw new Error(
                `Token "${cssProp}" in TS should reference "${expected}" but is "${tsValue}".`,
              )
            }
          }

          return true
        },
      ),
      { numRuns: TRACKED_CSS_PROPS.length },
    )
  })
})
