import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * shadcn/ui Checkbox, adapted for this Vite SPA and re-skinned against the
 * Design_System role tokens (Requirements 4.3, 8.1, 11.1, 11.2, 16.1).
 *
 * Source: https://ui.shadcn.com/docs/components/checkbox. The upstream template
 * emits a `'use client'` directive because shadcn defaults to the Next.js
 * App-Router preset; we run under Vite, where every component is already a
 * client component, so the directive is dropped.
 *
 * Visual contract:
 * - Rest: `bg-surface` with a `border-border` 1px border and `rounded-sm`
 *   corners, matching Req 4.3's small-control radius step.
 * - Focus-visible: 2px `ring-focus-ring` with a 2px offset (Req 11.1, 11.2)
 *   delivered via the `peer` focus-ring pattern so adjacent labels can key off
 *   the checkbox state if needed.
 * - Checked: background swaps to `bg-primary`, border to `border-primary`, and
 *   the indicator glyph inherits `text-on-primary` for AA contrast.
 * - Motion: a `duration-fast`/`ease-standard` transition is scoped to
 *   background-color and border-color so the checked/unchecked swap reads as
 *   a deliberate state change (Req 16.1) without animating layout.
 *
 * Consumed by `TaskItem` to render the completion toggle. `checked`,
 * `onCheckedChange`, `disabled`, and every other Radix prop are forwarded
 * untouched so the optimistic mutation in `useToggleTaskCompletion` stays the
 * single source of truth for completion state.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-16 w-16 shrink-0 rounded-sm border border-border bg-surface transition-[background-color,border-color] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-on-primary',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn('flex items-center justify-center text-current')}
    >
      <Check className="h-16 w-16" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
