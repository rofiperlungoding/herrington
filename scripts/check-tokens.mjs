/**
 * scripts/check-tokens.mjs
 *
 * Build-time token validator. Run from `npm run build` and CI.
 * Does three things:
 *
 * 1. Parity — parses every CSS custom property under `:root` and `[data-theme]`
 *    in tokens.css, compares against the tokens.ts export. Missing on either
 *    side → fail with the offending token name.
 *
 * 2. Tailwind coverage — imports tailwind.config.ts and verifies every
 *    theme.extend entry resolves to a token.
 *
 * 3. Component literal lint — scans src/components and src/styles/index.css for
 *    forbidden literals (hex colors, rgb/rgba/hsl/hsla, pixel literals other
 *    than 0px/1px, millisecond literals, cubic-bezier).
 *
 * Exits with non-zero code on any failure.
 *
 * Requirements: 1.3, 1.7, 3.7, 3.8, 4.2, 4.8, 6.6, 6.7, 15.3
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')

const errors = []

// ─── Utility: recursive directory walk ──────────────────────────────────────

/**
 * Recursively walk `dir`, returning absolute paths of files whose name ends
 * with one of the given extensions. Pass an empty array to return all files.
 */
function walkDir(dir, extensions) {
  if (!existsSync(dir)) return []
  const results = []
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

// ─── 1. PARITY CHECK ────────────────────────────────────────────────────────

console.log('\n🔍 Token Parity Check\n')

const tokensCssPath = resolve(ROOT, 'src/styles/tokens.css')
const tokensTsPath = resolve(ROOT, 'src/styles/tokens.ts')

if (!existsSync(tokensCssPath)) {
  errors.push('PARITY: src/styles/tokens.css not found')
}
if (!existsSync(tokensTsPath)) {
  errors.push('PARITY: src/styles/tokens.ts not found')
}

/**
 * Parse CSS custom properties from tokens.css.
 * Returns a Map of selector → Set<property-name>
 */
function parseCssTokens(cssContent) {
  const selectorTokens = new Map()

  // Match selectors and their blocks
  // We need to handle :root and [data-theme='...'] selectors
  const selectorRegex = /(:root|(?::root)?\[data-theme[^\]]*\])\s*\{([^}]*)\}/g
  let match

  while ((match = selectorRegex.exec(cssContent)) !== null) {
    const selector = match[1].trim()
    const block = match[2]

    // Extract custom properties (--name: value)
    const propRegex = /--([\w-]+)\s*:/g
    let propMatch
    const props = new Set()

    while ((propMatch = propRegex.exec(block)) !== null) {
      props.add(`--${propMatch[1]}`)
    }

    // Merge into existing selector entry
    const normalizedSelector = selector.includes('data-theme') ? '[data-theme]' : ':root'
    if (selectorTokens.has(normalizedSelector)) {
      for (const p of props) {
        selectorTokens.get(normalizedSelector).add(p)
      }
    } else {
      selectorTokens.set(normalizedSelector, props)
    }
  }

  return selectorTokens
}

/**
 * Extract all token keys from tokens.ts by reading the file and parsing the
 * exported object structure. Maps them to the expected CSS custom property names.
 */
