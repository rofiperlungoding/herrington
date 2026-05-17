import { cn } from '@/lib/utils'

/**
 * Herrington wordmark.
 *
 * The brand name set in Fraunces (the display face configured in
 * `tokens.css`). Lowercase, slightly tracked-out for the editorial
 * feel that pairs with the Conservatory palette.
 *
 * Sizing is driven by Tailwind text utilities (`text-title`,
 * `text-headline`, `text-display`) so callers stay inside the
 * project's locked typography scale. Color defaults to the inherited
 * text color so the wordmark adopts whatever surface it sits on; pass
 * `className="text-brand-ink"` (etc.) to override on brand surfaces.
 */
export function Wordmark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizeClass =
    size === 'sm'
      ? 'text-title'
      : size === 'md'
        ? 'text-headline'
        : size === 'lg'
          ? 'text-display'
          : 'text-display md:text-[3.5rem] md:leading-[1.05]'

  return (
    <span
      aria-label="Herrington"
      className={cn(
        'font-display font-medium tracking-tight lowercase',
        sizeClass,
        className,
      )}
    >
      herrington
    </span>
  )
}
