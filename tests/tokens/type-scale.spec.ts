import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { tokens } from '../../src/styles/tokens'

// Feature: ui-redesign-google-style, Property 7: Type_Scale is well-formed

/**
 * **Validates: Requirements 3.2, 3.3, 3.9**
 *
 * Property 7: Type_Scale is well-formed
 *
 * For any named step in `tokens.typography` (`caption`, `label`, `body`, `title`,
 * `headline`, `display`), the step declares a `size`, `weight`, `lineHeight`, and
 * `tracking`; the numeric `lineHeight` is in the closed range [1.2, 1.6]; and the
 * `body` step's `size` resolves to at least 14px at a 16px root.
 */

const EXPECTED_STEPS = ['caption', 'label', 'body', 'title', 'headline', 'display'] as const
type StepName = (typeof EXPECTED_STEPS)[number]

/** Convert a rem or px size string to pixels (assuming 16px root) */
function resolveToPx(size: string): number {
  const remMatch = size.match(/^([\d.]+)rem$/)
  if (remMatch) {
    return parseFloat(remMatch[1]) * 16
  }
  const pxMatch = size.match(/^([\d.]+)px$/)
  if (pxMatch) {
    return parseFloat(pxMatch[1])
  }
  throw new Error(`Cannot resolve size "${size}" to pixels`)
}

describe('Property 7: Type_Scale is well-formed', () => {
  const typographySteps = Object.entries(tokens.typography) as [StepName, typeof tokens.typography[StepName]][]

  it('tokens.typography defines all required steps', () => {
    for (const step of EXPECTED_STEPS) {
      expect(tokens.typography).toHaveProperty(step)
    }
  })

  it('every type scale step declares size, weight, lineHeight, and tracking', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...typographySteps),
        ([stepName, step]) => {
          if (typeof step.size !== 'string' || step.size.length === 0) {
            throw new Error(
              `Type scale step "${stepName}" is missing or has an empty "size" declaration. ` +
              `Requirement 3.2 mandates font-size for each step.`
            )
          }
          if (typeof step.weight !== 'number') {
            throw new Error(
              `Type scale step "${stepName}" is missing a numeric "weight" declaration. ` +
              `Requirement 3.2 mandates font-weight for each step.`
            )
          }
          if (typeof step.lineHeight !== 'string' || step.lineHeight.length === 0) {
            throw new Error(
              `Type scale step "${stepName}" is missing or has an empty "lineHeight" declaration. ` +
              `Requirement 3.2 mandates line-height for each step.`
            )
          }
          if (typeof step.tracking !== 'string') {
            throw new Error(
              `Type scale step "${stepName}" is missing a "tracking" (letter-spacing) declaration. ` +
              `Requirement 3.2 mandates letter-spacing for each step.`
            )
          }
          return true
        }
      ),
      { numRuns: typographySteps.length }
    )
  })

  it('every type scale step has a lineHeight in the range [1.2, 1.6]', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...typographySteps),
        ([stepName, step]) => {
          const lh = parseFloat(step.lineHeight)
          if (Number.isNaN(lh)) {
            throw new Error(
              `Type scale step "${stepName}" has a non-numeric lineHeight: "${step.lineHeight}". ` +
              `Requirement 3.3 requires a unitless ratio between 1.2 and 1.6.`
            )
          }
          if (lh < 1.2 || lh > 1.6) {
            throw new Error(
              `Type scale step "${stepName}" has lineHeight ${lh}, which is outside the ` +
              `allowed range [1.2, 1.6]. Requirement 3.3 mandates line-height as a unitless ` +
              `ratio between 1.2 and 1.6.`
            )
          }
          return true
        }
      ),
      { numRuns: typographySteps.length }
    )
  })

  it('font sizes are monotonically increasing across the scale', () => {
    const orderedSteps: StepName[] = ['caption', 'label', 'body', 'title', 'headline', 'display']
    const sizes = orderedSteps.map(name => ({
      name,
      px: resolveToPx(tokens.typography[name].size),
    }))

    for (let i = 1; i < sizes.length; i++) {
      expect(
        sizes[i].px,
        `Expected "${sizes[i].name}" (${sizes[i].px}px) to be >= "${sizes[i - 1].name}" (${sizes[i - 1].px}px). ` +
        `The type scale must be monotonically increasing.`
      ).toBeGreaterThanOrEqual(sizes[i - 1].px)
    }
  })

  it('the body step size resolves to at least 14px at a 16px root', () => {
    const bodyPx = resolveToPx(tokens.typography.body.size)
    expect(
      bodyPx,
      `Body step size resolves to ${bodyPx}px, which is less than the 14px minimum ` +
      `required by Requirement 3.9.`
    ).toBeGreaterThanOrEqual(14)
  })
})
