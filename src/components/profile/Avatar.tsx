import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Profile avatar — an emoji glyph on a soft tinted disc.
 *
 *   - When `emoji` is set, render the emoji centered on a tinted circle.
 *   - Otherwise, render the first letter of `name` on the tinted circle.
 *   - The tint is derived from `color` (a hex string) when provided,
 *     otherwise from a deterministic hash of the name so users without
 *     an explicit avatar color still get a consistent shade.
 *
 * Sizes are deliberately kept to multiples of 4 so they snap to the
 * design-system spacing scale.
 */
export function Avatar({
  name,
  emoji,
  color,
  size = 32,
  className,
}: {
  name?: string | null
  emoji?: string | null
  color?: string | null
  size?: 24 | 32 | 40 | 48 | 64
  className?: string
}) {
  const tint = color ?? deriveColor(name ?? '')
  const initial = (name ?? 'U').trim().charAt(0).toUpperCase() || 'U'

  const sizeClass = SIZE_CLASS[size]
  const fontSize =
    size <= 24 ? 'text-caption' :
    size <= 32 ? 'text-label' :
    size <= 40 ? 'text-body' :
    size <= 48 ? 'text-title' :
    'text-headline'

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        sizeClass,
        fontSize,
        className,
      )}
      style={{
        background: hexWithAlpha(tint, 0.18),
        color: tint,
      }}
    >
      {emoji ? <span className="leading-none">{emoji}</span> : initial}
    </span>
  )
}

const SIZE_CLASS: Record<number, string> = {
  24: 'h-24 w-24',
  32: 'h-32 w-32',
  40: 'h-40 w-40',
  48: 'h-48 w-48',
  64: 'h-64 w-64',
}

const FALLBACK_PALETTE = [
  '#1a73e8', // blue
  '#1e8e3e', // green
  '#d56e0c', // amber
  '#c5221f', // red
  '#7e57c2', // violet
  '#0097a7', // cyan
  '#e91e63', // pink
]

/** Map a name to one of FALLBACK_PALETTE deterministically. */
function deriveColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length]
}

/** `#RRGGBB` + alpha → `rgba(...)`. */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const num = Number.parseInt(m[1], 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
