import * as React from 'react'

import { getUserTimezone } from '@/lib/timezone'

/**
 * Time-of-day awareness hooks.
 *
 *   - `useLocalHour()` — returns the current hour (0–23) in the user's
 *     local timezone, refreshed once a minute.
 *   - `useTimeOfDay()` — coarse-grained bucket of the current hour
 *     (early / morning / midday / afternoon / evening / night), used
 *     by features like the Break Engine to bias suggestions to the
 *     current vibe of the day.
 *
 * Both hooks recompute on a 60s `setInterval`, which is cheap and
 * simple. We don't subscribe to `visibilitychange` because if the tab
 * is hidden we don't care about the value being slightly stale —
 * the next interaction will trigger a re-render and the value updates.
 */

function getLocalHour(timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(new Date())
    const hourPart = parts.find((p) => p.type === 'hour')
    if (hourPart) {
      const n = Number.parseInt(hourPart.value, 10)
      // Some locales emit "24" for midnight in 24h mode; normalize.
      if (Number.isFinite(n)) return n === 24 ? 0 : n
    }
  } catch {
    // fall through
  }
  return new Date().getHours()
}

export function useLocalHour(): number {
  const tz = React.useMemo(() => getUserTimezone(), [])
  const [hour, setHour] = React.useState(() => getLocalHour(tz))

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setHour(getLocalHour(tz))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [tz])

  return hour
}

/**
 * Coarse-grained time of day bucket. We expose this rather than the
 * raw hour so prompts and UI can branch on meaningful chunks instead
 * of magic numbers.
 */
export type TimeOfDay =
  | 'early'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'evening'
  | 'night'

export function useTimeOfDay(): TimeOfDay {
  const hour = useLocalHour()
  return bucketHour(hour)
}

export function bucketHour(hour: number): TimeOfDay {
  if (hour >= 4 && hour < 6) return 'early'
  if (hour >= 6 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'midday'
  if (hour >= 14 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}
