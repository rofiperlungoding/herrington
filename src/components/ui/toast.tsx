import * as React from 'react'
import {
  Toaster as SonnerToaster,
  toast as sonnerToast,
  useSonner,
} from 'sonner'

import { cn } from '@/lib/utils'

/**
 * Design_System Toast primitive — thin wrapper around `sonner`.
 *
 * Exposes `toast.success(msg)` and `toast.error(msg)` helpers that emit
 * token-styled toasts:
 *
 * - Success toasts render with `bg-success` + `text-on-success`
 *   (Requirements 10.5, 11.7 — background + label pairing).
 * - Error toasts render with `bg-error` + `text-on-error`
 *   (Requirements 10.6, 11.8 — background + label pairing).
 *
 * Motion: enter/exit animate both `opacity` and `transform` (translateY)
 * using the `--duration-standard` + `--easing-emphasized` tokens,
 * satisfying Requirement 6.4. The transition is declared inline via
 * `toastOptions.style` so it overrides sonner's baseline transition
 * without introducing any literal duration or cubic-bezier value in this
 * file — both values resolve from CSS variables at runtime. Under
 * `prefers-reduced-motion: reduce` the token definitions in
 * `src/styles/tokens.css` collapse `--duration-standard` to `1ms`,
 * suppressing the animation (Requirement 6.5).
 *
 * ARIA policy:
 * - Sonner's `<ol data-sonner-toaster>` container carries
 *   `aria-live="polite"`, which is the region screen readers observe for
 *   success and non-critical notifications (Requirements 10.5, 11.7).
 * - For error toasts we additionally mount a dedicated live region with
 *   `role="alert"` + `aria-live="assertive"` + `aria-atomic="true"` so
 *   critical errors are announced with interrupting priority
 *   (Requirements 10.6, 11.8). The region mirrors the title of every
 *   active error toast as visually-hidden text.
 * - The assertive region is only rendered while at least one error toast
 *   is in sonner's queue; when the queue of errors drains, the component
 *   returns `null` and the node is removed from the DOM (Requirement
 *   11.9). Sonner's polite `<ol>` is always present but visually empty
 *   when no toasts remain, so no content is announced.
 *
 * The `<Toaster />` component is mounted exactly once at the root of the
 * app (see `src/routes/__root.tsx`); calling `toast.success(...)` or
 * `toast.error(...)` from anywhere in the tree pushes into sonner's
 * global store, which both this component and the `ErrorLiveRegion`
 * subscribe to via `useSonner`. Existing call-sites that still import
 * `toast` from `'sonner'` directly (e.g. `useTasks`, `useHabits`,
 * `useCheckOffHabit`) continue to work because they push into the same
 * store with `type: 'error'` on failures, so they are also announced via
 * the assertive live region below.
 *
 * Requirements: 6.4, 10.5, 10.6, 11.7, 11.8, 11.9
 */

type ToastMessage = string

/**
 * Visually-hidden live region that mirrors the title of every currently
 * active error toast using `aria-live="assertive"`. Rendered only while
 * the error queue is non-empty so an idle toast system leaves no live
 * region in the DOM (Requirement 11.9).
 *
 * The region uses `role="alert"` (which implies `aria-live="assertive"`
 * and `aria-atomic="true"`) in addition to the explicit attributes so
 * assistive technologies that only recognise one of the two conventions
 * still treat the region as interrupting.
 */
function ErrorLiveRegion(): React.ReactElement | null {
  const { toasts } = useSonner()

  const errorTitles = React.useMemo(() => {
    return toasts
      .filter((t) => t.type === 'error')
      .map((t) => (typeof t.title === 'string' ? t.title : ''))
      .filter((title) => title.length > 0)
  }, [toasts])

  if (errorTitles.length === 0) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="sr-only"
    >
      {errorTitles.map((title, idx) => (
        <div key={`${idx}-${title}`}>{title}</div>
      ))}
    </div>
  )
}

/**
 * Root-level Toaster. Renders sonner's presentation layer plus a custom
 * assertive live region for error toasts. Mount this component exactly
 * once, near the top of the React tree (`src/routes/__root.tsx`).
 *
 * `toastOptions.unstyled` suppresses sonner's built-in surface styling so
 * the `classNames` map below can paint each toast entirely from Design
 * Tokens. `toastOptions.style.transition` overrides sonner's hard-coded
 * `transition: transform .4s, opacity .4s` baseline so enter and exit
 * animate at `--duration-standard` with `--easing-emphasized`.
 */
export function Toaster(): React.ReactElement {
  return (
    <>
      <SonnerToaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          style: {
            transition:
              'transform var(--duration-standard) var(--easing-emphasized), opacity var(--duration-standard) var(--easing-emphasized)',
          },
          classNames: {
            toast: cn(
              'flex w-full items-start gap-12 p-16',
              'rounded-lg shadow-e2',
              'text-body',
            ),
            title: 'font-medium',
            description: 'text-caption opacity-90',
            success: 'bg-success text-on-success',
            error: 'bg-error text-on-error',
            warning: 'bg-warning text-on-warning',
            info: 'bg-surface text-on-surface border border-border',
            default: 'bg-surface text-on-surface border border-border',
            closeButton: cn(
              'text-current',
              'focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-focus-ring focus-visible:ring-offset-2',
            ),
          },
        }}
      />
      <ErrorLiveRegion />
    </>
  )
}

/**
 * Token-styled toast helpers.
 *
 * Signatures mirror `sonner`'s `toast.success` / `toast.error` so the
 * existing hook call-sites (`useTasks`, `useHabits`,
 * `useToggleTaskCompletion`, `useCheckOffHabit`, `queryClient`) can swap
 * their `import { toast } from 'sonner'` for
 * `import { toast } from '@/components/ui/toast'` without any
 * behavioural change. `dismiss` is re-exported for consumers that manage
 * a toast lifecycle explicitly.
 */
export const toast = {
  success(message: ToastMessage): string | number {
    return sonnerToast.success(message)
  },
  error(message: ToastMessage): string | number {
    return sonnerToast.error(message)
  },
  dismiss(id?: string | number): string | number {
    return sonnerToast.dismiss(id)
  },
}
