import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from '@/lib/utils'

/**
 * shadcn/ui Label primitive — refactored for the Google-style Design_System.
 *
 * Wraps Radix `LabelPrimitive.Root` to inherit click-to-focus association
 * through `htmlFor` (Requirement 8.2) and layers on token-backed typography
 * (Type_Scale `label` step) plus `peer-disabled:*` utilities so the label
 * visually dims when an adjacent disabled input carries the `peer` class.
 *
 * When `optional` is `true`, the visible label text is suffixed with the
 * plain text ` (optional)` (note the leading space) rendered as a regular
 * text node so screen readers read it as part of the control's accessible
 * name (Requirement 8.3).
 *
 * Composed field pattern (used by both create forms — see `input.tsx` for
 * the full example): Label + Input + caption-level error `<p>` wired via
 * `aria-describedby` (Requirements 8.2, 8.3, 8.4, 11.6):
 *
 *   <div className="flex flex-col gap-4">
 *     <Label htmlFor="title" optional>Title</Label>
 *     <Input
 *       id="title"
 *       aria-invalid={!!error}
 *       aria-describedby={error ? 'title-error' : undefined}
 *     />
 *     {error && (
 *       <p id="title-error" className="text-caption text-error">{error}</p>
 *     )}
 *   </div>
 *
 * Requirements: 4.4, 8.1, 8.2, 8.3, 8.4, 11.1, 11.2, 11.6
 */
type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  /**
   * When `true`, appends the text " (optional)" after the label's children
   * so assistive tech reads the field's optionality as part of the
   * accessible name.
   */
  optional?: boolean
}

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, optional, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-label font-medium leading-none text-on-surface',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    {optional ? ' (optional)' : null}
  </LabelPrimitive.Root>
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