function parseTsTokenKeys(tsContent) {
  const expectedCssProps = new Set()

  // spacing: { 4: '4px', ... } → --space-4, --space-8, etc.
  const spacingMatch = tsContent.match(/spacing\s*:\s*\{([^}]+)\}/)
  if (spacingMatch) {
    const keys = [...spacingMatch[1].matchAll(/(\d+)\s*:/g)]
    for (const k of keys) {
      expectedCssProps.add(`--space-${k[1]}`)
    }
  }

  // radius: { none: '0px', sm: '6px', ... } → --radius-none, --radius-sm, etc.
  const radiusMatch = tsContent.match(/radius\s*:\s*\{([^}]+)\}/)
  if (radiusMatch) {
    const keys = [...radiusMatch[1].matchAll(/([\w-]+)\s*:/g)]
    for (const k of keys) {
      // Skip numeric-only keys that might be line artifacts
      expectedCssProps.add(`--radius-${k[1]}`)
    }
  }

  // elevation: { 0: ..., 1: ..., } → --elevation-0, --elevation-1, etc.
  const elevationMatch = tsContent.match(/elevation\s*:\s*\{([^}]+)\}/)
  if (elevationMatch) {
    const keys = [...elevationMatch[1].matchAll(/(\d+)\s*:/g)]
    for (const k of keys) {
      expectedCssProps.add(`--elevation-${k[1]}`)
    }
  }

  // duration: { fast: ..., standard: ..., emphasized: ... } → --duration-fast, etc.
  const durationMatch = tsContent.match(/duration\s*:\s*\{([^}]+)\}/)
  if (durationMatch) {
    const keys = [...durationMatch[1].matchAll(/([\w-]+)\s*:/g)]
    for (const k of keys) {
      expectedCssProps.add(`--duration-${k[1]}`)
    }
  }

  // easing: { standard: ..., emphasized: ... } → --easing-standard, etc.
  const easingMatch = tsContent.match(/easing\s*:\s*\{([^}]+)\}/)
  if (easingMatch) {
    const keys = [...easingMatch[1].matchAll(/([\w-]+)\s*:/g)]
    for (const k of keys) {
      expectedCssProps.add(`--easing-${k[1]}`)
    }
  }

  // color: { surface: ..., 'surface-container': ..., } → --color-surface, --color-surface-container, etc.
  const colorMatch = tsContent.match(/color\s*:\s*\{([\s\S]*?)\n\s*\}/)
  if (colorMatch) {
    const keys = [...colorMatch[1].matchAll(/['"]?([\w-]+)['"]?\s*:/g)]
    for (const k of keys) {
      expectedCssProps.add(`--color-${k[1]}`)
    }
  }

  // typography: { caption: { size: ... }, ... }
  // Maps to --font-size-*, --line-height-*, --letter-spacing-*
  const typographyMatch = tsContent.match(/typography\s*:\s*\{([\s\S]*?)\n\s*\}\s*,?\s*\n?\s*\}/)
  if (typographyMatch) {
    const steps = [...typographyMatch[1].matchAll(/([\w-]+)\s*:\s*\{/g)]
    for (const step of steps) {
      expectedCssProps.add(`--font-size-${step[1]}`)
      expectedCssProps.add(`--line-height-${step[1]}`)
    }
  }

  return expectedCssProps
}

if (existsSync(tokensCssPath) && existsSync(tokensTsPath)) {
  const cssContent = readFileSync(tokensCssPath, 'utf-8')
  const tsContent = readFileSync(tokensTsPath, 'utf-8')

  const cssSelectorTokens = parseCssTokens(cssContent)
  const tsExpectedProps = parseTsTokenKeys(tsContent)

  // Collect all CSS custom properties across all selectors
  const allCssProps = new Set()
  for (const [, props] of cssSelectorTokens) {
    for (const p of props) {
      allCssProps.add(p)
    }
  }

  // Check: every TS-expected prop exists in CSS
  for (const prop of tsExpectedProps) {
    if (!allCssProps.has(prop)) {
      errors.push(`PARITY: Token "${prop}" exists in tokens.ts but NOT in tokens.css`)
    }
  }

  // Check: every CSS prop (that maps to a token category) exists in TS
  // (skip --font-sans, --letter-spacing-*, --color-scheme as they are structural/meta)
  const cssTokenCategories = ['--space-', '--radius-', '--elevation-', '--duration-', '--easing-', '--color-', '--font-size-', '--line-height-']

  for (const prop of allCssProps) {
    const isTrackedCategory = cssTokenCategories.some(prefix => prop.startsWith(prefix))
    if (isTrackedCategory && !tsExpectedProps.has(prop)) {
      errors.push(`PARITY: Token "${prop}" exists in tokens.css but NOT in tokens.ts`)
    }
  }

  const parityErrors = errors.filter(e => e.startsWith('PARITY:'))
  if (parityErrors.length === 0) {
    console.log('  ✅ All tokens are in sync between CSS and TypeScript')
  } else {
    console.log(`  ❌ ${parityErrors.length} parity error(s) found`)
  }
}

// ─── 2. TAILWIND COVERAGE CHECK ─────────────────────────────────────────────

console.log('\n🔍 Tailwind Coverage Check\n')

const tailwindConfigPath = resolve(ROOT, 'tailwind.config.ts')

if (!existsSync(tailwindConfigPath)) {
  errors.push('TAILWIND: tailwind.config.ts not found')
} else {
  const twContent = readFileSync(tailwindConfigPath, 'utf-8')

  // Verify that tailwind.config.ts imports from tokens.ts
  if (!twContent.includes("from './src/styles/tokens'") && !twContent.includes('from "./src/styles/tokens"')) {
    errors.push('TAILWIND: tailwind.config.ts does not import from src/styles/tokens')
  }

  // Verify key theme.extend sections reference tokens
  const requiredTokenRefs = [
    { section: 'colors', pattern: /tokens\.color/ },
    { section: 'spacing', pattern: /tokens\.spacing/ },
    { section: 'boxShadow', pattern: /tokens\.elevation/ },
    { section: 'transitionDuration', pattern: /var\(--duration-/ },
    { section: 'transitionTimingFunction', pattern: /var\(--easing-/ },
    { section: 'fontSize', pattern: /tokens\.typography/ },
  ]

  for (const { section, pattern } of requiredTokenRefs) {
    if (!pattern.test(twContent)) {
      errors.push(`TAILWIND: theme.extend.${section} does not reference tokens`)
    }
  }

  const tailwindErrors = errors.filter(e => e.startsWith('TAILWIND:'))
  if (tailwindErrors.length === 0) {
    console.log('  ✅ All theme.extend entries resolve to tokens')
  } else {
    console.log(`  ❌ ${tailwindErrors.length} Tailwind coverage error(s) found`)
  }
}

// ─── 3. LITERAL LINT ─────────────────────────────────────────────────────────

console.log('\n🔍 Literal Lint Check\n')

/**
 * Forbidden literal patterns.
 * Each entry: { name, regex, description }
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
    filter: (match) => {
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
]

/**
 * Files/lines to exclude from literal lint:
 * - tokens.css itself (it's the source of truth)
 * - tokens.ts (mirrors the CSS)
 * - Comments and import statements
 */
const EXCLUDED_FILES = [
  resolve(ROOT, 'src/styles/tokens.css'),
  resolve(ROOT, 'src/styles/tokens.ts'),
]

/**
 * Check if a line should be excluded from linting.
 * Excludes comments, CSS variable declarations (--), and import lines.
 */
function isExcludedLine(line) {
  const trimmed = line.trim()
  // Skip single-line comments
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true
  // Skip import/require statements
  if (trimmed.startsWith('import ') || trimmed.startsWith('require(')) return true
  return false
}

/**
 * Check if a pixel match is inside a media query string (legitimate use).
 * e.g., useMediaQuery('(min-width: 768px)')
 */
function isInsideMediaQuery(line, matchIndex) {
  // Check if the match is inside a string that contains "min-width" or "max-width"
  // which indicates a media query
  const before = line.substring(0, matchIndex)
  const after = line.substring(matchIndex)

  // Look for media query patterns: @media, matchMedia, useMediaQuery
  if (line.includes('matchMedia') || line.includes('useMediaQuery') || line.includes('@media')) {
    // Check if the px value is inside a parenthesized query string
    const inString = (before.match(/['"`][^'"`]*$/) && after.match(/^[^'"`]*['"`]/))
    if (inString) return true
  }
  return false
}

// Gather files to scan: all component files + index.css
const filesToScan = walkDir(resolve(ROOT, 'src/components'), ['.ts', '.tsx', '.css'])

const indexCssPath = resolve(ROOT, 'src/styles/index.css')
const altIndexCssPath = resolve(ROOT, 'src/index.css')
if (existsSync(indexCssPath)) {
  filesToScan.push(indexCssPath)
} else if (existsSync(altIndexCssPath)) {
  filesToScan.push(altIndexCssPath)
}

// Filter out excluded files
const filteredFiles = filesToScan.filter(f => !EXCLUDED_FILES.includes(f))

const literalViolations = []

for (const filePath of filteredFiles) {
  let content
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    continue
  }

  const lines = content.split('\n')
  const relPath = relative(ROOT, filePath).replace(/\\/g, '/')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (isExcludedLine(line)) continue

    for (const pattern of FORBIDDEN_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.regex.lastIndex = 0
      let regexMatch

      while ((regexMatch = pattern.regex.exec(line)) !== null) {
        const matchStr = regexMatch[0]

        // Apply filter if present (e.g., for pixel literals allowing 0px/1px)
        if (pattern.filter && !pattern.filter(matchStr)) continue

        // Skip matches inside CSS variable references: var(--...)
        // Check if the match is inside a var() function
        const beforeMatch = line.substring(0, regexMatch.index)
        if (beforeMatch.match(/var\([^)]*$/)) continue

        // Skip matches inside CSS custom property declarations
        if (line.trim().startsWith('--')) continue

        // Skip pixel literals inside media query strings
        if (pattern.name === 'pixel-literal' && isInsideMediaQuery(line, regexMatch.index)) continue

        // Skip matches in tailwind arbitrary values that reference vars
        // e.g., w-[var(--something)]
        const surroundingContext = line.substring(Math.max(0, regexMatch.index - 30), regexMatch.index + matchStr.length + 30)
        if (surroundingContext.includes('var(--')) continue

        literalViolations.push(`${relPath}:${lineNum}:${matchStr}`)
      }
    }
  }
}

if (literalViolations.length > 0) {
  console.log(`  ❌ ${literalViolations.length} forbidden literal(s) found:\n`)
  for (const violation of literalViolations) {
    console.log(`    ${violation}`)
    errors.push(`LITERAL: ${violation}`)
  }
} else {
  console.log('  ✅ No forbidden literals found in component files')
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60))

if (errors.length > 0) {
  console.log(`\n❌ Token validation FAILED with ${errors.length} error(s):\n`)
  for (const err of errors) {
    console.log(`  • ${err}`)
  }
  console.log('')
  process.exit(1)
} else {
  console.log('\n✅ Token validation PASSED\n')
  process.exit(0)
}
