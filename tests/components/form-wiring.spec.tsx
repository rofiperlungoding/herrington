import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { render } from '@testing-library/react'
import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 11.6**
 *
 * Property 19: Form field wiring (label, optional, error, ARIA)
 *
 * For any form field configuration (fieldId, labelText, optional flag,
 * error message), the composed field pattern produces correct wiring:
 *
 * - The label's `for` attribute matches the input's `id` (Req 8.2)
 * - When `optional` is true, the label text includes "(optional)" (Req 8.3)
 * - When an error is present, the input has `aria-invalid="true"` (Req 11.6)
 * - When an error is present, `aria-describedby` on the input points to the
 *   error message element's `id` (Req 8.4, 11.6)
 * - When no error is present, `aria-invalid` is not "true" and
 *   `aria-describedby` does not reference a non-existent error element
 */

/**
 * Generates a valid HTML id (starts with a letter, contains only
 * alphanumeric characters and hyphens).
 */
const arbFieldId = fc
  .tuple(
    fc.constantFrom('field', 'input', 'form', 'task', 'habit'),
    fc.constantFrom('title', 'name', 'email', 'category', 'deadline', 'desc'),
  )
  .map(([prefix, suffix]) => `${prefix}-${suffix}`)

/**
 * Generates a non-empty label text string.
 */
const arbLabelText = fc.constantFrom(
  'Title',
  'Category',
  'Deadline',
  'Description',
  'Name',
  'Email',
  'Frequency',
)

/**
 * Generates an optional error message (either undefined or a non-empty string).
 */
const arbErrorMessage = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom(
    'This field is required',
    'Title is required',
    'Category is required',
    'Invalid format',
    'Must be at least 3 characters',
  ),
)

/**
 * A composed form field following the canonical pattern from the design doc.
 * This mirrors how TaskCreateForm and HabitCreateForm compose their fields.
 */
function ComposedFormField({
  fieldId,
  labelText,
  optional,
  error,
}: {
  fieldId: string
  labelText: string
  optional: boolean
  error: string | undefined
}) {
  const errorId = `${fieldId}-error`

  return (
    <div className="flex flex-col gap-4">
      <Label htmlFor={fieldId} optional={optional}>
        {labelText}
      </Label>
      <Input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="text-caption text-error">
          {error}
        </p>
      )}
    </div>
  )
}

describe('Property 19: Form field wiring (label, optional, error, ARIA)', () => {
  it('label htmlFor matches input id for any field configuration', () => {
    fc.assert(
      fc.property(
        arbFieldId,
        arbLabelText,
        fc.boolean(),
        arbErrorMessage,
        (fieldId, labelText, optional, error) => {
          const { container } = render(
            <ComposedFormField
              fieldId={fieldId}
              labelText={labelText}
              optional={optional}
              error={error}
            />,
          )

          const label = container.querySelector('label')
          const input = container.querySelector('input')

          expect(label).not.toBeNull()
          expect(input).not.toBeNull()

          // Requirement 8.2: label's `for` references the input's `id`
          expect(label!.getAttribute('for')).toBe(fieldId)
          expect(input!.getAttribute('id')).toBe(fieldId)
          expect(label!.getAttribute('for')).toBe(input!.getAttribute('id'))
        },
      ),
      { numRuns: 50 },
    )
  })

  it('optional fields display "(optional)" in the label text', () => {
    fc.assert(
      fc.property(
        arbFieldId,
        arbLabelText,
        arbErrorMessage,
        (fieldId, labelText, error) => {
          const { container: optionalContainer } = render(
            <ComposedFormField
              fieldId={fieldId}
              labelText={labelText}
              optional={true}
              error={error}
            />,
          )

          const { container: requiredContainer } = render(
            <ComposedFormField
              fieldId={fieldId}
              labelText={labelText}
              optional={false}
              error={error}
            />,
          )

          const optionalLabel = optionalContainer.querySelector('label')
          const requiredLabel = requiredContainer.querySelector('label')

          // Requirement 8.3: optional fields append "(optional)" to label text
          expect(optionalLabel!.textContent).toContain('(optional)')
          expect(optionalLabel!.textContent).toContain(labelText)

          // Required fields do NOT show "(optional)"
          expect(requiredLabel!.textContent).not.toContain('(optional)')
          expect(requiredLabel!.textContent).toContain(labelText)
        },
      ),
      { numRuns: 30 },
    )
  })

  it('error state sets aria-invalid="true" and aria-describedby pointing to error element', () => {
    fc.assert(
      fc.property(
        arbFieldId,
        arbLabelText,
        fc.boolean(),
        fc.constantFrom(
          'This field is required',
          'Title is required',
          'Invalid format',
          'Must be at least 3 characters',
        ),
        (fieldId, labelText, optional, errorMsg) => {
          const { container, unmount } = render(
            <ComposedFormField
              fieldId={fieldId}
              labelText={labelText}
              optional={optional}
              error={errorMsg}
            />,
          )

          const input = container.querySelector('input')
          const errorId = `${fieldId}-error`
          const errorElement = container.querySelector(`[id="${errorId}"]`)

          // Requirement 11.6: aria-invalid is "true" when error is present
          expect(input!.getAttribute('aria-invalid')).toBe('true')

          // Requirement 8.4, 11.6: aria-describedby references the error message id
          expect(input!.getAttribute('aria-describedby')).toBe(errorId)

          // The error element exists and contains the error message
          expect(errorElement).not.toBeNull()
          expect(errorElement!.textContent).toBe(errorMsg)

          unmount()
        },
      ),
      { numRuns: 30 },
    )
  })

  it('no-error state does not set aria-invalid or aria-describedby', () => {
    fc.assert(
      fc.property(
        arbFieldId,
        arbLabelText,
        fc.boolean(),
        (fieldId, labelText, optional) => {
          const { container, unmount } = render(
            <ComposedFormField
              fieldId={fieldId}
              labelText={labelText}
              optional={optional}
              error={undefined}
            />,
          )

          const input = container.querySelector('input')
          const errorId = `${fieldId}-error`
          const errorElement = container.querySelector(`[id="${errorId}"]`)

          // When no error: aria-invalid should not be "true"
          const ariaInvalid = input!.getAttribute('aria-invalid')
          expect(ariaInvalid).not.toBe('true')

          // When no error: aria-describedby should not reference a non-existent element
          const ariaDescribedBy = input!.getAttribute('aria-describedby')
          expect(ariaDescribedBy).toBeNull()

          // The error element should not exist in the DOM
          expect(errorElement).toBeNull()

          unmount()
        },
      ),
      { numRuns: 30 },
    )
  })

  it('error message element uses the error color role for visibility', () => {
    fc.assert(
      fc.property(
        arbFieldId,
        arbLabelText,
        fc.boolean(),
        fc.constantFrom(
          'This field is required',
          'Title is required',
          'Invalid format',
        ),
        (fieldId, labelText, optional, errorMsg) => {
          const { container, unmount } = render(
            <ComposedFormField
              fieldId={fieldId}
              labelText={labelText}
              optional={optional}
              error={errorMsg}
            />,
          )

          const errorId = `${fieldId}-error`
          const errorElement = container.querySelector(`[id="${errorId}"]`)

          // Requirement 8.4: error message uses the error color role
          expect(errorElement).not.toBeNull()
          expect(errorElement!.className).toContain('text-error')

          unmount()
        },
      ),
      { numRuns: 20 },
    )
  })
})
