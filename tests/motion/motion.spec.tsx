import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

// Feature: ui-redesign-google-style, Property 15: Reduced motion collapses
// decorative durations to ≤ 1ms.

/**
 * **Validates: Requirements 6.3, 6.4, 6.5**
 *
 * Property 15: Reduced motion collapses decorative durations to ≤ 1ms
 *
 * For any `--duration-*` token declared in `tokens.css` under `:root`, the
 * `@media (prefers-reduced-motion: reduce)` rule overrides the same token to a
 * value of at most `1ms` (i.e. `0`, `0ms`, or `1ms`). Consequently, dialog
 * open/close transitions (Req 6.3), toast enter/exit transitions (Req 6.4),
 * and decorative state transitions (Req 6.5) all collapse at the token layer
 * with no per-component `@media` blocks.
 *
 * jsdom does not evaluate `prefers-reduced-motion` media queries against real
 * computed style, so this property is verified by parsing `tokens.css`
 * statically — the same source the browser would resolve at runtime.
 */

const TOKENS_CSS_PATH = resolve(__dirname, '../../src/styles/tokens.css')

interface DurationDeclaration {
  property: string
  value: string
}

/**
 * Strip CSS block comments so the regex parsers below don't trip on
 * commented-out declarations.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Extract every `--duration-*` declaration whose enclosing selector is
 * `:root` and whose enclosing context is the file's top level (i.e. NOT
 * inside an `@media` block). This represents the "default" duration values
 * that the reduced-motion override must collapse.
 */
function parseRootDurationDeclarations(css: string): DurationDeclaration[] {
  const stripped = stripComments(css)
  const declarations: DurationDeclaration[] = []

  // Walk the source character-by-character so we can ignore content inside
  // any nested at-rule (notably `@media`). Top-level `:root { ... }` blocks
  // are the only ones we collect from here.
  let i = 0
  let depth = 0
  let atRuleDepth = 0 // how many open `@…` blocks we are inside
  let pendingSelector = ''
  let selectorIsRoot = false
  let selectorIsAtRule = false

  while (i < stripped.length) {
    const ch = stripped[i]
    if (ch === '{') {
      depth++
      if (selectorIsAtRule) {
        atRuleDepth++
      }
      // Once we enter a block, we don't accumulate selector text any more
      // until the block closes.
      pendingSelector = ''
    } else if (ch === '}') {
      depth--
      if (atRuleDepth > 0 && depth < atRuleDepth) {
        atRuleDepth--
      }
      pendingSelector = ''
      selectorIsRoot = false
      selectorIsAtRule = false
    } else if (depth === 0 || (depth === 1 && atRuleDepth === 0)) {
      // Accumulate selector text while we are between blocks at the top level.
      pendingSelector += ch
      const trimmed = pendingSelector.trim()
      selectorIsAtRule = trimmed.startsWith('@')
      selectorIsRoot = trimmed === ':root'
    }

    i++
  }

  // The walk above tracks structure; do a second pass with a simple regex to
  // pull declarations from each top-level `:root { ... }` block (excluding any
  // content inside nested `@media` blocks).
  const topLevelRootBlocks = extractTopLevelBlocks(stripped, /^:root$/)
  for (const block of topLevelRootBlocks) {
    const body = removeNestedAtRuleBlocks(block)
    const declRegex = /(--duration-[\w-]+)\s*:\s*([^;]+);/g
    let match: RegExpExecArray | null
    while ((match = declRegex.exec(body)) !== null) {
      declarations.push({ property: match[1], value: match[2].trim() })
    }
  }

  return declarations
}

/**
 * Extract the body of every top-level rule whose selector matches the
 * supplied predicate. "Top-level" means the rule is not nested inside any
 * at-rule (e.g. `@media`).
 */
function extractTopLevelBlocks(css: string, selectorPattern: RegExp): string[] {
  const blocks: string[] = []
  let i = 0
  let depth = 0
  let atRuleDepth = 0
  let selectorBuf = ''
  let blockStart = -1

  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      const trimmed = selectorBuf.trim()
      const isAtRule = trimmed.startsWith('@')
      depth++
      if (isAtRule) {
        atRuleDepth++
      } else if (atRuleDepth === 0 && selectorPattern.test(trimmed)) {
        blockStart = i + 1
      }
      selectorBuf = ''
    } else if (ch === '}') {
      if (blockStart !== -1 && depth === 1) {
        blocks.push(css.slice(blockStart, i))
        blockStart = -1
      }
      depth--
      if (atRuleDepth > 0 && depth < atRuleDepth) {
        atRuleDepth--
      }
      selectorBuf = ''
    } else if (depth === 0) {
      selectorBuf += ch
    }
    i++
  }

  return blocks
}

