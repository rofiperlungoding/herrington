import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Validates: Requirements 3.1
 * The font-family begins with Inter and falls through the system stack.
 */
describe('Font stack', () => {
  it('--font-sans begins with Inter', () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../src/styles/tokens.css'),
      'utf-8',
    )

    const fontMatch = tokensCss.match(/--font-sans:\s*([^;]+);/s)
    expect(fontMatch).not.toBeNull()

    const fontValue = fontMatch![1].replace(/\s+/g, ' ').trim()
    // The font stack must start with 'Inter'
    expect(fontValue).toMatch(/^'Inter'/)
  })

  it('font stack includes system-ui fallback', () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../src/styles/tokens.css'),
      'utf-8',
    )

    const fontMatch = tokensCss.match(/--font-sans:\s*([^;]+);/s)
    expect(fontMatch).not.toBeNull()

    const fontValue = fontMatch![1].replace(/\s+/g, ' ').trim()
    expect(fontValue).toContain('system-ui')
  })

  it('font stack includes -apple-system fallback', () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../src/styles/tokens.css'),
      'utf-8',
    )

    const fontMatch = tokensCss.match(/--font-sans:\s*([^;]+);/s)
    expect(fontMatch).not.toBeNull()

    const fontValue = fontMatch![1].replace(/\s+/g, ' ').trim()
    expect(fontValue).toContain('-apple-system')
  })

  it('font stack ends with sans-serif', () => {
    const tokensCss = readFileSync(
      resolve(__dirname, '../../src/styles/tokens.css'),
      'utf-8',
    )

    const fontMatch = tokensCss.match(/--font-sans:\s*([^;]+);/s)
    expect(fontMatch).not.toBeNull()

    const fontValue = fontMatch![1].replace(/\s+/g, ' ').trim()
    expect(fontValue).toMatch(/sans-serif$/)
  })
})
