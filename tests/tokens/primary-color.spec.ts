import { describe, it, expect } from 'vitest'
import { tokens } from '@/styles/tokens'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Validates: Requirements 2.2
 * The primary color token references the CSS variable and resolves to #1a73e8.
 */
describe('Primary color token', () => {
  it('tokens.color.primary equals var(--color-primary)', () => {
    expect(tokens.color.primary).toBe('var(--color-primary)')
  })

  it('--color-primary resolves to #1a73e8 in the light theme', () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../src/styles/tokens.css'),
      'utf-8',
    )

    // Extract the value of --color-primary from the color :root block
    const themeBlock = tokensCss.match(
      /\/\* ── Color tokens: scoped per theme ─────────────────────── \*\/\s*:root\s*\{([^}]+)\}/s,
    )
    expect(themeBlock).not.toBeNull()

    const primaryMatch = themeBlock![1].match(
      /--color-primary:\s*([^;]+);/,
    )
    expect(primaryMatch).not.toBeNull()

    const value = primaryMatch![1].trim()
    expect(value).toBe('#1a73e8')
  })
})
