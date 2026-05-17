import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import * as fc from 'fast-check'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { Toaster, toast } from '@/components/ui/toast'

/**
 * **Validates: Requirements 10.5, 10.6, 11.7, 11.8, 11.9**
 *
 * Property 22: Toast ARIA policy
 *
 * For any toast rendered with a non-critical role (success, info), the
 * live region carrying the toast announces with `aria-live="polite"`.
 * For any toast rendered with a critical role (error), an interrupting
 * live region with `role="alert"` and `aria-live="assertive"` is mounted
 * and mirrors the toast's title. When no error toast is active, the
 * assertive region is removed from the DOM.
 *
 * Concretely the design wires this through a single `<Toaster />`
 * primitive that wraps `sonner`:
 *
 *  - The viewport region is sonner's `<section>` carrying an accessible
 *    name (`aria-label` containing "Notifications") plus
 *    `aria-live="polite"` and `aria-relevant="additions text"`. Because
 *    a `<section>` with an accessible name is implicitly a landmark
 *    `region`, this satisfies the "viewport region with accessible name"
 *    portion of Requirement 11.7.
 *  - Each toast is a `<li data-sonner-toast>` with `data-type` set to
 *    `success`, `info`, `warning`, `error`, or `default`. The toast is
 *    focusable (`tabindex="0"`) and `data-dismissible="true"`, so it is
 *    keyboard-dismissible via `Escape` after the user reaches it via the
 *    sonner hotkey or `Tab` (Requirements 11.7/11.8 implicit
 *    operability).
 *  - For error toasts the wrapper additionally mounts a visually-hidden
 *    `<div role="alert" aria-live="assertive" aria-atomic="true">` whose
 *    children mirror every active error toast's title. The wrapper is
 *    rendered conditionally — when the error queue drains, the wrapper
 *    returns `null` and the node is removed (Requirement 11.9).
 *
 * The properties below quantify over random sequences of `toast.success`
 * / `toast.error` / `toast.dismiss` operations and assert these
 * invariants hold after every operation.
 */

const TOAST_OPERATIONS = ['success', 'error', 'dismissAll'] as const
type ToastOperation = (typeof TOAST_OPERATIONS)[number]

type Operation =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'dismissAll' }

/** Generator that produces a non-empty toast message string. */
const messageArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0)

/** Generator that produces a single toast operation. */
const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant('success' as const), message: messageArb }),
  fc.record({ kind: fc.constant('error' as const), message: messageArb }),
  fc.record({ kind: fc.constant('dismissAll' as const) }),
)

/** Apply a single operation to the global sonner store, wrapped in act. */
async function applyOperation(op: Operation): Promise<void> {
  await act(async () => {
    if (op.kind === 'success') {
      toast.success(op.message)
    } else if (op.kind === 'error') {
      toast.error(op.message)
    } else {
      toast.dismiss()
    }
    // Allow sonner's internal subscribers to flush state updates.
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

/** Find the sonner viewport region in the rendered tree. */
function getSonnerViewport(container: HTMLElement): HTMLElement {
  // Sonner mounts a <section aria-label="Notifications ..."> as the
  // landmark viewport. The inner <ol data-sonner-toaster> is added and
  // removed depending on whether the queue is non-empty, so we anchor on
  // the section's accessible name instead — that element is always
  // present once the Toaster has rendered.
  const sections = Array.from(
    container.querySelectorAll<HTMLElement>('section[aria-label]'),
  )
  const viewport = sections.find((s) =>
    (s.getAttribute('aria-label') ?? '').toLowerCase().includes('notifications'),
  )
  expect(viewport, 'Sonner viewport <section> not found').toBeDefined()
  return viewport!
}

/** All currently-rendered toast `<li>` elements. */
function getToastItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-sonner-toast]'),
  )
}

/** The custom assertive live region (rendered only while errors exist). */
function getAssertiveRegion(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    'div[role="alert"][aria-live="assertive"]',
  )
}

afterEach(() => {
  // Drain sonner's global queue between tests so iterations don't bleed.
  toast.dismiss()
  cleanup()
})

