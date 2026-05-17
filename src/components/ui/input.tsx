import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * shadcn/ui Input primitive — refactored for the Google-style Design_System.
 *
 * Consumes token-backed Tailwind utilities only (no raw hex/rgb/px/ms or
 * cubic-bezier literals) so a token value change propagates without edits
 * here. The element forwards its ref so form libraries and focus managers
 * can address the native `<input>`, and spreads any standard
 * `HTMLInputElement` props (type, value, onChange, aria-invalid, etc.) so
 * consumers like `TaskCreateForm` / `HabitCreateForm` use it as a drop-in.
 *
 * Visual contract (Requirements 4.4, 8.1, 8.5, 8.6, 8.7, 11.2):
 *   • `h-40` minimum touch target, `rounded-md` (Radius_Scale `md`)
 *   • token border in rest (`border-border`) on `bg-surface`
 *   • `focus-visible` swaps border to `primary` and adds the Focus_Ring
 *     (2px ring in `focus-ring` color, 2px offset)
 *   • `aria-invalid="true"` swaps border to `error`
 *   • `disabled` / `aria-disabled="true"` apply reduced opacity and
 *     `not-allowed` cursor
 *
 * Composed field pattern (used by both create forms — Requirements 8.2,
 * 8.3, 8.4, 11.6). This is the canonical way to wire Label + Input + a
 * caption-level error message together so the error is part of the input's
 * accessible description:
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
 * Requirements: 4.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.1, 11.2, 11.6
 */
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-40 w-full rounded-md border border-border bg-surface px-12 py-8',
        'text-body text-on-surface placeholder:text-on-surface-muted',
        'transition-[border-color,box-shadow] duration-fast ease-standard',
        'focus-visible:outline-none',
        'aria-[invalid=true]:border-error',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
        'file:border-0 file:bg-transparent file:text-label file:font-medium',
        className,
      )}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
