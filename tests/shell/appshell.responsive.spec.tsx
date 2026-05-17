import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **Validates: Requirements 4.7, 12.2, 12.3**
 *
 * Property 11: Desktop content width stays in the readable band
 *
 * *For any* viewport width `w >= 768px`, the `AppShell` main content
 * container's computed `max-width` is at least `640px` and at most `1042px`
 * (1040px target plus the 2px rendering tolerance allowed by Requirement
 * 4.7).
 *
 * *For any* viewport width `w < 768px`, no max-width constraint is applied
 * to main content and horizontal padding is at least `16px`.
 *
 * The Component_Library expresses both halves of the invariant through
 * Tailwind utilities on the `<main>` element in
 * `src/components/layout/AppShell.tsx`:
 *
 *   - Mobile (default, no `md:` prefix): `px-16 ...` — horizontal padding
 *     resolves through `tokens.spacing[16] = '16px'`, satisfying
 *     Requirement 12.2's "no smaller than Spacing_Scale step 16".
 *   - Desktop (`md:` prefix, active for `w >= 768px`): `md:max-w-readable
 *     md:mx-auto md:w-full ...` — the `readable` token is declared in
 *     `tailwind.config.ts` under `theme.extend.maxWidth` and resolves to a
 *     pixel value inside the [640, 1042] band, satisfying Requirements
 *     4.7 and 12.3.
 *
 * The single `md` (768px) breakpoint is the only viewport switch in the
 * file (Requirement 12.1). Rendering AppShell directly in jsdom would
 * pull in Clerk + TanStack Router providers via Sidebar/BottomNav and
 * obscure the geometric invariant we care about, so this property test
 * statically analyses the AppShell source plus the tailwind config + token
 * tables that materialise the utility classes — the same artefacts the
 * Tailwind build consumes — and proves the readable-band invariant for any
 * viewport width sampled by fast-check.
 */

const APP_SHELL_PATH = resolve(__dirname, '../../src/components/layout/AppShell.tsx')
const TAILWIND_CONFIG_PATH = resolve(__dirname, '../../tailwind.config.ts')
const TOKENS_TS_PATH = resolve(__dirname, '../../src/styles/tokens.ts')

const READABLE_MIN_PX = 640
const READABLE_MAX_PX = 1042 // 1040 target + 2px tolerance per Req 4.7
const MIN_HORIZONTAL_PADDING_PX = 16
const BREAKPOINT_PX = 768

interface MainClassNames {
  /** Classes applied without any breakpoint prefix (mobile default). */
  mobile: string[]
  /** Classes applied under the `md:` breakpoint prefix (desktop, w >= 768). */
  desktop: string[]
  /** Raw `<main>` opener slice, useful for cross-cutting checks. */
  rawOpener: string
}

/**
 * Strip block comments (`/* ... *\/`) and line comments (`// ...`) from a
 * source string so that text fragments which look like JSX (e.g. `<main>`
 * mentioned inside JSDoc) cannot be confused for the real `<main>` opener.
 */
function stripComments(source: string): string {
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlockComments.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Extract the className tokens applied to the `<main>` element in
 * AppShell.tsx. Splits desktop-prefixed (`md:*`) classes from
 * mobile-default classes so each viewport bucket can be reasoned about
 * independently.
 */
function extractMainClassNames(source: string): MainClassNames {
  const stripped = stripComments(source)
  const mainMatch = stripped.match(/<main\b([\s\S]*?)>/)
  expect(mainMatch, 'AppShell.tsx must render a <main> element').toBeTruthy()
  const openerBody = mainMatch![1]

  const cnMatch = openerBody.match(/cn\(([\s\S]*?)\)/)
  expect(cnMatch, '<main> must apply className via cn(...)').toBeTruthy()
  const cnBody = cnMatch![1]

  const tokens: string[] = []
  const stringLiteralRegex = /'([^']*)'|"([^"]*)"|`([^`]*)`/g
  let m: RegExpExecArray | null
  while ((m = stringLiteralRegex.exec(cnBody)) !== null) {
    const literal = m[1] ?? m[2] ?? m[3] ?? ''
    for (const token of literal.split(/\s+/).filter(Boolean)) {
      tokens.push(token)
    }
  }

  const mobile: string[] = []
  const desktop: string[] = []
  for (const token of tokens) {
    if (token.startsWith('md:')) {
      desktop.push(token.slice(3))
    } else {
      mobile.push(token)
    }
  }
  return { mobile, desktop, rawOpener: mainMatch![0] }
}

