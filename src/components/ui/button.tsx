import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Design_System Button primitive.
 *
 * Five token-backed variants (`primary`, `secondary`, `tonal`, `text`,
 * `destructive`) and three sizes (`default`, `sm`, `icon`). Every visual
 * value is referenced through a Tailwind utility that resolves to a Design
 * Token — no hex, rgb, pixel (other than `0px`/`1px`), millisecond, or
 * cubic-bezier literals appear in this file.
 *
 * The `loading` boolean variant preserves the button's bounding box by
 * hiding the label via `visibility: hidden` (not `display: none`) and
 * overlaying an absolutely-positioned spinner, so the button does not
 * collapse or shift layout when it enters the loading state.
 *
 * `buttonVariants` is exported so other Design_System parts (Dialog
 * footers, EmptyState/ErrorState actions, etc.) can reuse the same variant
 * map via `cn(buttonVariants({ variant: 'text' }), 'extra-class')`.
 *
 * `asChild` delegates rendering to the single child via Radix `Slot`, which
 * lets consumers wrap `<a>` or router `<Link>` components in Button styles
 * without producing invalid nested `<button>` markup. Because `Slot`
 * requires exactly one child, the `loading` spinner and the label-wrapping
 * `[data-content]` span are only rendered when `asChild` is false.
 *
 * Requirements: 4.6, 6.2, 6.7, 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 8.7, 11.1, 11.2
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-8 whitespace-nowrap',
    'text-label font-medium',
    'rounded-md',
    'transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-on-primary hover:shadow-e1 active:translate-y-px',
        secondary:
          'bg-surface text-on-surface border border-border hover:bg-surface-variant',
        tonal:
          'bg-primary-container text-on-primary-container hover:bg-primary-container/80',
        text: 'bg-transparent text-primary hover:bg-primary-container',
        destructive:
          'bg-error text-on-error hover:shadow-e1 active:translate-y-px',
        // Brand variant — brass on conservatory ground. Reserved for
        // brand-tier surfaces (login submit, marketing CTAs, hero
        // confirmations). Do NOT use as a routine product action — that's
        // what `primary` is for. Using it everywhere makes the app feel
        // like heritage cosplay rather than a calm tool.
        brand:
          'bg-brand-conservatory text-brand-brass hover:shadow-e1 active:translate-y-px',
      },
      size: {
        default: 'h-40 px-20',
        sm: 'h-32 px-16',
        icon: 'h-40 w-40 p-0',
      },
      loading: {
        true: 'pointer-events-none [&>[data-content]]:invisible',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
      loading: false,
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/**
 * Absolutely-positioned spinner rendered over the hidden label while the
 * Button is in the `loading` state. Uses `border-current` so it adopts the
 * variant's text color, and `border-t-transparent` to create the classic
 * ring-with-gap shape. `aria-hidden="true"` because the accompanying
 * `aria-busy` on the button itself announces the busy state to AT.
 */
function ButtonSpinner(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="absolute inline-flex h-16 w-16 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'

    // Slot requires exactly one child, so in `asChild` mode we pass the
    // consumer's element through untouched. Callers that need a spinner
    // overlay should compose it themselves or avoid `asChild` + `loading`.
    if (asChild) {
      return (
        <Comp
          className={cn(
            buttonVariants({ variant, size, loading, className }),
          )}
          ref={ref}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, loading, className }),
        )}
        ref={ref}
        aria-busy={loading || undefined}
        {...props}
      >
        <span data-content className="inline-flex items-center gap-8">
          {children}
        </span>
        {loading ? <ButtonSpinner /> : null}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
