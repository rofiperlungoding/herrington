import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

/**
 * Design_System Tooltip primitive (shadcn-style wrapper around
 * `@radix-ui/react-tooltip`).
 *
 * Motion: enter/exit opacity + scale animations bind to the standard motion
 * tokens via Tailwind's `animate-fade-in/out` and `animate-zoom-in/out`
 * keyframes registered in `tailwind.config.ts`. Because those animations
 * resolve to `--duration-*` custom properties, the global
 * `prefers-reduced-motion` override collapses them to ≤1ms with no
 * additional code here.
 *
 * Timing: Radix `TooltipProvider` accepts a `delayDuration` prop that
 * consumers configure (e.g. 500ms on hover); focus always opens
 * immediately. `disableHoverableContent` is omitted so the tooltip remains
 * hoverable for copy-select affordances. Dismissal on pointer-leave,
 * focus-out, and Escape are handled by Radix internally.
 *
 * Requirements: 6.2, 9.4, 9.5, 11.1, 11.2
 */
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md bg-on-surface px-12 py-4 text-caption text-surface shadow-e2',
      'data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in',
      'data-[state=closed]:animate-fade-out',
      className,
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