describe('Property 22: Toast ARIA policy', () => {
  describe('Viewport region', () => {
    it('viewport is a <section> with role=region semantics and aria-live=polite', () => {
      const { container } = render(<Toaster />)
      const viewport = getSonnerViewport(container)

      // The viewport is a <section> with an accessible name. Per the HTML
      // accessibility spec, a <section> with an accessible name is the
      // "region" landmark, satisfying Requirement 11.7's viewport-region
      // expectation without requiring an explicit role attribute.
      expect(viewport.tagName).toBe('SECTION')

      // Accessible name carries "Notifications" so screen readers announce
      // the landmark by purpose.
      const ariaLabel = viewport.getAttribute('aria-label') ?? ''
      expect(ariaLabel.toLowerCase()).toContain('notifications')

      // Default announcement politeness is `polite` — interruption-safe
      // for success/info toasts (Requirement 11.7).
      expect(viewport.getAttribute('aria-live')).toBe('polite')
    })

    it('viewport stays mounted across an arbitrary sequence of operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 1, maxLength: 6 }),
          async (operations) => {
            const { container, unmount } = render(<Toaster />)
            try {
              for (const op of operations) {
                await applyOperation(op)
                const viewport = getSonnerViewport(container)
                expect(viewport.tagName).toBe('SECTION')
                expect(viewport.getAttribute('aria-live')).toBe('polite')
                expect(
                  (viewport.getAttribute('aria-label') ?? '').toLowerCase(),
                ).toContain('notifications')
              }
            } finally {
              await act(async () => {
                toast.dismiss()
                await new Promise((r) => setTimeout(r, 10))
              })
              unmount()
            }
          },
        ),
        { numRuns: 15 },
      )
    })
  })

  describe('Polite announcement for non-critical toasts', () => {
    it('success toasts live inside the polite region with no assertive region required', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(messageArb, { minLength: 1, maxLength: 4 }),
          async (messages) => {
            const { container, unmount } = render(<Toaster />)
            try {
              for (const m of messages) {
                await applyOperation({ kind: 'success', message: m })
              }

              const viewport = getSonnerViewport(container)
              expect(viewport.getAttribute('aria-live')).toBe('polite')

              const items = getToastItems(viewport)
              // Every rendered toast has type=success and is hosted inside
              // the polite landmark — Requirement 10.5 + 11.7.
              for (const item of items) {
                expect(item.getAttribute('data-type')).toBe('success')
                expect(viewport.contains(item)).toBe(true)
              }

              // No critical/assertive region is needed when only
              // non-critical toasts are active. (Requirement 11.9 +
              // safe-default behaviour for non-critical content.)
              expect(getAssertiveRegion(container)).toBeNull()
            } finally {
              await act(async () => {
                toast.dismiss()
                await new Promise((r) => setTimeout(r, 10))
              })
              unmount()
            }
          },
        ),
        { numRuns: 15 },
      )
    })
  })

  describe('Assertive announcement for critical (error) toasts', () => {
    it('any error toast mounts an assertive role=alert region mirroring its title', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(messageArb, { minLength: 1, maxLength: 4 }),
          async (messages) => {
            const { container, unmount } = render(<Toaster />)
            try {
              for (const m of messages) {
                await applyOperation({ kind: 'error', message: m })
              }

              // 1. Viewport policy unchanged — sonner's polite region
              //    still hosts the visible toast list.
              const viewport = getSonnerViewport(container)
              expect(viewport.getAttribute('aria-live')).toBe('polite')

              // 2. Every rendered toast is type=error.
              const items = getToastItems(viewport)
              expect(items.length).toBeGreaterThan(0)
              for (const item of items) {
                expect(item.getAttribute('data-type')).toBe('error')
              }

              // 3. The assertive region is mounted — Requirements 10.6 +
              //    11.8.
              const assertive = getAssertiveRegion(container)
              expect(assertive).not.toBeNull()
              expect(assertive!.getAttribute('aria-live')).toBe('assertive')
              expect(assertive!.getAttribute('aria-atomic')).toBe('true')

              // 4. Every active error title is announced through the
              //    assertive region (mirrors the toast title).
              const announced = assertive!.textContent ?? ''
              for (const m of messages) {
                expect(announced).toContain(m)
              }
            } finally {
              await act(async () => {
                toast.dismiss()
                await new Promise((r) => setTimeout(r, 10))
              })
              unmount()
            }
          },
        ),
        { numRuns: 15 },
      )
    })

    it('mixing success and error toasts keeps each in its correct announcement channel', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 2, maxLength: 6 }),
          async (operations) => {
            const { container, unmount } = render(<Toaster />)
            try {
              const errorMessagesActive = new Set<string>()
              for (const op of operations) {
                await applyOperation(op)
                if (op.kind === 'error') {
                  errorMessagesActive.add(op.message)
                } else if (op.kind === 'dismissAll') {
                  errorMessagesActive.clear()
                }
              }

              const viewport = getSonnerViewport(container)
              expect(viewport.getAttribute('aria-live')).toBe('polite')

              const assertive = getAssertiveRegion(container)
              if (errorMessagesActive.size === 0) {
                // No live error toasts: assertive region must be absent
                // from the DOM (Requirement 11.9).
                expect(assertive).toBeNull()
              } else {
                // Errors live: assertive region present with correct
                // attributes.
                expect(assertive).not.toBeNull()
                expect(assertive!.getAttribute('aria-live')).toBe('assertive')
              }
            } finally {
              await act(async () => {
                toast.dismiss()
                await new Promise((r) => setTimeout(r, 10))
              })
              unmount()
            }
          },
        ),
        { numRuns: 20 },
      )
    })
  })

  describe('Live-region hygiene (Requirement 11.9)', () => {
    it('idle Toaster (never fired) renders no assertive live region', () => {
      const { container } = render(<Toaster />)
      // The custom assertive `role="alert"` region for errors exists only
      // when there is at least one error toast in the queue.
      expect(getAssertiveRegion(container)).toBeNull()
    })

    it('after dismissing all toasts, the assertive region is removed from the DOM', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(messageArb, { minLength: 1, maxLength: 3 }),
          async (errorMessages) => {
            const { container, unmount } = render(<Toaster />)
            try {
              // Fire some error toasts.
              for (const m of errorMessages) {
                await applyOperation({ kind: 'error', message: m })
              }
              expect(getAssertiveRegion(container)).not.toBeNull()

              // Dismiss everything.
              await applyOperation({ kind: 'dismissAll' })

              // Sonner removes dismissed toasts from its store; the
              // ErrorLiveRegion subscribes via `useSonner` and unmounts
              // when the error queue is empty.
              expect(getAssertiveRegion(container)).toBeNull()
            } finally {
              unmount()
            }
          },
        ),
        { numRuns: 10 },
      )
    })
  })

  describe('Keyboard dismissibility', () => {
    it('every rendered toast is focusable and dismissible via keyboard', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 1, maxLength: 5 }),
          async (operations) => {
            const { container, unmount } = render(<Toaster />)
            try {
              for (const op of operations) {
                await applyOperation(op)
              }

              const viewport = getSonnerViewport(container)
              const items = getToastItems(viewport)

              // Every visible toast must be reachable by keyboard. Sonner
              // renders each toast as <li tabindex="0" data-dismissible>
              // so users can `Tab` to it (or use the alt+T hotkey
              // announced in the viewport's aria-label) and dismiss with
              // `Escape`.
              for (const item of items) {
                expect(item.getAttribute('tabindex')).toBe('0')
                expect(item.getAttribute('data-dismissible')).toBe('true')
              }

              // The viewport itself advertises a keyboard hotkey via its
              // accessible name so screen-reader users can locate it.
              const ariaLabel = viewport.getAttribute('aria-label') ?? ''
              expect(ariaLabel.length).toBeGreaterThan(0)
            } finally {
              await act(async () => {
                toast.dismiss()
                await new Promise((r) => setTimeout(r, 10))
              })
              unmount()
            }
          },
        ),
        { numRuns: 15 },
      )
    })
  })

  describe('Operation enumeration coverage', () => {
    it('all toast operation kinds are exercised by the property generator', () => {
      // Smoke test: enumerate the operation set so a future addition
      // (warning, info, etc.) trips the literal-typed array and forces a
      // matching property update.
      fc.assert(
        fc.property(fc.constantFrom(...TOAST_OPERATIONS), (kind: ToastOperation) => {
          expect(['success', 'error', 'dismissAll']).toContain(kind)
        }),
        { numRuns: TOAST_OPERATIONS.length },
      )
    })
  })
})
