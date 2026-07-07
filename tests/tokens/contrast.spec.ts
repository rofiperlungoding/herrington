/**
 * Property 5: WCAG contrast holds for every foreground/background pairing
 *
 * **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 11.3**
 *
 * For any registered foreground/background pairing in the Design_System token
 * source (`src/styles/tokens.css`), the WCAG 2.1 contrast ratio meets the AA
 * threshold appropriate to the pairing's role:
 *   - 4.5:1 for normal text (body copy, button labels)
 *   - 3.0:1 for non-text / UI components (focus ring, error icons/borders,
 *     large text)
 *
 * Pairings are derived automatically from the `color X` / `on-X` naming
 * convention: every `--color-on-X` token is paired with its corresponding
 * `--color-X` background. Additional pairings required by the acceptance
 * criteria (on-surface readability, error/success on surface, focus-ring on
 * each surface variant) are registered explicitly.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKENS_CSS_PATH = resolve(__dirname, '../../src/styles/tokens.css')

// ─── Token parsing ──────────────────────────────────────────────────────────

/**
 * Parse `[data-theme='light']` color declarations from tokens.css and return
 * a map from token name (without the `--color-` prefix) to its raw value.
 *
 * Only solid hex colors are returned — `--color-overlay` (which uses an
 * alpha channel and is composited over a background at runtime) is excluded
 * since contrast against a translucent overlay is undefined without knowing
 * the underlying surface.
 */
function parseLightThemeColors(css: string): Map<string, string> {
  // Use the color tokens :root block
  const lightBlockMatch = css.match(
    /\/\* ── Color tokens: scoped per theme ─────────────────────── \*\/\s*:root\s*\{([^}]+)\}/s,
  )
  if (!lightBlockMatch) {
    throw new Error(`Could not locate color :root block in tokens.css`)
  }
  const block = lightBlockMatch[1]
  const result = new Map<string, string>()

  // Match `--color-<name>: <value>;`
  const declRe = /--color-([\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(block)) !== null) {
    const name = m[1].trim()
    const value = m[2].trim()
    result.set(name, value)
  }

  return result
}

// ─── WCAG 2.1 luminance and contrast ────────────────────────────────────────

type RGB = readonly [number, number, number]