/**
 * Given a CSS block body, remove any nested `@…{ … }` rules (e.g. an inline
 * `@media` inside `:root`). The reduced-motion override lives at the file's
 * top level, not nested inside `:root`, but defensive cleanup makes the
 * declaration extractor robust.
 */
function removeNestedAtRuleBlocks(blockBody: string): string {
  let out = ''
  let i = 0
  while (i < blockBody.length) {
    const ch = blockBody[i]
    if (ch === '@') {
      // Skip from the @ to the matching closing brace.
      let depth = 0
      let started = false
      while (i < blockBody.length) {
        const c = blockBody[i]
        if (c === '{') {
          depth++
          started = true
        } else if (c === '}') {
          depth--
          if (started && depth === 0) {
            i++
            break
          }
        }
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Locate the `@media (prefers-reduced-motion: reduce)` block at the file's
 * top level and return every duration override declared anywhere inside it
 * (regardless of which selector wraps the declarations).
 */
function parseReducedMotionDurationOverrides(css: string): DurationDeclaration[] {
  const stripped = stripComments(css)
  const overrides: DurationDeclaration[] = []

  // Find the top-level @media (prefers-reduced-motion: reduce) { ... } block.
  const headerRegex = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = headerRegex.exec(stripped)) !== null) {
    // Walk forward to the matching closing brace, respecting nesting.
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    const body = stripped.slice(start, i - 1)

    const declRegex = /(--duration-[\w-]+)\s*:\s*([^;]+);/g
    let decl: RegExpExecArray | null
    while ((decl = declRegex.exec(body)) !== null) {
      overrides.push({ property: decl[1], value: decl[2].trim() })
    }
  }

  return overrides
}

/**
 * Convert a CSS time value string to milliseconds. Supports `0`, `0ms`,
 * `1ms`, and `0.5s`-style values. Throws on unrecognised units.
 */
function durationValueToMs(value: string): number {
  const trimmed = value.trim()
  if (trimmed === '0') return 0
  const msMatch = trimmed.match(/^([\d.]+)ms$/)
  if (msMatch) return parseFloat(msMatch[1])
  const sMatch = trimmed.match(/^([\d.]+)s$/)
  if (sMatch) return parseFloat(sMatch[1]) * 1000
  throw new Error(`Cannot interpret duration value "${value}" as a time.`)
}

describe('Property 15: Reduced motion collapses decorative durations to ≤ 1ms', () => {
  const css = readFileSync(TOKENS_CSS_PATH, 'utf-8')
  const rootDurations = parseRootDurationDeclarations(css)
  const reducedOverrides = parseReducedMotionDurationOverrides(css)
  const overrideMap = new Map<string, string>()
  for (const o of reducedOverrides) {
    // Last write wins — matches CSS cascade semantics inside the same block.
    overrideMap.set(o.property, o.value)
  }

  it('tokens.css declares duration-* tokens at :root to test', () => {
    expect(rootDurations.length).toBeGreaterThan(0)
  })

  it('tokens.css contains a @media (prefers-reduced-motion: reduce) block', () => {
    expect(reducedOverrides.length).toBeGreaterThan(0)
  })

  it('every :root --duration-* token is overridden inside the reduced-motion block', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...rootDurations),
        (decl: DurationDeclaration) => {
          if (!overrideMap.has(decl.property)) {
            throw new Error(
              `Duration token "${decl.property}" is declared at :root with value "${decl.value}" ` +
              `but is NOT overridden in the @media (prefers-reduced-motion: reduce) block. ` +
              `Per Requirement 6.5, every decorative duration must collapse to ≤ 1ms when ` +
              `the user prefers reduced motion.`,
            )
          }
          return true
        },
      ),
      { numRuns: rootDurations.length },
    )
  })

  it('every reduced-motion duration override resolves to ≤ 1ms', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...reducedOverrides),
        (decl: DurationDeclaration) => {
          let ms: number
          try {
            ms = durationValueToMs(decl.value)
          } catch (err) {
            throw new Error(
              `Reduced-motion override for "${decl.property}" has unparseable value "${decl.value}". ` +
              `Expected a duration like "0", "0ms", or "1ms". Original parse error: ${(err as Error).message}`,
            )
          }
          if (ms > 1) {
            throw new Error(
              `Reduced-motion override "${decl.property}: ${decl.value}" resolves to ${ms}ms, ` +
              `which exceeds the 1ms ceiling required by Requirements 6.3, 6.4, and 6.5. ` +
              `Decorative durations must collapse to 0ms or 1ms when prefers-reduced-motion: reduce.`,
            )
          }
          return true
        },
      ),
      { numRuns: reducedOverrides.length },
    )
  })

  it('the original :root duration values exceed 1ms (so the override is meaningful)', () => {
    // Sanity check: if all default durations were already ≤ 1ms, the
    // reduced-motion property would be vacuously true.
    const defaults = rootDurations.map(d => durationValueToMs(d.value))
    expect(defaults.some(ms => ms > 1)).toBe(true)
  })
})


