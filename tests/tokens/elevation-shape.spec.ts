import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Validates: Requirements 5.2, 5.3, 5.4
 * - elevation[0] = 'none'
 * - elevation[1] blur ≤ 4px
 * - elevation[3] blur ≥ 10px
 */
describe('Elevation shape tokens', () => {
  const tokensCss = readFileSync(
    resolve(__dirname, '../../src/styles/tokens.css'),
    'utf-8',
  )

  function getElevationValue(level: number): string {
    const regex = new RegExp(`--elevation-${level}:\\s*([^;]+);`, 's')
    const match = tokensCss.match(regex)
    expect(match).not.toBeNull()
    return match![1].trim()
  }

  /**
   * Extract all blur-radius values from a composite box-shadow string.
   * box-shadow format: offset-x offset-y blur-radius spread-radius color
   * Each shadow layer has the blur as the 3rd numeric value.
   */
  function extractBlurValues(shadow: string): number[] {
    const blurs: number[] = []
    // Split on commas that separate shadow layers (but not commas inside rgb())
    const layers = shadow.split(/,(?![^(]*\))/)
    for (const layer of layers) {
      // Match numeric values (possibly negative) with px units or bare numbers
      const nums = layer.trim().match(/-?\d+(\.\d+)?/g)
      if (nums && nums.length >= 3) {
        // 3rd numeric value is the blur radius
        blurs.push(parseFloat(nums[2]))
      }
    }
    return blurs
  }

  it('elevation-0 is "none" (Req 5.2)', () => {
    const value = getElevationValue(0)
    expect(value).toBe('none')
  })

  it('elevation-1 has blur ≤ 4px (Req 5.3)', () => {
    const value = getElevationValue(1)
    const blurs = extractBlurValues(value)
    expect(blurs.length).toBeGreaterThan(0)
    for (const blur of blurs) {
      expect(blur).toBeLessThanOrEqual(4)
    }
  })

  it('elevation-3 has blur ≥ 10px (Req 5.4)', () => {
    const value = getElevationValue(3)
    const blurs = extractBlurValues(value)
    expect(blurs.length).toBeGreaterThan(0)
    // At least one blur layer must be ≥ 10px
    const maxBlur = Math.max(...blurs)
    expect(maxBlur).toBeGreaterThanOrEqual(10)
  })
})