/**
 * Resolve `theme.extend.maxWidth.readable` from `tailwind.config.ts` to a
 * pixel value. This is the same source the Tailwind build reads when it
 * generates `max-w-readable`.
 */
function resolveReadableMaxWidthPx(): number {
  const config = readFileSync(TAILWIND_CONFIG_PATH, 'utf-8')
  const match = config.match(/maxWidth\s*:\s*\{[^}]*readable\s*:\s*'(\d+)px'/)
  expect(match, 'tailwind.config.ts must declare maxWidth.readable as a px literal').toBeTruthy()
  return parseInt(match![1], 10)
}

/**
 * Resolve a Tailwind spacing utility key (e.g. `16` from `px-16`) to a
 * pixel value by parsing the spacing scale in `src/styles/tokens.ts`.
 */
function resolveSpacingScalePx(scaleKey: string): number {
  const tokensSource = readFileSync(TOKENS_TS_PATH, 'utf-8')
  const spacingMatch = tokensSource.match(/spacing\s*:\s*\{([\s\S]*?)\}/)
  expect(spacingMatch, 'tokens.ts must declare a spacing scale').toBeTruthy()
  const body = spacingMatch![1]
  const keyRegex = new RegExp(`(?:^|[\\s,])${scaleKey}\\s*:\\s*'(\\d+)px'`, 'm')
  const valueMatch = body.match(keyRegex)
  expect(
    valueMatch,
    `spacing scale must declare key ${scaleKey} (referenced by px-${scaleKey})`,
  ).toBeTruthy()
  return parseInt(valueMatch![1], 10)
}

const SOURCE = readFileSync(APP_SHELL_PATH, 'utf-8')
const CLASSES = extractMainClassNames(SOURCE)
const READABLE_MAX_PX_RESOLVED = resolveReadableMaxWidthPx()

