import * as React from 'react'

import { useProfile, type AccentKey } from '@/hooks/useProfile'

/**
 * Applies the user's accent preference to the document root.
 *
 * `accent` swaps `--color-primary` / `--color-focus-ring` /
 * `--color-primary-container` to the chosen preset. Cleared back
 * to defaults when 'default' is selected.
 *
 * The provider doesn't render any DOM of its own — it's just an
 * effect carrier so the `<RouterProvider>` tree below can use the
 * applied tokens immediately.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const profile = useProfile()
  const accent = profile.data?.accent ?? 'default'

  // Accent — write CSS variable overrides on <html>.
  React.useEffect(() => {
    const root = document.documentElement
    const preset = ACCENT_PRESETS[accent]
    if (!preset) return
    if (preset.primary) {
      root.style.setProperty('--color-primary', preset.primary)
      root.style.setProperty('--color-focus-ring', preset.primary)
      root.style.setProperty('--color-accent', preset.primary)
    } else {
      // Default — clear any previously-set inline overrides.
      root.style.removeProperty('--color-primary')
      root.style.removeProperty('--color-focus-ring')
      root.style.removeProperty('--color-accent')
      root.style.removeProperty('--color-primary-container')
      root.style.removeProperty('--color-on-primary-container')
    }
    if (preset.container) {
      root.style.setProperty('--color-primary-container', preset.container)
      root.style.setProperty(
        '--color-on-primary-container',
        preset.onContainer ?? '#ffffff',
      )
    }
  }, [accent])

  return <>{children}</>
}

interface AccentPreset {
  primary: string | null
  container: string | null
  onContainer: string | null
}

const ACCENT_PRESETS: Record<AccentKey, AccentPreset> = {
  default: { primary: null, container: null, onContainer: null },
  blue: {
    primary: '#1a73e8',
    container: '#e8f0fe',
    onContainer: '#174ea6',
  },
  green: {
    primary: '#137333',
    container: '#e6f4ea',
    onContainer: '#0b5429',
  },
  amber: {
    primary: '#b06000',
    container: '#fef7e0',
    onContainer: '#704000',
  },
  rose: {
    primary: '#c5221f',
    container: '#fce8e6',
    onContainer: '#a50e0e',
  },
  violet: {
    primary: '#7e57c2',
    container: '#ede7f6',
    onContainer: '#5e35b1',
  },
  mono: {
    primary: '#1f1f1f',
    container: '#f1f3f4',
    onContainer: '#1f1f1f',
  },
}

export const ACCENT_OPTIONS: Array<{ key: AccentKey; label: string; swatch: string }> = [
  { key: 'default', label: 'Default', swatch: '#1a73e8' },
  { key: 'blue', label: 'Blue', swatch: '#1a73e8' },
  { key: 'green', label: 'Forest', swatch: '#137333' },
  { key: 'amber', label: 'Amber', swatch: '#b06000' },
  { key: 'rose', label: 'Rose', swatch: '#c5221f' },
  { key: 'violet', label: 'Violet', swatch: '#7e57c2' },
  { key: 'mono', label: 'Mono', swatch: '#1f1f1f' },
]