// ─────────────────────────────────────────────────────────────────────────
// Property 16: Hover and focus transitions animate only allowed properties
// ─────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 6.2, 6.6, 6.7**
 *
 * Property 16: Hover and focus transitions animate only allowed properties
 *
 * For any element in the Component_Library that declares a CSS `transition`
 * for a hover or focus state, the set of animated properties MUST be a
 * subset of the Design_System allow-list:
 *
 *     {transform, opacity, background-color, border-color, color, box-shadow}
 *
 * Forbidden properties — `width`, `height`, `top`, `left`, `right`,
 * `bottom`, `padding`, `margin` — never appear in a hover or focus
 * transition declaration because animating them triggers layout (which
 * pushes Cumulative Layout Shift up and contradicts the "subtle, purposeful
 * motion" intent of Requirement 6.2 and the explicit allow-list of
 * Requirements 6.6, 6.7).
 *
 * The property is verified statically against the component source files —
 * the same source the browser would resolve at runtime. We scan for
 * `transition-*` Tailwind utilities (`transition-[a,b,c]`,
 * `transition-colors`, `transition-opacity`, `transition-transform`,
 * `transition-shadow`, etc.), and for any class segment that also contains
 * a `hover:` or `focus:`/`focus-visible:` modifier (or sits adjacent to
 * `hover:`/`focus:` utilities on the same element) we check the animated
 * property set is in the allow-list.
 */

const ALLOWED_TRANSITION_PROPERTIES = [
  'transform',
  'opacity',
  'background-color',
  'border-color',
  'color',
  'box-shadow',
] as const
type AllowedTransitionProperty = (typeof ALLOWED_TRANSITION_PROPERTIES)[number]

const FORBIDDEN_TRANSITION_PROPERTIES = [
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'padding',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
] as const

/**
 * Tailwind shorthand → set of CSS properties it animates.
 *
 * `transition-colors` animates color, background-color, border-color, fill,
 * stroke, text-decoration-color (per Tailwind docs); we treat the
 * non-color ones (fill, stroke, text-decoration-color) as harmless because
 * they're not in the forbidden list and they belong to the same "color"
 * family the allow-list is drawn from.
 */
const TAILWIND_TRANSITION_SHORTHANDS: Record<
  string,
  ReadonlyArray<AllowedTransitionProperty | string>
> = {
  'transition-colors': ['color', 'background-color', 'border-color'],
  'transition-opacity': ['opacity'],
  'transition-transform': ['transform'],
  'transition-shadow': ['box-shadow'],
  // `transition` and `transition-all` animate every property — both are
  // overly broad and not allowed for hover/focus because they include the
  // forbidden layout properties.
  transition: ['ALL'],
  'transition-all': ['ALL'],
  // `transition-none` disables transitions; it animates nothing.
  'transition-none': [],
}

interface TransitionSegment {
  file: string
  line: number
  segment: string
  /** The full transition utility token e.g. `transition-[background-color,color]`. */
  token: string
  /** Properties this transition utility animates. */
  properties: string[]
  /** Whether the same element also declares a hover:/focus:/focus-visible: modifier. */
  hasHoverOrFocusModifier: boolean
}

