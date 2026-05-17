import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowUpRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Flame,
  Moon,
  Sun,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { useBriefing, type WeatherSnapshot } from '@/hooks/useBriefing'
import { useProfile } from '@/hooks/useProfile'
import { Avatar } from '@/components/profile/Avatar'
import { cn } from '@/lib/utils'

/**
 * Dashboard / morning briefing — editorial layout.
 *
 * Design principles (2026-leaning, but minimalist):
 *
 * 1. Editorial hero. The greeting takes display-sized typography that
 *    fills the top. Live clock + date sit underneath as a small tag.
 *
 * 2. Time-aware ambient gradient. A very faint, animated radial
 *    gradient behind the hero shifts hue with time of day —
 *    warm-orange in the morning, soft-blue at midday, deep-violet
 *    at night. Subtle enough to be ambience, not decoration.
 *
 * 3. Asymmetric bento. The "Today" card is the primary surface and
 *    spans more columns than Weather. Markets gets the full row at
 *    the bottom. Tiles have varied heights for that magazine feel.
 *
 * 4. Animated numbers. Task counts count up on first paint so the
 *    page feels alive without being noisy.
 *
 * 5. Subtle hover lift. Tiles translate up 2px on hover with a soft
 *    shadow — Apple/Linear vibe, no aggressive shadows.
 *
 * 6. No icons-on-everything. Icons appear where they earn meaning
 *    (weather condition, market direction, streak flame).
 */
export const Route = createFileRoute('/_authed/')({
  component: DashboardPage,
})

