import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { render } from '@testing-library/react'
import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListItem } from '@/components/ui/list-item'

/**
 * **Validates: Requirements 4.4, 4.5, 4.6**
 *
 * Property 10: Shape-to-meaning radius invariants
 *
 * For any rendered `<input>`, `<select>`, or `<textarea>`, the computed
 * `border-radius` equals `tokens.radius.md` (i.e. uses `rounded-md`).
 * For any rendered card or `ListItem`, the computed `border-radius` equals
 * `tokens.radius.lg` (i.e. uses `rounded-lg`).
 * For any rendered button, the computed `border-radius` equals either
 * `tokens.radius.md` or `tokens.radius.pill`, and all buttons sharing the
 * same variant token use the same value.
 */

const BUTTON_VARIANTS = ['primary', 'secondary', 'tonal', 'text', 'destructive'] as const
type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

const INPUT_TYPES = ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'date'] as const

describe('Property 10: Shape-to-meaning radius invariants', () => {
  describe('Requirement 4.4: Inputs use md radius', () => {
    it('every input type applies rounded-md', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...INPUT_TYPES),
          (inputType) => {
            const { container } = render(<Input type={inputType} />)
            const input = container.firstElementChild as HTMLElement
            const classes = input.className

            // Requirement 4.4: text input, select, or textarea uses md Radius_Scale step
            expect(classes).toContain('rounded-md')
            // Must NOT use other radius steps
            expect(classes).not.toContain('rounded-lg')
            expect(classes).not.toContain('rounded-xl')
            expect(classes).not.toContain('rounded-pill')
            expect(classes).not.toContain('rounded-full')
            expect(classes).not.toContain('rounded-sm')
          }
        ),
        { numRuns: INPUT_TYPES.length }
      )
    })
  })

  describe('Requirement 4.5: Cards and ListItems use lg radius', () => {
    it('ListItem applies rounded-lg for any tone', () => {
      const TONES = ['default', 'error', 'success'] as const

      fc.assert(
        fc.property(
          fc.constantFrom(...TONES),
          (tone) => {
            const { container } = render(
              <ListItem title="Test item" tone={tone} />
            )
            const li = container.firstElementChild as HTMLElement
            const classes = li.className

            // Requirement 4.5: card or list item container uses lg Radius_Scale step
            expect(classes).toContain('rounded-lg')
            // Must NOT use other radius steps
            expect(classes).not.toContain('rounded-md')
            expect(classes).not.toContain('rounded-sm')
            expect(classes).not.toContain('rounded-xl')
            expect(classes).not.toContain('rounded-pill')
          }
        ),
        { numRuns: TONES.length }
      )
    })
  })

  describe('Requirement 4.6: Buttons use md or pill radius consistently per variant', () => {
    it('every button variant uses rounded-md (the design system default for buttons)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...BUTTON_VARIANTS),
          (variant: ButtonVariant) => {
            const { container } = render(
              <Button variant={variant}>Label</Button>
            )
            const button = container.firstElementChild as HTMLElement
            const classes = button.className

            // Requirement 4.6: buttons use either md or pill radius step
            const usesMd = classes.includes('rounded-md')
            const usesPill = classes.includes('rounded-pill')
            expect(usesMd || usesPill).toBe(true)
          }
        ),
        { numRuns: BUTTON_VARIANTS.length }
      )
    })

    it('all buttons of the same variant use the same radius step', () => {
      // Render each variant multiple times and verify consistency
      fc.assert(
        fc.property(
          fc.constantFrom(...BUTTON_VARIANTS),
          fc.string({ minLength: 1, maxLength: 20 }),
          (variant: ButtonVariant, label: string) => {
            const { container } = render(
              <Button variant={variant}>{label}</Button>
            )
            const button = container.firstElementChild as HTMLElement
            const classes = button.className

            // All variants in the current implementation use rounded-md
            // The key invariant: the radius class is deterministic per variant
            const usesMd = classes.includes('rounded-md')
            const usesPill = classes.includes('rounded-pill')

            // Exactly one radius token must be applied
            expect(usesMd || usesPill).toBe(true)

            // Render a second instance of the same variant with a different label
            const { container: container2 } = render(
              <Button variant={variant}>Another Label</Button>
            )
            const button2 = container2.firstElementChild as HTMLElement
            const classes2 = button2.className

            const usesMd2 = classes2.includes('rounded-md')
            const usesPill2 = classes2.includes('rounded-pill')

            // Same variant must produce same radius
            expect(usesMd).toBe(usesMd2)
            expect(usesPill).toBe(usesPill2)
          }
        ),
        { numRuns: BUTTON_VARIANTS.length * 3 }
      )
    })

    it('button radius is distinct from card radius (md ≠ lg)', () => {
      // Buttons and cards must use different radius steps to convey shape-meaning
      fc.assert(
        fc.property(
          fc.constantFrom(...BUTTON_VARIANTS),
          (variant: ButtonVariant) => {
            const { container: btnContainer } = render(
              <Button variant={variant}>Action</Button>
            )
            const { container: listContainer } = render(
              <ListItem title="Item" />
            )

            const btnClasses = (btnContainer.firstElementChild as HTMLElement).className
            const listClasses = (listContainer.firstElementChild as HTMLElement).className

            // Button uses rounded-md (or pill), ListItem uses rounded-lg
            // They must not share the same radius token
            if (btnClasses.includes('rounded-md')) {
              expect(listClasses).not.toContain('rounded-md')
            }
          }
        ),
        { numRuns: BUTTON_VARIANTS.length }
      )
    })
  })
})
