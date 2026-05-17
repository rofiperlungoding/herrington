import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Validates: Requirements 15.2
 * - Exactly one [data-theme] block in tokens.css
 * - index.html declares data-theme="light"
 */
describe('Theme ships one', () => {
  it('tokens.css contains exactly one base [data-theme] block', () => {
    const tokensCssRaw = readFileSync(
      resolve(__dirname, '../../src/styles/tokens.css'),
      'utf-8',
    )

    // Strip CSS block comments so prose like "the [data-theme='light']{...}
    // block" inside JSDoc-style explanations doesn't get picked up by the
    // selector regex below.
    const tokensCss = tokensCssRaw.replace(/\/\*[\s\S]*?\*\//g, '')

    // Match all [data-theme=...] selectors. We count selectors that
    // contain ONLY a [data-theme=...] attribute (the base theme block).
    // Compound selectors that combine [data-theme=...] with another
    // attribute would be layered overrides, not standalone themes —
    // they don't count.
    const allMatches =
      tokensCss.match(
        /[^\s,{]*\[data-theme=['"][^'"]+['"]\][^\s,{]*\s*\{/g,
      ) ?? []
    const baseThemeBlocks = allMatches.filter((sel) => {
      const cleaned = sel.replace(/\s*\{$/, '').trim()
      const attrMatches = cleaned.match(/\[[^\]]+\]/g) ?? []
      return attrMatches.length === 1
    })

    expect(allMatches.length).toBeGreaterThan(0)
    expect(baseThemeBlocks.length).toBe(1)
  })

  it('index.html declares data-theme="light"', () => {
    const indexHtml = readFileSync(
      resolve(__dirname, '../../index.html'),
      'utf-8',
    )

    // The html element should have data-theme="light"
    expect(indexHtml).toMatch(/data-theme=["']light["']/)
  })
})
