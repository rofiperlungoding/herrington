import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Dialog primitive — Design_System refresh.
 *
 * Wraps `@radix-ui/react-dialog` so consumers still get the accessibility
 * semantics Radix ships with (focus trap, `aria-modal`, escape-to-close,
 * overlay click-to-close, and focus restoration to the element that opened
 * the dialog — Requirement 11.4). The visual layer is re-themed to the
 * Design_System: the overlay dims with `bg-overlay`, the content surface
 * lifts with `shadow-e3` + `rounded-xl` on `bg-surface` and carries no
 * border (Requirements 5.6, 5.7), and both surfaces animate their enter/
 * exit with the `fade`/`zoom` keyframes registered in `tailwind.config.ts`
 * which resolve to `duration-standard` + `ease-emphasized` (Requirement
 * 6.3).
 *
 * As a defensive fallback on top of Radix's own focus restoration, the
 * content composes `useDialogOpenerFallback`, a hook that captures the
 * opener on open and, if that element has been unmounted by the time the
 * dialog closes (for example the list item whose edit button launched the
 * dialog was just deleted), lands focus on the page's `<h1>` so keyboard
 * and screen-reader users never get stranded on `document.body`.
 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

/**
 * Capture the opener and fall back to the page's `<h1>` when it is gone.
 *
 * Radix already restores focus to the element that opened the dialog on
 * close (Requirement 11.4). The only case this hook handles is the one
 * Radix cannot: when the opener has been unmounted while the dialog was
 * open (because the surrounding list item was deleted in the dialog flow,
 * for example). In that scenario Radix falls back to `document.body`,
 * which leaves keyboard and screen-reader users without a meaningful
 * position. The hook moves focus to the first `<h1>` on the page so the
 * user lands on the page's document title instead.
 *
 * The hook is purely additive: when the opener is still in the DOM, Radix
 * wins and this hook is a no-op because `document.activeElement` is
 * already the restored opener (not `<body>`). We only act on the rising
 * edge where `document.activeElement === document.body` after a close.
 */
export function useDialogOpenerFallback(open: boolean) {
  const openerRef = React.useRef<HTMLElement | null>(null)
  const prevOpenRef = React.useRef<boolean>(open)

  React.useEffect(() => {
    const wasOpen = prevOpenRef.current

    // Open transition (false → true): snapshot the element that triggered
    // the dialog so we can check later whether it's still alive.
    if (!wasOpen && open) {
      const active = document.activeElement
      openerRef.current = active instanceof HTMLElement ? active : null
    }

    // Close transition (true → false): schedule the fallback check for the
    // next microtask so Radix has a chance to restore focus first. We only
    // redirect focus if (a) the captured opener is no longer in the DOM
    // and (b) Radix's own restoration landed on `<body>` (which is the
    // "stranded" symptom we're guarding against).
    if (wasOpen && !open) {
      const opener = openerRef.current
      openerRef.current = null

      // Defer so Radix's own focus restoration runs first.
      const timer = window.setTimeout(() => {
        const openerStillMounted = opener != null && document.body.contains(opener)
        if (openerStillMounted) return

        const stranded = document.activeElement === document.body || document.activeElement == null
        if (!stranded) return

        const heading = document.querySelector('h1')
        if (heading instanceof HTMLElement) {
          // A static `<h1>` is not focusable by default. Set `tabindex=-1`
          // so `.focus()` takes, then remove it on blur to avoid leaving a
          // lingering tab stop on a non-interactive element.
          const previousTabIndex = heading.getAttribute('tabindex')
          if (previousTabIndex == null) {
            heading.setAttribute('tabindex', '-1')
            const restore = () => {
              heading.removeAttribute('tabindex')
              heading.removeEventListener('blur', restore)
            }
            heading.addEventListener('blur', restore)
          }
          heading.focus({ preventScroll: true })
        }
      }, 0)

      prevOpenRef.current = open
      return () => window.clearTimeout(timer)
    }

    prevOpenRef.current = open
    return undefined
  }, [open])
}

/**
 * `DialogCloseRefManager` — component form of `useDialogOpenerFallback`.
 *
 * Rendered inside `DialogContent` (or any Radix dialog content) to bind
 * the opener-fallback behavior to the Radix open state. Reads the dialog
 * state from the `data-state` attribute of the nearest element with that
 * attribute (Radix sets it to `"open"` or `"closed"` on both the portal
 * root and the content root) so the component doesn't need the state
 * passed in as a prop.
 *
 * Consumers who want to drive the fallback from their own open state
 * should call `useDialogOpenerFallback(open)` directly instead.
 */
export function DialogCloseRefManager() {
  const [open, setOpen] = React.useState<boolean>(false)
  const rootRef = React.useRef<HTMLSpanElement | null>(null)

  React.useEffect(() => {
    const node = rootRef.current
    if (node == null) return undefined

    // Find the nearest ancestor that carries `data-state` — this is the
    // Radix content root. We observe its attribute so we react to every
    // transition without polling.
    const stateHost = node.closest('[data-state]') as HTMLElement | null
    if (stateHost == null) return undefined

    const read = () => setOpen(stateHost.getAttribute('data-state') === 'open')
    read()

    const observer = new MutationObserver(read)
    observer.observe(stateHost, { attributes: true, attributeFilter: ['data-state'] })
    return () => observer.disconnect()
  }, [])

  useDialogOpenerFallback(open)

  // Render nothing visible; the component exists purely for its effect.
  return <span ref={rootRef} aria-hidden="true" hidden />
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-overlay',
      'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Positioning + layout
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-16',
        // Surface treatment — rounded, elevated, no border (Req 5.6, 5.7)
        'bg-surface p-24 shadow-e3 rounded-xl',
        // Motion (Req 6.3)
        'data-[state=open]:animate-zoom-in data-[state=closed]:animate-zoom-out',
        // The dialog surface itself is not in the tab order, so suppress
        // the default browser outline when Radix focuses the content on
        // open. Individual focusable children render their own Focus_Ring.
        'focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          'absolute right-16 top-16 rounded-sm opacity-70',
          'transition-opacity duration-fast ease-standard hover:opacity-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none',
        )}
      >
        <X className="h-16 w-16" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
      <DialogCloseRefManager />
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col gap-8 text-left', className)}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse gap-8 md:flex-row md:justify-end',
      className,
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-title font-medium text-on-surface', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-body text-on-surface-muted', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogPortal,
  DialogOverlay,
}