/** Parse a 3- or 6-digit hex string to [r, g, b] in 0–255. */
function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim()
  const expanded =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Invalid hex color: "${hex}"`)
  }
  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  return [r, g, b] as const
}

/** Determine if a CSS color value is a solid color we can compute contrast for. */
function isOpaqueColor(value: string): boolean {
  const v = value.trim()
  // Hex (#abc or #aabbcc)
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return true
  // rgb(r g b) or rgb(r, g, b) — opaque only
  if (/^rgb\(\s*\d+\s*[, ]\s*\d+\s*[, ]\s*\d+\s*\)$/.test(v)) return true
  return false
}

/** Convert any opaque CSS color (hex or rgb) to RGB. */
function parseColor(value: string): RGB {
  const v = value.trim()
  if (v.startsWith('#')) return hexToRgb(v)
  const rgb = v.match(/^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/)
  if (rgb) {
    return [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)] as const
  }
  throw new Error(`Cannot parse non-opaque color value: "${value}"`)
}

/** WCAG 2.1 relative luminance from an sRGB color. */
function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio between two colors. */
function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(parseColor(fg))
  const l2 = relativeLuminance(parseColor(bg))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// ─── Pairing registry ───────────────────────────────────────────────────────

type ContrastPairing = {
  /** Foreground token name (without `--color-` prefix) */
  fgName: string
  /** Background token name (without `--color-` prefix) */
  bgName: string
  /** 'text' requires 4.5:1, 'non-text' requires 3:1 */
  type: 'text' | 'non-text'
  /** Which acceptance criterion this pairing validates */
  requirement: '2.3' | '2.4' | '2.5' | '2.6' | '11.3'
}

/**
 * Build the full set of registered foreground/background pairings.
 *
 * - `on-X` / `X` pairings (Req 2.4): every token named `on-<role>` is paired
 *   with the matching `<role>` background. These are the button-label, toast,
 *   and active-nav contrasts and require 4.5:1.
 * - On-surface readability (Req 2.3): `on-surface` and `on-surface-muted`
 *   against every surface variant.
 * - Error/success on surface (Req 2.6): `error` and `success` text on
 *   `surface`, plus `error` as a non-text affordance (icon/border).
 * - Focus ring (Req 11.3 / Req 2.5): `focus-ring` against every surface
 *   variant as a non-text affordance.
 */
function buildPairings(colors: Map<string, string>): ContrastPairing[] {
  const pairings: ContrastPairing[] = []
  const surfaces = ['surface', 'surface-container', 'surface-variant'].filter((s) =>
    colors.has(s),
  )

  // Req 2.4: every `on-X` paired with its `X` background → 4.5:1 text
  // This auto-derives from the naming convention.
  for (const name of colors.keys()) {
    if (!name.startsWith('on-')) continue
    const bgName = name.slice(3) // strip "on-"
    if (!colors.has(bgName)) continue
    // Skip on-surface variants here — they're covered by the Req 2.3 block
    // below against every surface variant.
    if (bgName === 'surface') continue
    pairings.push({ fgName: name, bgName, type: 'text', requirement: '2.4' })
  }

  // Req 2.3: body text on every surface variant
  for (const surface of surfaces) {
    if (colors.has('on-surface')) {
      pairings.push({ fgName: 'on-surface', bgName: surface, type: 'text', requirement: '2.3' })
    }
    if (colors.has('on-surface-muted')) {
      pairings.push({
        fgName: 'on-surface-muted',
        bgName: surface,
        type: 'text',
        requirement: '2.3',
      })
    }
  }

  // Req 2.6: error and success as text on surface (4.5:1) and as
  // icon/border affordance (3:1)
  if (colors.has('error') && colors.has('surface')) {
    pairings.push({ fgName: 'error', bgName: 'surface', type: 'text', requirement: '2.6' })
    pairings.push({ fgName: 'error', bgName: 'surface', type: 'non-text', requirement: '2.6' })
  }
  if (colors.has('success') && colors.has('surface')) {
    pairings.push({ fgName: 'success', bgName: 'surface', type: 'text', requirement: '2.6' })
  }

  // Req 11.3 (and Req 2.5): focus ring against every surface variant — 3:1
  if (colors.has('focus-ring')) {
    for (const surface of surfaces) {
      pairings.push({
        fgName: 'focus-ring',
        bgName: surface,
        type: 'non-text',
        requirement: '11.3',
      })
    }
  }

  return pairings
}

// ─── Property test ──────────────────────────────────────────────────────────

describe('Property 5: WCAG contrast holds for every foreground/background pairing', () => {
  const css = readFileSync(TOKENS_CSS_PATH, 'utf-8')
  const colors = parseLightThemeColors(css)
  const pairings = buildPairings(colors)

  it('tokens.css yields a non-empty set of color tokens to test', () => {
    expect(colors.size).toBeGreaterThan(0)
  })

  it('every literal `on-X` token has a matching `X` token (auto-pairing convention)', () => {
    // `on-surface-muted` is a documented exception: it is a muted variant of
    // `on-surface` used on the existing surface backgrounds, not a foreground
    // for a hypothetical "surface-muted" background. It is paired with every
    // `surface*` background by the Req 2.3 block in buildPairings().
    const variantSuffixes = ['-muted', '-strong']
    const onTokens = [...colors.keys()]
      .filter((n) => n.startsWith('on-'))
      .filter((n) => !variantSuffixes.some((suffix) => n.endsWith(suffix)))

    expect(onTokens.length).toBeGreaterThan(0)
    for (const name of onTokens) {
      const bg = name.slice(3)
      expect(
        colors.has(bg),
        `Token --color-${name} has no matching --color-${bg} background. ` +
          `The "color X / on-X" naming convention requires every literal on-X token ` +
          `to pair with an X background.`,
      ).toBe(true)
    }
  })

  it('every registered foreground/background pairing references parseable opaque colors', () => {
    for (const p of pairings) {
      const fg = colors.get(p.fgName)
      const bg = colors.get(p.bgName)
      expect(fg, `Missing token --color-${p.fgName}`).toBeDefined()
      expect(bg, `Missing token --color-${p.bgName}`).toBeDefined()
      expect(
        isOpaqueColor(fg!),
        `--color-${p.fgName} ("${fg}") is not an opaque color the contrast formula can evaluate.`,
      ).toBe(true)
      expect(
        isOpaqueColor(bg!),
        `--color-${p.bgName} ("${bg}") is not an opaque color the contrast formula can evaluate.`,
      ).toBe(true)
    }
  })

  /**
   * **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 11.3**
   *
   * For any registered (fg, bg) pairing, the WCAG 2.1 contrast ratio meets:
   *   - 4.5:1 for text colors
   *   - 3.0:1 for non-text (borders, icons, focus ring)
   */
  it('every registered pairing meets its WCAG AA threshold', () => {
    expect(pairings.length).toBeGreaterThan(0)

    const pairingArb = fc.constantFrom(...pairings)

    fc.assert(
      fc.property(pairingArb, (pairing) => {
        const fg = colors.get(pairing.fgName)!
        const bg = colors.get(pairing.bgName)!
        const ratio = contrastRatio(fg, bg)
        const threshold = pairing.type === 'text' ? 4.5 : 3.0

        if (ratio < threshold) {
          throw new Error(
            `Contrast ratio ${ratio.toFixed(2)}:1 between ` +
              `--color-${pairing.fgName} (${fg}) and ` +
              `--color-${pairing.bgName} (${bg}) ` +
              `is below the WCAG AA ${threshold}:1 threshold for ${pairing.type} ` +
              `(Requirement ${pairing.requirement}).`,
          )
        }
        return true
      }),
      { numRuns: Math.max(pairings.length, 50) },
    )
  })

  it('contrast ratio computation is symmetric (order of fg/bg does not matter)', () => {
    const opaqueValues = [...colors.values()].filter(isOpaqueColor)
    const colorArb = fc.constantFrom(...opaqueValues)

    fc.assert(
      fc.property(colorArb, colorArb, (c1, c2) => {
        const r1 = contrastRatio(c1, c2)
        const r2 = contrastRatio(c2, c1)
        expect(r1).toBeCloseTo(r2, 10)
      }),
      { numRuns: 100 },
    )
  })

  it('contrast ratio is always >= 1 for any pair of valid colors', () => {
    const opaqueValues = [...colors.values()].filter(isOpaqueColor)
    const colorArb = fc.constantFrom(...opaqueValues)

    fc.assert(
      fc.property(colorArb, colorArb, (c1, c2) => {
        const ratio = contrastRatio(c1, c2)
        expect(ratio).toBeGreaterThanOrEqual(1)
      }),
      { numRuns: 100 },
    )
  })
})
