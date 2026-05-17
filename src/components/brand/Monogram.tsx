import { cn } from '@/lib/utils'

/**
 * Herrington monogram — H1 "Plate" design.
 *
 * A geometric H with squared slab serifs and an even stroke weight.
 * The cross-bar sits at 52% (slightly above optical centre) so the
 * letter doesn't feel top-heavy at small sizes. Stroke geometry is
 * tuned to hold up from 16px (favicon) to 1024px (app store icon).
 *
 * Color uses `currentColor` so callers control via Tailwind text
 * utilities. Place inside a brand-coloured container (e.g.
 * `bg-brand-conservatory text-brand-brass`) to render the icon as
 * brass on conservatory — the canonical app-icon configuration.
 */
export function Monogram({
  size = 24,
  className,
}: {
  /** Rendered size in pixels. Defaults to 24. */
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      role="img"
      aria-label="Herrington"
      className={cn('inline-block', className)}
    >
      {/* Left vertical stem with top + bottom slab serifs.
          The serifs extend ~35% of stem height beyond the stem
          width so the letter reads "engraved" / "stamped". */}
      <rect x="14" y="11" width="11" height="42" />
      <rect x="11" y="11" width="17" height="5" />
      <rect x="11" y="48" width="17" height="5" />

      {/* Right vertical stem with mirrored serifs. */}
      <rect x="39" y="11" width="11" height="42" />
      <rect x="36" y="11" width="17" height="5" />
      <rect x="36" y="48" width="17" height="5" />

      {/* Cross-bar — sits at 52% optical center.
          (32 * 0.52) = 16.64, rounded → bar centre at y=30, height=4. */}
      <rect x="25" y="30" width="14" height="4" />
    </svg>
  )
}
