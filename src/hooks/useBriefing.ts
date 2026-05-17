import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { createApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'
import { getUserTimezone } from '@/lib/timezone'

/**
 * Morning briefing — weather + market + per-user context.
 *
 * The hook lazily resolves the browser's geolocation on first run and
 * passes lat/lon to the server. If the user denies location, weather
 * stays null but market + user context still come through.
 *
 * Cached for 10 minutes since the briefing is a "glance at the start
 * of the day" widget — refreshing every page mount would be wasteful.
 */

const Weather = z.object({
  city: z.string().nullable(),
  temperatureC: z.number(),
  feelsLikeC: z.number().nullable(),
  conditionCode: z.number(),
  conditionLabel: z.string(),
  highC: z.number().nullable(),
  lowC: z.number().nullable(),
  precipitationMm: z.number().nullable(),
  windKph: z.number().nullable(),
  isDay: z.boolean(),
})
export type WeatherSnapshot = z.infer<typeof Weather>

const MarketQuote = z.object({
  symbol: z.string(),
  label: z.string(),
  price: z.number(),
  changePercent: z.number(),
  currency: z.string(),
  fetchedAtSec: z.number(),
})
export type MarketQuote = z.infer<typeof MarketQuote>

const UserCtx = z.object({
  todayTaskCount: z.number(),
  overdueTaskCount: z.number(),
  nextDeadline: z
    .object({ title: z.string(), deadline: z.number() })
    .nullable(),
  topStreak: z.object({ title: z.string(), current: z.number() }).nullable(),
})
export type UserContext = z.infer<typeof UserCtx>

const BriefingResponse = z.object({
  timezone: z.string(),
  generatedAt: z.number(),
  weather: Weather.nullable(),
  market: z.array(MarketQuote).nullable(),
  user: UserCtx.nullable(),
})
export type Briefing = z.infer<typeof BriefingResponse>

const apiFetch = createApiFetch(getCachedAccessToken)

/**
 * Best-effort one-shot geolocation. Resolves to null if denied, no API,
 * or the browser is taking too long (we don't want to block the
 * dashboard render forever).
 */
function getGeolocation(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 4000)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer)
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      },
      { maximumAge: 5 * 60_000, timeout: 4000 },
    )
  })
}

export const briefingQueryOptions = queryOptions({
  queryKey: ['briefing'] as const,
  queryFn: async () => {
    const tz = getUserTimezone()
    const coords = await getGeolocation()
    const params = new URLSearchParams({ timezone: tz })
    if (coords) {
      params.set('lat', String(coords.lat))
      params.set('lon', String(coords.lon))
    }
    return apiFetch(`/api/briefing?${params.toString()}`, {
      method: 'GET',
      schema: BriefingResponse,
    })
  },
  // Refetch every 60s so the FX/crypto numbers stay live without the
  // user having to reload the page. Background refresh keeps the
  // current data visible until the new payload lands. We also refetch
  // on window-focus so coming back to the tab after a long pause shows
  // fresh numbers immediately rather than waiting for the next tick.
  staleTime: 60_000,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
})

export function useBriefing() {
  return useQuery(briefingQueryOptions)
}
