import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { render, within } from '@testing-library/react'
import React from 'react'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

/**
 * **Validates: Requirement 11.5**
 *
 * Property 21: Icon-only interactive elements carry an accessible name
 *
 * For any Interactive_Element whose rendered children contain no visible
 * text (icon-only buttons, icon-only links, icon-only toggles), the element
 * exposes a non-empty accessible name via either an `aria-label` attribute
 * or a visually-hidden text child (`.sr-only` or equivalent).
 *
 * The property is asserted by rendering icon-only `Button` elements (size
 * "icon") with various icon contents and various accessible-name strategies,
 * then resolving each with the testing-library a11y query
 * `getByRole('button', { name: ... })`. If accessibility wiring is missing
 * the query returns null and the property fails.
 */

/**
 * A small palette of decorative SVG shapes used to populate the icon
 * content. The goal is to vary the *visual* surface of the icon while
 * keeping the *accessibility* surface controlled by the strategy under
 * test.
 */
type IconShape = 'check' | 'x' | 'plus' | 'chevron' | 'circle'

function renderShape(shape: IconShape): React.ReactElement {
  switch (shape) {
    case 'check':
      return (
        <svg viewBox="0 0 20 20">
          <path d="M4 10l4 4 8-8" />
        </svg>
      )
    case 'x':
      return (
        <svg viewBox="0 0 20 20">
          <path d="M4 4l12 12M16 4L4 16" />
        </svg>
      )
    case 'plus':
      return (
        <svg viewBox="0 0 20 20">
          <path d="M10 4v12M4 10h12" />
        </svg>
      )
    case 'chevron':
      return (
        <svg viewBox="0 0 20 20">
          <path d="M6 4l8 6-8 6" />
        </svg>
      )
    case 'circle':
      return (
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="6" />
        </svg>
      )
  }
}

/**
 * Strategies the Component_Library accepts for naming an icon-only
 * interactive element. Each strategy must yield an accessible name
 * resolvable by the accessibility tree.
 */
type NameStrategy = 'aria-label' | 'sr-only-child' | 'icon-label-prop'

/**
 * fast-check arbitrary for non-empty visible-character labels. Constrains
 * to printable ASCII so the generated string survives accessibility-name
 * normalization (which collapses whitespace) without becoming empty.
 */
const accessibleNameArb = fc
  .string({
    minLength: 1,
    maxLength: 40,
    unit: fc.constantFrom(
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
      'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
      'u', 'v', 'w', 'x', 'y', 'z',
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
      ' ', '-', '.',
    ),
  })
  // Reject names that normalize to the empty string (all whitespace) so
  // the property "name is non-empty" is meaningful.
  .filter((s) => s.trim().length > 0)

const iconShapeArb: fc.Arbitrary<IconShape> = fc.constantFrom(
  'check',
  'x',
  'plus',
  'chevron',
  'circle',
)

const nameStrategyArb: fc.Arbitrary<NameStrategy> = fc.constantFrom(
  'aria-label',
  'sr-only-child',
  'icon-label-prop',
)

/**
 * Render an icon-only Button using the chosen naming strategy, then return
 * the rendered button element so the test can interrogate its accessible
 * name. Throws if no `<button>` is found, which would itself indicate a
 * failure of the icon-only contract (the element is not a button at all).
 */
function renderIconOnlyButton(
  shape: IconShape,
  strategy: NameStrategy,
  name: string,
): { container: HTMLElement; button: HTMLButtonElement } {
  let element: React.ReactElement
  switch (strategy) {
    case 'aria-label':
      element = (
        <Button size="icon" variant="text" aria-label={name}>
          {renderShape(shape)}
        </Button>
      )
      break
    case 'sr-only-child':
      element = (
        <Button size="icon" variant="text">
          {renderShape(shape)}
          <span className="sr-only">{name}</span>
        </Button>
      )
      break
    case 'icon-label-prop':
      element = (
        <Button size="icon" variant="text">
          <Icon label={name}>{renderShape(shape)}</Icon>
        </Button>
      )
      break
  }

  const result = render(element)
  const button = result.container.querySelector(
    'button',
  ) as HTMLButtonElement | null
  if (button === null) {
    throw new Error(
      'Icon-only Button did not render a <button> element',
    )
  }
  return { container: result.container as HTMLElement, button }
}