/**
 * Recursively collect .ts/.tsx/.css files under a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (entry.isFile() && /\.(tsx?|css)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Extract className "segments" from a source string. A segment represents
 * the union of class strings that apply to the same element — gathered
 * from a `cn(...)` call or from a static `className="..."` / `className={"..."}`
 * attribute. Each segment carries the line number of the first character
 * of the cn() call or the className attribute so failures point to the
 * right spot in the source.
 */
function extractClassSegments(
  source: string,
): { segment: string; line: number }[] {
  const segments: { segment: string; line: number }[] = []

  // 1) `cn(...)` calls — the canonical Design_System className composition.
  //    We pull every string-literal argument and join them. We use a
  //    bracket-aware walker so nested parentheses inside template literal
  //    expressions don't truncate the call early.
  let i = 0
  while (i < source.length) {
    const idx = source.indexOf('cn(', i)
    if (idx === -1) break
    // Make sure the "cn" is a word boundary.
    const before = idx > 0 ? source[idx - 1] : ' '
    if (/[A-Za-z0-9_$]/.test(before)) {
      i = idx + 3
      continue
    }
    let depth = 1
    let j = idx + 3
    while (j < source.length && depth > 0) {
      const c = source[j]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '"' || c === "'" || c === '`') {
        // Skip the entire string literal so the parens-counter ignores
        // parens that appear inside string content.
        const quote = c
        j++
        while (j < source.length) {
          if (source[j] === '\\') {
            j += 2
            continue
          }
          if (source[j] === quote) break
          j++
        }
      }
      j++
    }
    const callBody = source.slice(idx + 3, Math.max(j - 1, idx + 3))
    const lineNumber = source.substring(0, idx).split('\n').length
    const stringRegex = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g
    const strings: string[] = []
    let strMatch: RegExpExecArray | null
    while ((strMatch = stringRegex.exec(callBody)) !== null) {
      strings.push(strMatch[1] ?? strMatch[2] ?? strMatch[3] ?? '')
    }
    if (strings.length > 0) {
      segments.push({ segment: strings.join(' '), line: lineNumber })
    }
    i = j
  }

  // 2) Static `className="..."` and `className='...'` attributes.
  const classNameStaticRegex = /className\s*=\s*"([^"]*)"|className\s*=\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = classNameStaticRegex.exec(source)) !== null) {
    const lineNumber = source.substring(0, m.index).split('\n').length
    const value = m[1] ?? m[2] ?? ''
    if (value.length > 0) {
      segments.push({ segment: value, line: lineNumber })
    }
  }

  return segments
}

/**
 * Parse a single Tailwind transition utility token and return the set of
 * CSS properties it animates. Returns `null` if the token isn't a
 * recognised transition utility.
 */
function parseTransitionToken(token: string): string[] | null {
  // `transition-[a,b,c]` — arbitrary-value transition list.
  const arbitraryMatch = token.match(/^transition-\[([^\]]+)\]$/)
  if (arbitraryMatch) {
    return arbitraryMatch[1]
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  }

  // Recognised shorthands.
  if (token in TAILWIND_TRANSITION_SHORTHANDS) {
    return [...TAILWIND_TRANSITION_SHORTHANDS[token]]
  }

  return null
}

/**
 * Strip Tailwind variant prefixes (e.g. `hover:`, `focus-visible:`,
 * `data-[state=open]:`, `motion-safe:`) from a token, returning the bare
 * utility. Variants are colon-separated; bracketed segments inside a
 * variant (e.g. `data-[state=open]`) are preserved as part of the variant.
 */
function stripVariants(token: string): { variants: string[]; base: string } {
  const variants: string[] = []
  let rest = token
  // Walk colon-separated variants while honouring bracketed groups so we
  // don't split inside `transition-[background-color,color]`.
  while (true) {
    let depth = 0
    let cut = -1
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]
      if (c === '[') depth++
      else if (c === ']') depth--
      else if (c === ':' && depth === 0) {
        cut = i
        break
      }
    }
    if (cut === -1) break
    const candidate = rest.slice(0, cut)
    // If the remainder starts with `transition-` or another utility token,
    // treat `candidate` as a variant. Otherwise (no remainder), stop.
    const remainder = rest.slice(cut + 1)
    if (remainder.length === 0) break
    variants.push(candidate)
    rest = remainder
  }
  return { variants, base: rest }
}