function DashboardPage() {
  const briefing = useBriefing()
  const profile = useProfile()
  const time = useLiveTime()

  const name = profile.data?.preferredName || profile.data?.displayName || ''
  const greeting = React.useMemo(
    () => greetingForHour(time.hour, name),
    [time.hour, name],
  )
  const dateLabel = React.useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [],
  )

  const usdIdr = briefing.data?.market?.find((m) => m.symbol === 'USDIDR') ?? null
  const otherMarkets = briefing.data?.market?.filter((m) => m.symbol !== 'USDIDR') ?? null

  const showMarkets = profile.data?.showMarkets ?? true
  const showWeather = profile.data?.showWeather ?? true

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-32 p-24 md:p-32">
      <Hero
        greeting={greeting}
        dateLabel={dateLabel}
        time={time}
        avatar={
          <Avatar
            name={name || 'User'}
            emoji={profile.data?.avatarEmoji ?? null}
            color={profile.data?.avatarColor ?? null}
            size={48}
          />
        }
        location={profile.data?.locationLabel ?? null}
      />

      <div className="anim-stagger grid gap-16 md:grid-cols-3">
        <div
          className={cn(
            'md:col-span-2',
            !showMarkets && !showWeather && 'md:col-span-3',
          )}
          style={{ ['--anim-i' as string]: 0 }}
        >
          <TodayCard
            loading={briefing.isPending}
            today={briefing.data?.user?.todayTaskCount ?? 0}
            overdue={briefing.data?.user?.overdueTaskCount ?? 0}
            nextDeadline={briefing.data?.user?.nextDeadline ?? null}
            topStreak={briefing.data?.user?.topStreak ?? null}
          />
        </div>
        {showMarkets && (
          <div style={{ ['--anim-i' as string]: 1 }}>
            <UsdIdrCard loading={briefing.isPending} quote={usdIdr} />
          </div>
        )}
        {showWeather && (
          <div style={{ ['--anim-i' as string]: 2 }}>
            <WeatherCard
              loading={briefing.isPending}
              weather={briefing.data?.weather ?? null}
              isDay={time.hour >= 6 && time.hour < 18}
            />
          </div>
        )}
        {showMarkets && (
          <div className="md:col-span-3" style={{ ['--anim-i' as string]: 3 }}>
            <MarketCard loading={briefing.isPending} market={otherMarkets} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({
  greeting,
  dateLabel,
  time,
  avatar,
  location,
}: {
  greeting: string
  dateLabel: string
  time: { hour: number; minute: number }
  avatar?: React.ReactNode
  location?: string | null
}) {
  const ambient = ambientGradient(time.hour)
  const hh = time.hour.toString().padStart(2, '0')
  const mm = time.minute.toString().padStart(2, '0')
  const progress = Math.round(((time.hour * 60 + time.minute) / (24 * 60)) * 100)

  return (
    <header className="relative overflow-hidden rounded-lg">
      {/* Faint time-of-day gradient. Pure-CSS radial; sits behind the
          text at low opacity so it never fights for attention. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.18] transition-[background] duration-1000 ease-out"
        style={{ background: ambient }}
      />

      <div className="flex flex-col gap-16 py-32">
        <div className="flex items-center justify-between gap-12">
          <p className="flex items-center gap-8 text-caption text-on-surface-muted">
            <span className="inline-block h-8 w-8 rounded-full bg-success" />
            {dateLabel}
            {location && <span className="text-on-surface-muted">· {location}</span>}
          </p>
          <p className="flex items-baseline gap-8 text-caption text-on-surface-muted">
            <span className="text-label font-semibold tabular-nums text-on-surface">
              {hh}:{mm}
            </span>
            <span>· {progress}% through the day</span>
          </p>
        </div>

        <div className="flex items-center gap-16">
          {avatar}
          <h1 className="font-display font-medium leading-[1.05] tracking-tight text-on-surface text-display md:text-[3.5rem] md:leading-[1.05]">
            {greeting}.
          </h1>
        </div>
      </div>
    </header>
  )
}

function ambientGradient(hour: number): string {
  // Each entry is the dominant accent at that part of the day. Pure
  // CSS radial gradient so we don't need an image asset.
  //
  // Palette is brand-aligned: warm tones lean toward `brand-brass`
  // (#b8924a) for golden/amber moments and `brand-oxblood` (#6e2a2a)
  // for dawn/dusk; cool tones lean toward `brand-conservatory`
  // (#2a3a2e) for evening/night. Each hex is intentionally kept at a
  // very low alpha-equivalent saturation so the gradient reads as
  // ambient rather than themed.
  if (hour >= 4 && hour < 8) {
    // Sunrise — warm brass haze.
    return 'radial-gradient(ellipse at top left, #d8a560 0%, transparent 55%)'
  }
  if (hour >= 8 && hour < 12) {
    // Mid-morning — soft ivory wash, lit from the left.
    return 'radial-gradient(ellipse at top left, #f0e2c0 0%, transparent 55%)'
  }
  if (hour >= 12 && hour < 17) {
    // Afternoon — muted sage drifting in from the right.
    return 'radial-gradient(ellipse at top right, #b8c8b4 0%, transparent 55%)'
  }
  if (hour >= 17 && hour < 20) {
    // Golden hour — deeper brass through warm rust.
    return 'radial-gradient(ellipse at top right, #c98a4a 0%, transparent 55%)'
  }
  if (hour >= 20 && hour < 24) {
    // Evening — conservatory green from the bottom right.
    return 'radial-gradient(ellipse at bottom right, #4a6b54 0%, transparent 55%)'
  }
  // Late night — deep ink with a brass cooling.
  return 'radial-gradient(ellipse at bottom left, #2a3a2e 0%, transparent 55%)'
}

// ─── Today card ────────────────────────────────────────────────────────────

function TodayCard({
  loading,
  today,
  overdue,
  nextDeadline,
  topStreak,
  className,
}: {
  loading: boolean
  today: number
  overdue: number
  nextDeadline: { title: string; deadline: number } | null
  topStreak: { title: string; current: number } | null
  className?: string
}) {
  return (
    <Tile className={className} interactive>
      <Link
        to="/tasks"
        className="flex h-full flex-col justify-between gap-16"
      >
        <div className="flex items-center justify-between">
          <span className="text-caption uppercase tracking-wider text-on-surface-muted">
            Today
          </span>
          <ArrowUpRight
            className="h-16 w-16 text-on-surface-muted opacity-0 transition-opacity group-hover/tile:opacity-100"
            aria-hidden="true"
          />
        </div>

        {loading ? (
          <SkeletonStack lines={3} />
        ) : (
          <div className="flex flex-col gap-12">
            <div className="flex items-baseline gap-12">
              <CountUp
                value={today}
                className="text-[4rem] font-semibold leading-none tracking-tight text-on-surface"
              />
              <span className="text-body text-on-surface-muted">
                task{today === 1 ? '' : 's'} due
              </span>
            </div>

            {overdue > 0 && (
              <p className="flex items-center gap-4 text-caption text-warning">
                <AlertTriangle className="h-12 w-12" aria-hidden="true" />
                {overdue} overdue
              </p>
            )}

            {nextDeadline && (
              <div className="flex flex-col gap-4">
                <p className="text-caption uppercase tracking-wider text-on-surface-muted">
                  Up next
                </p>
                <p className="truncate text-body font-medium text-on-surface">
                  {nextDeadline.title}
                </p>
                <p className="text-caption text-on-surface-muted">
                  {formatDeadline(nextDeadline.deadline)}
                </p>
              </div>
            )}

            {topStreak && (
              <div className="mt-auto flex items-center gap-8 pt-12">
                <Flame className="h-16 w-16 text-warning" aria-hidden="true" />
                <p className="text-caption text-on-surface-muted">
                  <span className="font-semibold text-on-surface">
                    {topStreak.current}-day
                  </span>{' '}
                  streak ·{' '}
                  <span className="font-medium text-on-surface">
                    {topStreak.title}
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </Link>
    </Tile>
  )
}

// ─── USD/IDR card ─────────────────────────────────────────────────────────

function UsdIdrCard({
  loading,
  quote,
}: {
  loading: boolean
  quote: {
    symbol: string
    label: string
    price: number
    changePercent: number
    currency: string
    fetchedAtSec: number
  } | null
}) {
  if (loading || !quote) {
    return (
      <Tile>
        <span className="text-caption uppercase tracking-wider text-on-surface-muted">
          USD / IDR
        </span>
        <SkeletonStack lines={2} />
      </Tile>
    )
  }

  const up = quote.changePercent >= 0
  return (
    <Tile interactive>
      <div className="flex h-full flex-col gap-12">
        <div className="flex items-center justify-between">
          <span className="text-caption uppercase tracking-wider text-on-surface-muted">
            USD / IDR
          </span>
          <span className="text-caption text-on-surface-muted tabular-nums">
            as of {formatTimeOfDay(quote.fetchedAtSec)}
          </span>
        </div>

        <div className="flex items-baseline gap-8">
          <span className="text-display font-semibold leading-none tracking-tight tabular-nums text-on-surface md:text-[3rem]">
            {Math.round(quote.price).toLocaleString()}
          </span>
          <span className="text-caption text-on-surface-muted">IDR / 1 USD</span>
        </div>

        <span
          className={cn(
            'flex items-center gap-4 text-caption font-medium',
            up ? 'text-success' : 'text-error',
          )}
        >
          {up ? (
            <TrendingUp className="h-12 w-12" aria-hidden="true" />
          ) : (
            <TrendingDown className="h-12 w-12" aria-hidden="true" />
          )}
          {up ? '+' : ''}
          {quote.changePercent.toFixed(2)}% vs yesterday
        </span>
      </div>
    </Tile>
  )
}

// ─── Weather card ──────────────────────────────────────────────────────────

function WeatherCard({
  loading,
  weather,
  isDay,
}: {
  loading: boolean
  weather: WeatherSnapshot | null
  isDay: boolean
}) {
  if (loading) {
    return (
      <Tile>
        <span className="text-caption uppercase tracking-wider text-on-surface-muted">
          Weather
        </span>
        <SkeletonStack lines={2} />
      </Tile>
    )
  }

  if (!weather) {
    return (
      <Tile>
        <div className="flex flex-col gap-12">
          <span className="text-caption uppercase tracking-wider text-on-surface-muted">
            Weather
          </span>
          <p className="text-caption text-on-surface-muted">
            Allow location access to see today&apos;s forecast.
          </p>
        </div>
      </Tile>
    )
  }

  const Icon = weatherIcon(weather.conditionCode, weather.isDay)

  return (
    <Tile interactive>
      <div className="flex h-full flex-col gap-12">
        <div className="flex items-center justify-between">
          <span className="text-caption uppercase tracking-wider text-on-surface-muted">
            {weather.city ?? 'Weather'}
          </span>
          <Icon
            className={cn(
              'h-20 w-20',
              isDay ? 'text-warning' : 'text-primary',
            )}
            aria-hidden="true"
          />
        </div>

        <div className="flex items-baseline gap-4">
          <span className="text-[3rem] font-semibold leading-none tracking-tight text-on-surface">
            {Math.round(weather.temperatureC)}
          </span>
          <span className="text-title text-on-surface-muted">°</span>
        </div>

        <p className="text-caption text-on-surface-muted">
          {weather.conditionLabel}
          {weather.highC != null && weather.lowC != null && (
            <>
              {' · '}
              {Math.round(weather.highC)}° / {Math.round(weather.lowC)}°
            </>
          )}
        </p>
      </div>
    </Tile>
  )
}

function weatherIcon(code: number, isDay: boolean) {
  if (code === 0 || code === 1) return isDay ? Sun : Moon
  if (code === 2 || code === 3) return Cloud
  if (code === 45 || code === 48) return CloudFog
  if (code >= 51 && code <= 67) return CloudRain
  if (code >= 71 && code <= 77) return CloudSnow
  if (code >= 80 && code <= 82) return CloudRain
  if (code >= 95) return CloudLightning
  return Cloud
}

// ─── Market card ───────────────────────────────────────────────────────────

function MarketCard({
  loading,
  market,
}: {
  loading: boolean
  market: ReadonlyArray<{
    symbol: string
    label: string
    price: number
    changePercent: number
    currency: string
    fetchedAtSec: number
  }> | null
}) {
  // Newest fetchedAtSec across the basket. Used as a "this card was
  // last refreshed at X" caption so a frozen weekend price doesn't
  // look like a broken request.
  const lastFetched =
    market && market.length > 0
      ? Math.max(...market.map((q) => q.fetchedAtSec))
      : null

  return (
    <Tile>
      <div className="flex flex-col gap-16">
        <div className="flex items-baseline justify-between gap-12">
          <span className="text-caption uppercase tracking-wider text-on-surface-muted">
            Markets
          </span>
          {lastFetched && (
            <span className="text-caption text-on-surface-muted tabular-nums">
              as of {formatTimeOfDay(lastFetched)}
            </span>
          )}
        </div>

        {loading ? (
          <SkeletonStack lines={2} />
        ) : !market || market.length === 0 ? (
          <p className="text-caption text-on-surface-muted">
            Market data is unavailable right now.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-24 gap-y-12 md:grid-cols-5">
            {market.map((q) => (
              <li
                key={q.symbol}
                className="flex flex-col gap-4 border-l-2 border-border pl-12"
              >
                <span className="truncate text-caption text-on-surface-muted">
                  {q.label}
                </span>
                <span className="truncate text-label font-semibold tracking-tight text-on-surface">
                  {formatPrice(q.price)}
                </span>
                <span
                  className={cn(
                    'flex items-center gap-4 text-caption font-medium',
                    q.changePercent >= 0 ? 'text-success' : 'text-error',
                  )}
                >
                  {q.changePercent >= 0 ? (
                    <TrendingUp className="h-12 w-12" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-12 w-12" aria-hidden="true" />
                  )}
                  {q.changePercent >= 0 ? '+' : ''}
                  {q.changePercent.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Tile>
  )
}

// ─── Shared building blocks ────────────────────────────────────────────────

/**
 * Reusable tile primitive — shared rounded container, padding, and
 * optional hover lift used for every dashboard card. The `group/tile`
 * scope lets children opt into hover-only reveals (e.g. the "Open"
 * arrow on the Today tile).
 */
function Tile({
  children,
  className,
  interactive = false,
}: {
  children: React.ReactNode
  className?: string
  interactive?: boolean
}) {
  return (
    <article
      className={cn(
        'group/tile flex flex-col gap-12 rounded-lg border border-border bg-surface p-20',
        'transition-all duration-fast ease-standard',
        interactive &&
          'hover:-translate-y-2 hover:border-border-strong hover:shadow-e1',
        className,
      )}
    >
      {children}
    </article>
  )
}

/**
 * Live-updating local time. Updates every 15s — chosen so the
 * minute-counter never shows a stale value but we don't waste a
 * render every second.
 */
function useLiveTime() {
  const [time, setTime] = React.useState(() => {
    const d = new Date()
    return { hour: d.getHours(), minute: d.getMinutes() }
  })
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date()
      setTime({ hour: d.getHours(), minute: d.getMinutes() })
    }, 15_000)
    return () => window.clearInterval(id)
  }, [])
  return time
}

/**
 * Animated count-up for numeric stats. Easing is ease-out so big
 * numbers settle naturally. Skips the animation entirely for
 * `prefers-reduced-motion`.
 */
function CountUp({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const [displayed, setDisplayed] = React.useState(0)

  React.useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplayed(value)
      return
    }
    const start = performance.now()
    const duration = 700
    const from = displayed
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayed(Math.round(from + (value - from) * eased))
      if (t < 1) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <span className={className} aria-label={String(value)}>
      {displayed}
    </span>
  )
}