describe('Property 21: Icon-only interactive elements carry an accessible name', () => {
  it('every icon-only Button × icon × naming strategy combination has a non-empty accessible name resolvable by getByRole', () => {
    fc.assert(
      fc.property(
        iconShapeArb,
        nameStrategyArb,
        accessibleNameArb,
        (shape, strategy, name) => {
          const result = render(
            (() => {
              switch (strategy) {
                case 'aria-label':
                  return (
                    <Button size="icon" variant="text" aria-label={name}>
                      {renderShape(shape)}
                    </Button>
                  )
                case 'sr-only-child':
                  return (
                    <Button size="icon" variant="text">
                      {renderShape(shape)}
                      <span className="sr-only">{name}</span>
                    </Button>
                  )
                case 'icon-label-prop':
                  return (
                    <Button size="icon" variant="text">
                      <Icon label={name}>{renderShape(shape)}</Icon>
                    </Button>
                  )
              }
            })(),
          )

          try {
            // The accessibility-tree query that user agents and assistive
            // technologies use to resolve a name. We scope the query with
            // `within(result.container)` so previously-rendered iterations
            // (still attached to document.body until cleanup) cannot leak
            // duplicate matches when fast-check happens to generate the
            // same accessible name twice. If the name strategy is wired
            // correctly, this query returns the button; otherwise it
            // throws and the property fails.
            const resolved = within(result.container).getByRole('button', {
              name: name.trim(),
            })

            expect(resolved).not.toBeNull()
            // The accessible name is non-empty (the contract).
            expect(
              resolved.getAttribute('aria-label') ?? resolved.textContent ?? '',
            ).not.toBe('')
          } finally {
            // Unmount this iteration's render so document.body cannot
            // accumulate buttons across runs.
            result.unmount()
          }
        },
      ),
      { numRuns: 30 },
    )
  })

  it('icon-only Button rendered with aria-label exposes that label as its accessible name', () => {
    fc.assert(
      fc.property(
        iconShapeArb,
        accessibleNameArb,
        (shape, name) => {
          const { button } = renderIconOnlyButton(shape, 'aria-label', name)
          expect(button.getAttribute('aria-label')).toBe(name)
          // No visible text content (the button is icon-only).
          // The visible text of the SVG path elements is empty.
          expect((button.textContent ?? '').trim()).toBe('')
        },
      ),
      { numRuns: 20 },
    )
  })

  it('icon-only Button rendered with an sr-only child exposes the sr-only text as its accessible name', () => {
    fc.assert(
      fc.property(
        iconShapeArb,
        accessibleNameArb,
        (shape, name) => {
          const { button } = renderIconOnlyButton(shape, 'sr-only-child', name)
          // The sr-only span is in the DOM and contributes to the
          // accessible name. It uses the .sr-only utility class.
          const srOnly = button.querySelector('.sr-only')
          expect(srOnly).not.toBeNull()
          expect(srOnly!.textContent).toBe(name)
        },
      ),
      { numRuns: 20 },
    )
  })

  it('icon-only Button wrapping an Icon with a label prop exposes the label as its accessible name', () => {
    fc.assert(
      fc.property(
        iconShapeArb,
        accessibleNameArb,
        (shape, name) => {
          const { button } = renderIconOnlyButton(
            shape,
            'icon-label-prop',
            name,
          )
          // The Icon component renders a sibling sr-only span inside the
          // button, which contributes to the accessible name and marks
          // the SVG itself aria-hidden.
          const srOnly = button.querySelector('.sr-only')
          expect(srOnly).not.toBeNull()
          expect(srOnly!.textContent).toBe(name)

          const svg = button.querySelector('svg')
          expect(svg).not.toBeNull()
          expect(svg!.getAttribute('aria-hidden')).toBe('true')
        },
      ),
      { numRuns: 20 },
    )
  })

  it('the accessible-name resolution is invariant to the icon shape (same name, any shape, same query result)', () => {
    fc.assert(
      fc.property(
        iconShapeArb,
        iconShapeArb,
        nameStrategyArb,
        accessibleNameArb,
        (shapeA, shapeB, strategy, name) => {
          const renderA = renderIconOnlyButton(shapeA, strategy, name)
          const renderB = renderIconOnlyButton(shapeB, strategy, name)

          // The accessible-name surface (aria-label or sr-only text) is
          // identical regardless of which icon glyph is rendered.
          const nameA =
            renderA.button.getAttribute('aria-label') ??
            renderA.button.querySelector('.sr-only')?.textContent ??
            ''
          const nameB =
            renderB.button.getAttribute('aria-label') ??
            renderB.button.querySelector('.sr-only')?.textContent ??
            ''
          expect(nameA).toBe(nameB)
          expect(nameA).toBe(name)
        },
      ),
      { numRuns: 20 },
    )
  })

  it('icon-only Button never relies on the icon SVG itself for the accessible name (SVG is decorative or hidden)', () => {
    fc.assert(
      fc.property(
        iconShapeArb,
        nameStrategyArb,
        accessibleNameArb,
        (shape, strategy, name) => {
          const { button } = renderIconOnlyButton(shape, strategy, name)

          // The SVG carries no <title> and no aria-label of its own —
          // the accessible name lives on the button (aria-label) or in a
          // sibling sr-only span. This guards against icon shapes
          // accidentally claiming the name surface and silently breaking
          // the contract.
          const svg = button.querySelector('svg')
          expect(svg).not.toBeNull()
          expect(svg!.querySelector('title')).toBeNull()
          expect(svg!.getAttribute('aria-label')).toBeNull()
        },
      ),
      { numRuns: 20 },
    )
  })
})