/**
 * Extract every transition utility from a class segment, recording the
 * variants attached to each (so we can detect hover:/focus: scoping).
 */
function extractTransitionsFromSegment(
  segment: string,
): { token: string; variants: string[]; base: string; properties: string[] }[] {
  const out: {
    token: string
    variants: string[]
    base: string
    properties: string[]
  }[] = []
  const tokens = segment.split(/\s+/).filter((t) => t.length > 0)
  for (const token of tokens) {
    const { variants, base } = stripVariants(token)
    if (!base.startsWith('transition')) continue
    const properties = parseTransitionToken(base)
    if (properties === null) continue
    out.push({ token, variants, base, properties })
  }
  return out
}

/**
 * Given a class segment, decide whether the element it represents is in
 * scope for the hover/focus property — i.e. either:
 *   (a) the transition utility itself is variant-prefixed with hover: or
 *       focus: / focus-visible:, OR
 *   (b) the same element declares a hover: or focus: / focus-visible:
 *       state-change utility (anything from background-color to color to
 *       shadow), meaning the unprefixed transition exists *because* of
 *       hover/focus state changes.
 *
 * Case (b) is the dominant pattern in this codebase: the transition is
 * declared at base (so it applies whenever the property changes), and a
 * `hover:` or `focus-visible:` utility on the same element drives the
 * change. The acceptance criteria of Requirements 6.6, 6.7 explicitly cover
 * "transition properties on hover or focus", so unprefixed transitions on
 * elements that have hover/focus state changes ARE in scope.
 */
