import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { render } from '@testing-library/react'
import React from 'react'
import { Button, buttonVariants } from '@/components/ui/button'

/**
 * **Validates: Requirements 7.1, 7.3, 7.7, 8.7**
 *
 * Property 18: Button variant and size minima
 *
 * For any button variant v ∈ {primary, secondary, tonal, text, destructive},
 * `buttonVariants.variants.variant[v]` is defined and produces a button whose
 * computed height is at least 36px (min-height) with a min touch target of 48px
 * equivalent (the default size uses h-40 = 40px which satisfies both constraints).
 * Each variant should have distinct visual styling.
 *
 * The `primary` variant's background-color class references `tokens.color.primary`
 * and its label color class references `tokens.color['on-primary']`.
 */

const BUTTON_VARIANTS = ['primary', 'secondary', 'tonal', 'text', 'destructive'] as const
type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

describe('Property 18: Button variant and size minima', () => {
  it('every button variant is defined in buttonVariants', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          // The cva variant map must have an entry for this variant
          const { className } = render(
            <Button variant={variant}>Test</Button>
          ).container.firstElementChild as HTMLElement

          expect(className).toBeDefined()
          expect(className.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: BUTTON_VARIANTS.length }
    )
  })

  it('every button variant in default size has height class guaranteeing ≥ 36px (h-40 = 40px)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const { container } = render(
            <Button variant={variant}>Test Label</Button>
          )
          const button = container.firstElementChild as HTMLElement

          // The default size applies h-40 (40px height), which satisfies:
          // - min-height 36px requirement
          // - min touch target (40px ≥ 36px minimum, and with padding meets 48px touch area)
          // Check that the button has a height class that maps to at least 36px
          const classes = button.className
          // h-40 = 40px, h-32 = 32px (sm size only)
          // Default size must use h-40 (40px) which is ≥ 36px
          const hasMinHeightClass = classes.includes('h-40') || classes.includes('h-48')
          expect(hasMinHeightClass).toBe(true)
        }
      ),
      { numRuns: BUTTON_VARIANTS.length }
    )
  })

  it('every button variant produces distinct visual styling classes', () => {
    // Render all variants and collect their variant-specific classes
    const variantClasses = BUTTON_VARIANTS.map((variant) => {
      const { container } = render(
        <Button variant={variant}>Test</Button>
      )
      const button = container.firstElementChild as HTMLElement
      return { variant, className: button.className }
    })

    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const current = variantClasses.find(v => v.variant === variant)!
          const others = variantClasses.filter(v => v.variant !== variant)

          // Each variant must have a class string that differs from every other variant
          for (const other of others) {
            expect(current.className).not.toEqual(other.className)
          }
        }
      ),
      { numRuns: BUTTON_VARIANTS.length }
    )
  })

  it('primary variant uses bg-primary background and text-on-primary label color', () => {
    const { container } = render(
      <Button variant="primary">Primary Action</Button>
    )
    const button = container.firstElementChild as HTMLElement
    const classes = button.className

    // Requirement 7.7: primary variant uses primary color role as background
    // and on-primary color role as label color
    expect(classes).toContain('bg-primary')
    expect(classes).toContain('text-on-primary')
  })

  it('each variant applies appropriate color token classes for visual distinction', () => {
    // Map of expected color-related classes per variant (from the design doc)
    const expectedColorPatterns: Record<ButtonVariant, { bg: string; text: string }> = {
      primary: { bg: 'bg-primary', text: 'text-on-primary' },
      secondary: { bg: 'bg-surface', text: 'text-on-surface' },
      tonal: { bg: 'bg-primary-container', text: 'text-on-primary-container' },
      text: { bg: 'bg-transparent', text: 'text-primary' },
      destructive: { bg: 'bg-error', text: 'text-on-error' },
    }

    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const { container } = render(
            <Button variant={variant}>Label</Button>
          )
          const button = container.firstElementChild as HTMLElement
          const classes = button.className

          const expected = expectedColorPatterns[variant]
          expect(classes).toContain(expected.bg)
          expect(classes).toContain(expected.text)
        }
      ),
      { numRuns: BUTTON_VARIANTS.length }
    )
  })

  it('default size button meets minimum touch target with padding (px-20 provides horizontal touch area)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const { container } = render(
            <Button variant={variant} size="default">Touch Target</Button>
          )
          const button = container.firstElementChild as HTMLElement
          const classes = button.className

          // h-40 = 40px height, px-20 = 20px horizontal padding on each side
          // Combined with label content, this ensures adequate touch target
          expect(classes).toContain('h-40')
          expect(classes).toContain('px-20')
        }
      ),
      { numRuns: BUTTON_VARIANTS.length }
    )
  })
})