describe('Property 11: Desktop content width stays in the readable band', () => {
  it('the readable max-width token resolves to a value inside [640px, 1042px]', () => {
    // Requirement 4.7: max-width >= 640 and <= 1040 (+2px rendering tolerance).
    expect(READABLE_MAX_PX_RESOLVED).toBeGreaterThanOrEqual(READABLE_MIN_PX)
    expect(READABLE_MAX_PX_RESOLVED).toBeLessThanOrEqual(READABLE_MAX_PX)
  })

  it('the desktop bucket applies max-w-readable to cap the column at the token', () => {
    // Requirement 12.3: on viewports >= 768px, AppShell centers the main
    // content within the readable-width bounds declared in Requirement 4.7.
    expect(CLASSES.desktop).toContain('max-w-readable')
    // Centering is part of "centers the main content column" in Req 12.3.
    expect(CLASSES.desktop).toContain('mx-auto')
  })

  it('the mobile bucket applies no max-width constraint', () => {
    // Requirement 4.7: on viewports narrower than 768px, the UI_Shell SHALL
    // NOT apply the maximum-width constraint.
    const mobileMaxWidth = CLASSES.mobile.find((c) => c.startsWith('max-w-'))
    expect(
      mobileMaxWidth,
      `mobile path must not cap the column width but found "${mobileMaxWidth}"`,
    ).toBeUndefined()
  })

  it('the mobile bucket applies horizontal padding of at least 16px', () => {
    // Requirement 12.2: on viewports < 768px, horizontal padding no smaller
    // than Spacing_Scale step 16.
    const pxClass = CLASSES.mobile.find((c) => /^px-\d+$/.test(c))
    expect(pxClass, 'mobile path must declare horizontal padding via px-*').toBeTruthy()
    const scaleKey = pxClass!.slice(3)
    const padPx = resolveSpacingScalePx(scaleKey)
    expect(padPx).toBeGreaterThanOrEqual(MIN_HORIZONTAL_PADDING_PX)
  })

  it('the <main> element uses no breakpoint other than md (single-breakpoint constraint)', () => {
    // Requirement 12.1: a single 768px breakpoint. Sanity-check that no
    // other Tailwind breakpoint (sm/lg/xl/2xl) leaks into the main shell.
    expect(CLASSES.rawOpener).not.toMatch(/\b(sm|lg|xl|2xl):/)
  })

  it('for any viewport width w in [320, 2400], the readable-band invariant holds', () => {
    // The property:
    //   - w >= 768  ⇒  max-w-readable is active AND its resolved px value
    //                  lies in [640, 1042]
    //   - w <  768  ⇒  no max-width is applied AND horizontal padding >= 16
    fc.assert(
      fc.property(
        fc.integer({ min: 320, max: 2400 }),
        (w) => {
          if (w >= BREAKPOINT_PX) {
            expect(CLASSES.desktop).toContain('max-w-readable')
            expect(READABLE_MAX_PX_RESOLVED).toBeGreaterThanOrEqual(READABLE_MIN_PX)
            expect(READABLE_MAX_PX_RESOLVED).toBeLessThanOrEqual(READABLE_MAX_PX)
          } else {
            const mobileMaxWidth = CLASSES.mobile.find((c) => c.startsWith('max-w-'))
            expect(mobileMaxWidth).toBeUndefined()

            const pxClass = CLASSES.mobile.find((c) => /^px-\d+$/.test(c))
            expect(pxClass).toBeTruthy()
            const padPx = resolveSpacingScalePx(pxClass!.slice(3))
            expect(padPx).toBeGreaterThanOrEqual(MIN_HORIZONTAL_PADDING_PX)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('crossing the 768px breakpoint flips between the mobile and desktop class buckets without overlap', () => {
    // The desktop bucket and mobile bucket must be consistent: max-w-readable
    // appears only in the desktop bucket (md:*), confirming the readable-band
    // cap activates exactly at the single 768px breakpoint.
    expect(CLASSES.mobile).not.toContain('max-w-readable')
    expect(CLASSES.desktop).toContain('max-w-readable')

    // The desktop padding must also be at least 16px so the readable-band
    // requirement is preserved when the desktop bucket overrides mobile.
    const desktopPxClass = CLASSES.desktop.find((c) => /^px-\d+$/.test(c))
    if (desktopPxClass) {
      const desktopPadPx = resolveSpacingScalePx(desktopPxClass.slice(3))
      expect(desktopPadPx).toBeGreaterThanOrEqual(MIN_HORIZONTAL_PADDING_PX)
    }
  })
})

/**
 * **Validates: Requirements 12.1, 12.3, 12.4, 12.6, 16.6**
 *
 * Property 24: Single breakpoint and fluid layout
 *
 * *For any* run of the build, `tailwind.config.ts → theme.screens`
 * deep-equals `{ md: '768px' }` — there is exactly one Tailwind breakpoint
 * and it sits at 768px (Requirements 12.1, 16.6).
 *
 * *For any* Tailwind default breakpoint other than `md` (i.e. `sm`, `lg`,
 * `xl`, `2xl`), `AppShell.tsx` contains zero occurrences of that prefix in
 * a non-comment context — the shell never sneaks in a second breakpoint
 * (Requirements 12.1, 16.6).
 *
 * *For any* viewport width `w` sampled from `[360, 1440]`, the bucket of
 * Tailwind utilities that resolves at width `w` is fluid:
 *
 *   - `w < 768`   → mobile bucket has no fixed-pixel `w-*` class. The
 *                   column tracks the viewport via `flex-1` + `min-w-0`
 *                   (Requirements 12.2, 12.4).
 *   - `w >= 768`  → desktop bucket applies `w-full` underneath
 *                   `max-w-readable`; the column expands fluidly up to the
 *                   readable cap (Requirements 12.3, 12.4).
 *
 * The `<main>` element is shared between buckets — `useMediaQuery` flips
 * `isDesktop` and the same `<main>` is rendered before and after the
 * crossover, so focus and DOM identity inside the main region are
 * preserved across the transition (Requirement 12.6). The query string
 * passed to `useMediaQuery` MUST be exactly `(min-width: 768px)` so this
 * static check matches the runtime behaviour (Requirements 12.1, 12.6).
 *
 * Token-driven theme tracking (`bg-surface text-on-surface`) is asserted
 * against the outer container so that surface and foreground roles flow
 * through the active `[data-theme]` (Requirement 16.6).
 *
 * As with Property 11, rendering the real AppShell in jsdom would drag in
 * Clerk + TanStack Router providers via Sidebar/BottomNav and obscure the
 * geometric invariant. We instead statically analyse the same artefacts the
 * Tailwind build consumes — `tailwind.config.ts` and `AppShell.tsx` — and
 * prove the breakpoint/fluid invariant for any viewport width sampled by
 * fast-check.
 */

const FORBIDDEN_BREAKPOINTS = ['sm', 'lg', 'xl', '2xl'] as const

/**
 * Match a Tailwind utility that pins width to a fixed pixel value:
 *
 *   - `w-{N}`        → resolves through the spacing scale to `Npx`
 *   - `w-[<value>]`  → arbitrary literal width (Tailwind JIT)
 *   - `w-screen`     → 100vw, breaks fluid layout on narrow viewports
 *
 * Fluid forms (`w-full`, `w-auto`, `w-fit`, `w-min`, `w-max`) are
 * intentionally not matched.
 */
const FIXED_WIDTH_RE = /^w-(\d+|\[[^\]]+\]|screen)$/

interface ScreenEntry {
  key: string
  value: string
}

/**
 * Resolve `theme.screens` from `tailwind.config.ts` into an ordered list of
 * `(key, value)` entries. The Tailwind build reads this same map; if the
 * map contains anything other than `{ md: '768px' }` the design system
 * gains a second breakpoint that Requirements 12.1 and 16.6 forbid.
 */
function resolveScreens(): ScreenEntry[] {
  const config = readFileSync(TAILWIND_CONFIG_PATH, 'utf-8')
  const screensMatch = config.match(/screens\s*:\s*\{([\s\S]*?)\}/)
  expect(screensMatch, 'tailwind.config.ts must declare a theme.screens map').toBeTruthy()
  const body = screensMatch![1]

  const entries: ScreenEntry[] = []
  const entryRegex = /(\w+)\s*:\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(body)) !== null) {
    entries.push({ key: m[1], value: m[2] })
  }
  return entries
}

const SCREENS = resolveScreens()
const STRIPPED_SOURCE = stripComments(SOURCE)

describe('Property 24: Single breakpoint and fluid layout', () => {
  it('tailwind.config.ts theme.screens deep-equals { md: "768px" }', () => {
    // Requirements 12.1, 16.6: a single 768px breakpoint, no others.
    expect(SCREENS).toEqual([{ key: 'md', value: '768px' }])
  })

  it('AppShell.tsx contains zero non-comment occurrences of any breakpoint other than md', () => {
    // Requirements 12.1, 16.6.
    for (const bp of FORBIDDEN_BREAKPOINTS) {
      const re = new RegExp(`\\b${bp}:`)
      expect(
        STRIPPED_SOURCE,
        `AppShell.tsx must not use the ${bp}: breakpoint prefix`,
      ).not.toMatch(re)
    }
  })

  it('the mobile bucket on <main> applies no fixed-pixel width', () => {
    // Requirement 12.4: fluid, intrinsic layouts. Reject any `w-*` utility
    // that pins the column to a fixed pixel value; allow fluid forms or no
    // width class at all (the column then tracks `flex-1`).
    const offenders = CLASSES.mobile.filter((c) => FIXED_WIDTH_RE.test(c))
    expect(
      offenders,
      `mobile bucket must use fluid widths but found: [${offenders.join(', ')}]`,
    ).toEqual([])
  })

  it('the desktop bucket on <main> uses fluid width capped by max-w-readable', () => {
    // Requirements 12.3, 12.4: ≥ 768px viewports center the column inside
    // the readable band. `w-full` keeps the column fluid below the cap;
    // `max-w-readable` enforces the cap above it.
    expect(CLASSES.desktop).toContain('w-full')
    expect(CLASSES.desktop).toContain('max-w-readable')
    const desktopFixedWidth = CLASSES.desktop.find((c) => FIXED_WIDTH_RE.test(c))
    expect(
      desktopFixedWidth,
      `desktop bucket must use fluid widths but found "${desktopFixedWidth}"`,
    ).toBeUndefined()
  })

  it('useMediaQuery is called with the single (min-width: 768px) media query', () => {
    // Requirements 12.1, 12.6: AppShell uses ONE media query to swap nav
    // chrome. This is the runtime expression of the single 768px breakpoint
    // declared by `theme.screens`.
    const queryMatch = STRIPPED_SOURCE.match(/useMediaQuery\(\s*['"]([^'"]+)['"]/)
    expect(queryMatch, 'AppShell.tsx must call useMediaQuery with a media query string').toBeTruthy()
    expect(queryMatch![1]).toBe('(min-width: 768px)')
  })

  it('the outer shell tracks the active [data-theme] via role tokens', () => {
    // Requirement 16.6: the redesign MUST NOT introduce new breakpoints
    // beyond `md`, AND the surface MUST track the active theme through
    // role tokens so a future second theme can be added without refactor.
    // The shell's outer container is the canonical theme-tracked surface.
    expect(SOURCE).toMatch(/bg-surface\b/)
    expect(SOURCE).toMatch(/text-on-surface\b/)
  })

  it('a single <main> element is rendered, so crossing the breakpoint never unmounts the content region', () => {
    // Requirement 12.6: when the viewport crosses 768px during a session,
    // AppShell re-renders nav chrome WITHOUT requiring a page reload. The
    // single shared <main> is what makes that possible — the conditional
    // sits on Sidebar/BottomNav siblings, not on <main>.
    const mainOpenerCount = STRIPPED_SOURCE.match(/<main\b/g)?.length ?? 0
    expect(mainOpenerCount).toBe(1)
    // No conditional braces or ternary surrounding the <main> opener.
    expect(SOURCE).not.toMatch(/\{[^{}]*<main\b/)
  })

  it('for any forbidden Tailwind breakpoint, AppShell.tsx contains zero occurrences (property test)', () => {
    // Property: ∀ bp ∈ {sm, lg, xl, 2xl}: stripped(AppShell.tsx) has no
    // `${bp}:` prefix. fast-check enumerates the forbidden set so the
    // assertion holds for any breakpoint generator value.
    fc.assert(
      fc.property(
        fc.constantFrom(...FORBIDDEN_BREAKPOINTS),
        (bp) => {
          const re = new RegExp(`\\b${bp}:`)
          expect(STRIPPED_SOURCE).not.toMatch(re)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('for any viewport width w in [360, 1440], the active class bucket is fluid (property test)', () => {
    // Property: ∀ w ∈ [360, 1440]:
    //   - w <  768: mobile bucket has no fixed-pixel `w-*` class
    //   - w >= 768: desktop bucket applies `w-full` AND `max-w-readable`
    //               and itself contains no fixed-pixel `w-*` class.
    // Together this means horizontal layout never pins to a width that
    // exceeds a viewport in the sampled range, so the document does not
    // overflow horizontally (the runtime form of Requirements 12.4, 12.6).
    fc.assert(
      fc.property(
        fc.integer({ min: 360, max: 1440 }),
        (w) => {
          if (w < BREAKPOINT_PX) {
            const fixed = CLASSES.mobile.find((c) => FIXED_WIDTH_RE.test(c))
            expect(fixed).toBeUndefined()
          } else {
            expect(CLASSES.desktop).toContain('w-full')
            expect(CLASSES.desktop).toContain('max-w-readable')
            const fixed = CLASSES.desktop.find((c) => FIXED_WIDTH_RE.test(c))
            expect(fixed).toBeUndefined()
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