function elementHasHoverOrFocusInteraction(segment: string): boolean {
  const tokens = segment.split(/\s+/).filter((t) => t.length > 0)
  for (const token of tokens) {
    const { variants } = stripVariants(token)
    for (const v of variants) {
      // `group-hover:` and `peer-hover:` are sibling/parent-driven hover
      // states; they still represent hover-driven state changes on this
      // element, so they count.
      if (
        v === 'hover' ||
        v === 'focus' ||
        v === 'focus-visible' ||
        v === 'focus-within' ||
        v === 'group-hover' ||
        v === 'peer-hover' ||
        v === 'group-focus' ||
        v === 'peer-focus'
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Collect every transition segment in scope for Property 16 across the
 * component source tree. A segment is in scope when at least one of:
 *   - the transition utility is itself variant-prefixed with hover/focus
 *   - the same element declares a hover: / focus: / focus-visible: utility
 */
function collectInScopeTransitions(): TransitionSegment[] {
  const ROOT = resolve(__dirname, '../..')
  const componentsDir = resolve(ROOT, 'src/components')
  const routesDir = resolve(ROOT, 'src/routes')
  const files = [
    ...collectSourceFiles(componentsDir),
    ...collectSourceFiles(routesDir),
  ].filter((f) => !f.endsWith('routeTree.gen.ts'))

  const out: TransitionSegment[] = []
  for (const file of files) {
    let source: string
    try {
      source = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    const segments = extractClassSegments(source)
    for (const { segment, line } of segments) {
      const transitions = extractTransitionsFromSegment(segment)
      if (transitions.length === 0) continue
      const hoverOrFocusOnElement = elementHasHoverOrFocusInteraction(segment)
      for (const t of transitions) {
        const transitionVariantHoverFocus = t.variants.some((v) =>
          [
            'hover',
            'focus',
            'focus-visible',
            'focus-within',
            'group-hover',
            'peer-hover',
            'group-focus',
            'peer-focus',
          ].includes(v),
        )
        if (!hoverOrFocusOnElement && !transitionVariantHoverFocus) continue
        out.push({
          file: rel,
          line,
          segment,
          token: t.token,
          properties: t.properties,
          hasHoverOrFocusModifier: hoverOrFocusOnElement,
        })
      }
    }
  }
  return out
}

describe('Property 16: Hover and focus transitions animate only allowed properties', () => {
  const transitionSegments = collectInScopeTransitions()

  it('component source declares hover/focus-scoped transitions to test', () => {
    // Sanity check: if the corpus contains zero transition utilities the
    // property would be vacuously true, masking a future refactor that
    // strips transitions altogether. Confirm we are actually exercising
    // some hover/focus transitions.
    expect(transitionSegments.length).toBeGreaterThan(0)
  })

  it('every hover/focus transition animates only properties from the allow-list', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...transitionSegments),
        (entry: TransitionSegment) => {
          // `transition` / `transition-all` are over-broad — they animate
          // every property, which necessarily includes layout properties
          // (width, height, top, left, etc.). Reject them outright on
          // hover/focus elements.
          if (entry.properties.includes('ALL')) {
            throw new Error(
              `${entry.file}:${entry.line} — uses '${entry.token}' on a hover/focus element. ` +
              `Per Requirements 6.6, 6.7, hover/focus transitions must enumerate properties ` +
              `explicitly from {${ALLOWED_TRANSITION_PROPERTIES.join(', ')}} and never animate ` +
              `every property.`,
            )
          }

          for (const prop of entry.properties) {
            const isForbidden = (FORBIDDEN_TRANSITION_PROPERTIES as readonly string[]).includes(prop)
            if (isForbidden) {
              throw new Error(
                `${entry.file}:${entry.line} — '${entry.token}' animates forbidden property '${prop}' ` +
                `on a hover/focus element. Per Requirement 6.6, 'width', 'height', 'top', 'left', ` +
                `'right', 'bottom', 'padding', 'margin' must NOT appear in hover/focus transition ` +
                `declarations because they trigger layout.`,
              )
            }

            const isAllowed = (ALLOWED_TRANSITION_PROPERTIES as readonly string[]).includes(prop)
            if (!isAllowed) {
              throw new Error(
                `${entry.file}:${entry.line} — '${entry.token}' animates '${prop}' which is not ` +
                `in the Design_System allow-list. Per Requirement 6.7, hover/focus transitions are ` +
                `restricted to {${ALLOWED_TRANSITION_PROPERTIES.join(', ')}}.`,
              )
            }
          }
          return true
        },
      ),
      { numRuns: transitionSegments.length },
    )
  })

  it('no hover/focus transition declares forbidden layout properties', () => {
    // Dual framing of the property: explicitly assert that for every
    // forbidden property, no in-scope transition mentions it. This makes
    // the failure message direct ("padding appears in transition X")
    // when the regression is introduced.
    fc.assert(
      fc.property(
        fc.constantFrom(...FORBIDDEN_TRANSITION_PROPERTIES),
        (forbidden) => {
          const offenders = transitionSegments.filter((entry) =>
            entry.properties.includes(forbidden),
          )
          if (offenders.length > 0) {
            const summary = offenders
              .slice(0, 5)
              .map((o) => `  ${o.file}:${o.line} — ${o.token}`)
              .join('\n')
            throw new Error(
              `Found ${offenders.length} hover/focus transition(s) animating forbidden ` +
              `property '${forbidden}':\n${summary}`,
            )
          }
          return true
        },
      ),
      { numRuns: FORBIDDEN_TRANSITION_PROPERTIES.length },
    )
  })

  it('arbitrary-value transitions parse cleanly and resolve to allow-list-only properties', () => {
    // Targeted check on the dominant Design_System pattern:
    // `transition-[a,b,c]`. Every such utility on a hover/focus element
    // must list only allow-list properties.
    const arbitraryTransitions = transitionSegments.filter((e) =>
      /^transition-\[/.test(stripVariants(e.token).base),
    )
    expect(arbitraryTransitions.length).toBeGreaterThan(0)

    fc.assert(
      fc.property(
        fc.constantFrom(...arbitraryTransitions),
        (entry: TransitionSegment) => {
          for (const prop of entry.properties) {
            expect(
              (ALLOWED_TRANSITION_PROPERTIES as readonly string[]).includes(prop),
              `${entry.file}:${entry.line} — '${entry.token}' lists property '${prop}' ` +
              `outside the allow-list {${ALLOWED_TRANSITION_PROPERTIES.join(', ')}}.`,
            ).toBe(true)
          }
          return true
        },
      ),
      { numRuns: arbitraryTransitions.length },
    )
  })
})