function SkeletonStack({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-12 rounded-md bg-surface-variant"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function greetingForHour(hour: number, name?: string): string {
  // Herrington voice: bare time-of-day greetings. "Morning" not
  // "Good morning"; "Up early" stays for the 4-6 window because
  // anything else reads weird. Per BRAND.md voice guidelines.
  const base =
    hour >= 4 && hour < 6
      ? 'Up early'
      : hour >= 6 && hour < 12
        ? 'Morning'
        : hour >= 12 && hour < 18
          ? 'Afternoon'
          : hour >= 18 && hour < 22
            ? 'Evening'
            : 'Late hours'
  return name ? `${base}, ${name}` : base
}

function formatDeadline(unix: number): string {
  const date = new Date(unix * 1000)
  const diff = unix - Math.floor(Date.now() / 1000)
  if (diff < 3600) return `in ${Math.max(0, Math.round(diff / 60))} min`
  if (diff < 86_400)
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatPrice(price: number): string {
  if (price >= 1000) return Math.round(price).toLocaleString()
  if (price >= 1) return price.toFixed(2)
  return price.toFixed(4)
}

/**
 * Render a unix-seconds timestamp as a short "as of" caption — local
 * `HH:MM` if it's today, "Mon HH:MM" on Monday morning when the
 * weekend close is still showing, etc. Keeps the markets card honest
 * about how fresh the displayed numbers are.
 */
function formatTimeOfDay(unixSec: number): string {
  const date = new Date(unixSec * 1000)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
