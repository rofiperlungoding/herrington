import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { render } from '@testing-library/react'
import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * **Validates: Requirements 7.6, 9.5, 11.1, 11.2, 11.3**
 *
 * Property 20: Keyboard focus renders the Focus_Ring
 *
 * Every interactive element (buttons, links, inputs, checkboxes) in the
 * Design_System renders a visible focus ring when focused via keyboard.
 * The focus ring uses the design system's `focus-ring` color token and is
 * implemented as:
 *   - `focus-visible:outline-none` (suppress browser default)
 *   - `focus-visible:ring-2` (2px solid ring)
 *   - `focus-visible:ring-focus-ring` (uses the focus-ring color role)
 *   - `focus-visible:ring-offset-2` (2px offset from element edge)
 *
 * This property verifies that for any interactive element type and any
 * valid variant/configuration, the rendered element's class list contains
 * the complete Focus_Ring utility set.
 */

/**
 * The canonical set of Tailwind classes that constitute the Focus_Ring
 * as defined in Requirement 11.3 and the design document.
 */
const FOCUS_RING_CLASSES = [
  'focus-visible:outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-focus-ring',
  'focus-visible:ring-offset-2',
] as const

const BUTTON_VARIANTS = ['primary', 'secondary', 'tonal', 'text', 'destructive'] as const
type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

const BUTTON_SIZES = ['default', 'sm', 'icon'] as const
type ButtonSize = (typeof BUTTON_SIZES)[number]

/**
 * Helper: checks that a class string contains all Focus_Ring utility classes.
 */
function assertFocusRingPresent(className: string, context: string) {
  for (const cls of FOCUS_RING_CLASSES) {
    expect(className, `${context} missing focus-ring class: ${cls}`).toContain(cls)
  }
}

describe('Property 20: Keyboard focus renders the Focus_Ring', () => {
  it('every Button variant × size combination includes the Focus_Ring classes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        fc.constantFrom(...BUTTON_SIZES),
        (variant: ButtonVariant, size: ButtonSize) => {
          const { container } = render(
            <Button variant={variant} size={size}>
              {size === 'icon' ? '✓' : 'Label'}
            </Button>,
          )
          const button = container.firstElementChild as HTMLElement
          const classes = button.className

          assertFocusRingPresent(
            classes,
            `Button variant="${variant}" size="${size}"`,
          )
        },
      ),
      { numRuns: BUTTON_VARIANTS.length * BUTTON_SIZES.length },
    )
  })

  it.skip('Input element includes the Focus_Ring classes (suppressed globally per user request)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('text', 'email', 'password', 'number', 'search', 'url', 'tel'),
        (type: string) => {
          const { container } = render(<Input type={type} />)
          const input = container.querySelector('input') as HTMLElement
          const classes = input.className

          assertFocusRingPresent(classes, `Input type="${type}"`)
        },
      ),
      { numRuns: 7 },
    )
  })

  it('Checkbox element includes the Focus_Ring classes', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (checked: boolean) => {
          const { container } = render(
            <Checkbox checked={checked} />,
          )
          // Radix Checkbox renders a <button> element as the root
          const checkbox = container.querySelector('button') as HTMLElement
          const classes = checkbox.className

          assertFocusRingPresent(
            classes,
            `Checkbox checked=${checked}`,
          )
        },
      ),
      { numRuns: 2 },
    )
  })

  it('disabled buttons still include the Focus_Ring classes (ring is suppressed by browser, not removed from DOM)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const { container } = render(
            <Button variant={variant} disabled>
              Disabled
            </Button>,
          )
          const button = container.firstElementChild as HTMLElement
          const classes = button.className

          // Even disabled buttons retain the focus-ring classes in the DOM;
          // the browser's :focus-visible pseudo-class simply won't match
          // a disabled button, so the ring won't render visually, but the
          // classes must still be present for when aria-disabled is used
          // instead of the native disabled attribute.
          assertFocusRingPresent(
            classes,
            `Disabled Button variant="${variant}"`,
          )
        },
      ),
      { numRuns: BUTTON_VARIANTS.length },
    )
  })

  it('loading buttons still include the Focus_Ring classes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const { container } = render(
            <Button variant={variant} loading>
              Loading
            </Button>,
          )
          const button = container.firstElementChild as HTMLElement
          const classes = button.className

          assertFocusRingPresent(
            classes,
            `Loading Button variant="${variant}"`,
          )
        },
      ),
      { numRuns: BUTTON_VARIANTS.length },
    )
  })

  it('Focus_Ring uses the design system focus-ring token (not an arbitrary color)', () => {
    // Verify that the focus ring color class specifically references the
    // `focus-ring` token, not a hardcoded color like `ring-blue-500`
    fc.assert(
      fc.property(
        fc.constantFrom(...BUTTON_VARIANTS),
        (variant: ButtonVariant) => {
          const { container } = render(
            <Button variant={variant}>Token Check</Button>,
          )
          const button = container.firstElementChild as HTMLElement
          const classes = button.className

          // Must use the token-backed `ring-focus-ring` class
          expect(classes).toContain('focus-visible:ring-focus-ring')

          // Must NOT use arbitrary ring colors (hardcoded values)
          expect(classes).not.toMatch(/focus-visible:ring-\[#/)
          expect(classes).not.toMatch(/focus-visible:ring-blue/)
          expect(classes).not.toMatch(/focus-visible:ring-red/)
        },
      ),
      { numRuns: BUTTON_VARIANTS.length },
    )
  })

  it('Focus_Ring is a 2px ring with 2px offset (Requirement 11.3)', () => {
    // The ring width is `ring-2` (2px) and offset is `ring-offset-2` (2px)
    // This validates the specific dimensions required by Requirement 11.3
    // NOTE: Input is excluded — focus ring on Input was removed at the
    // user's request (visually suppressed app-wide via index.css).
    fc.assert(
      fc.property(
        fc.constantFrom('button', 'checkbox') as fc.Arbitrary<string>,
        (elementType: string) => {
          let container: HTMLElement

          if (elementType === 'button') {
            const result = render(<Button>Focus Test</Button>)
            container = result.container.firstElementChild as HTMLElement
          } else {
            const result = render(<Checkbox />)
            container = result.container.querySelector('button') as HTMLElement
          }

          const classes = container.className

          // ring-2 = 2px ring width (Requirement 11.3: "2-pixel solid outline")
          expect(classes).toContain('focus-visible:ring-2')

          // ring-offset-2 = 2px offset (Requirement 11.3: "2-pixel offset from element's outer edge")
          expect(classes).toContain('focus-visible:ring-offset-2')
        },
      ),
      { numRuns: 2 },
    )
  })
})
