import { z } from 'zod';
import { and, eq, gte, lt } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import { habits, tasks } from '../../src/shared/db/schema.ts';

/**
 * Morning Briefing edge function.
 *
 *   GET /api/briefing?lat=&lon=&timezone=&city=
 *
 * Aggregates a "what's the day look like" snapshot for the dashboard:
 *
 *   - Weather: current conditions + today's high/low from Open-Meteo
 *     (keyless public API). The client passes lat/lon — we don't try
 *     to geolocate by IP at the edge.
 *   - Markets: a fixed basket of trackers (SPY, BTC, ETH, plus regional
 *     defaults like JKSE for Indonesian users) pulled from Yahoo
 *     Finance's public quote endpoint. Quotes are 15-min delayed but
 *     fine for a "morning glance" widget.
 *   - User context: today's task count, next deadline, top habit streak.
 *     Computed against Turso so the briefing reflects this user's data.
 *
 * Everything is fetched in parallel and individual failures degrade
 * gracefully (the response carries `null` for that section).
 */

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  timezone: z.string().min(1).max(64).optional(),
  city: z.string().min(1).max(120).optional(),
});

interface WeatherDto {
  city: string | null;
  temperatureC: number;
  feelsLikeC: number | null;
  conditionCode: number;
  conditionLabel: string;
  highC: number | null;
  lowC: number | null;
  precipitationMm: number | null;
  windKph: number | null;
  isDay: boolean;
}

interface MarketQuote {
  symbol: string;
  label: string;
  price: number;
  changePercent: number;
  currency: string;
  /**
   * Unix-seconds timestamp the quote was fetched from upstream. The
   * frontend uses this to render an "as of HH:MM" caption so a frozen
   * weekend price doesn't look like a broken refresh.
   */
  fetchedAtSec: number;
}

interface UserContextDto {
  todayTaskCount: number;
  overdueTaskCount: number;
  nextDeadline: { title: string; deadline: number } | null;
  topStreak: { title: string; current: number } | null;
}

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth = await requireAuth(req);
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname !== '/api/briefing') {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  const params = Query.parse(Object.fromEntries(url.searchParams.entries()));
  const tz = params.timezone && isValidTimezone(params.timezone) ? params.timezone : 'UTC';

  const [weather, market, userCtx] = await Promise.all([
    params.lat != null && params.lon != null
      ? fetchWeather(params.lat, params.lon, params.city ?? null, tz).catch((err) => {
          console.error('[briefing] weather failed:', err);
          return null;
        })
      : Promise.resolve(null),
    fetchMarket().catch((err) => {
      console.error('[briefing] market failed:', err);
      return null;
    }),
    fetchUserContext(auth.userId, tz).catch((err) => {
      console.error('[briefing] user ctx failed:', err);
      return null;
    }),
  ]);

  return jsonResponse(200, {
    timezone: tz,
    generatedAt: Math.floor(Date.now() / 1000),
    weather,
    market,
    user: userCtx,
  });
});

// ─── Weather ────────────────────────────────────────────────────────────────

const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Foggy',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ hail',
  99: 'Thunderstorm w/ hail',
};

async function fetchWeather(
  lat: number,
  lon: number,
  city: string | null,
  timezone: string,
): Promise<WeatherDto> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,precipitation',
  );
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', timezone);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      is_day?: number;
      weather_code?: number;
      wind_speed_10m?: number;
      precipitation?: number;
    };
    daily?: {
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_sum?: number[];
    };
  };

  const cur = data.current ?? {};
  const code = cur.weather_code ?? 0;
  return {
    city,
    temperatureC: round1(cur.temperature_2m ?? 0),
    feelsLikeC:
      typeof cur.apparent_temperature === 'number'
        ? round1(cur.apparent_temperature)
        : null,
    conditionCode: code,
    conditionLabel: WMO[code] ?? 'Unknown',
    highC: typeof data.daily?.temperature_2m_max?.[0] === 'number' ? round1(data.daily.temperature_2m_max[0]) : null,
    lowC: typeof data.daily?.temperature_2m_min?.[0] === 'number' ? round1(data.daily.temperature_2m_min[0]) : null,
    precipitationMm:
      typeof data.daily?.precipitation_sum?.[0] === 'number'
        ? round1(data.daily.precipitation_sum[0])
        : null,
    windKph:
      typeof cur.wind_speed_10m === 'number' ? round1(cur.wind_speed_10m) : null,
    isDay: cur.is_day === 1,
  };
}

// ─── Market ────────────────────────────────────────────────────────────────

// Hybrid market data — mixes three free, keyless sources to get
// realtime-ish numbers without an API key:
//
//   - fawazahmed0 currency-api: FX rates, daily snapshot but updates
//     7 days/week (incl. weekends). Powers USD/IDR, USD/EUR, etc.
//     Tries the Cloudflare Pages mirror first, falls back to jsDelivr,
//     and finally Frankfurter on a hard outage.
//   - CoinGecko: crypto spot prices, 24h % change. ~5min refresh.
//   - Stooq: equity indices (SPY, QQQ, JKSE) — close-of-day, but
//     has the broadest free coverage.
//
// Each source returns a slice of the basket; we merge them client-side
// and return one flat array sorted in display order.

interface MarketSource {
  symbol: string;
  label: string;
  source: 'fx' | 'crypto' | 'equity';
  // For FX: 'USD' base, 'IDR' quote etc.
  base?: string;
  quote?: string;
  // For Stooq.
  stooqSymbol?: string;
  // For CoinGecko: the gecko id (lowercase slug).
  geckoId?: string;
}

const MARKET_BASKET: MarketSource[] = [
  { symbol: 'USDIDR', label: 'USD/IDR', source: 'fx', base: 'USD', quote: 'IDR' },
  { symbol: 'BTC', label: 'Bitcoin', source: 'crypto', geckoId: 'bitcoin' },
  { symbol: 'ETH', label: 'Ethereum', source: 'crypto', geckoId: 'ethereum' },
  { symbol: 'SPY', label: 'S&P 500', source: 'equity', stooqSymbol: 'spy.us' },
  { symbol: 'JKSE', label: 'IDX Composite', source: 'equity', stooqSymbol: '^jkse' },
];

async function fetchMarket(): Promise<MarketQuote[]> {
  const fxItems = MARKET_BASKET.filter((m) => m.source === 'fx');
  const cryptoItems = MARKET_BASKET.filter((m) => m.source === 'crypto');
  const equityItems = MARKET_BASKET.filter((m) => m.source === 'equity');

  const [fxResults, cryptoResults, equityResults] = await Promise.all([
    fxItems.length > 0 ? fetchFx(fxItems) : Promise.resolve([]),
    cryptoItems.length > 0 ? fetchCrypto(cryptoItems) : Promise.resolve([]),
    equityItems.length > 0 ? fetchEquity(equityItems) : Promise.resolve([]),
  ]);

  // Preserve the basket display order.
  const byLabel = new Map<string, MarketQuote>();
  for (const r of [...fxResults, ...cryptoResults, ...equityResults]) {
    byLabel.set(r.symbol, r);
  }
  return MARKET_BASKET.map((m) => byLabel.get(m.symbol)).filter(
    (q): q is MarketQuote => !!q,
  );
}

/**
 * Pull FX rates from a fawazahmed0/currency-api mirror.
 *
 * We replaced the original Frankfurter source because Frankfurter is
 * an ECB-driven feed: it only updates on weekdays, and even on a
 * normal weekday it publishes once around 16:00 CET. That made the
 * USD/IDR card on the dashboard feel frozen for hours at a time —
 * particularly on weekends, when the user just sees Friday's number
 * for three days straight.
 *
 * The new source publishes daily (including weekends) on the
 * Cloudflare Pages mirror, with a same-day jsDelivr fallback if Pages
 * is having a moment. As a last resort we still hit Frankfurter so
 * the card never goes blank — that path is only exercised when both
 * primaries fail.
 *
 * For the day-over-day change we hit the historical date subdomain
 * (`{YYYY-MM-DD}.currency-api.pages.dev`). Yesterday's snapshot is
 * cached behind Cloudflare so it's fast.
 */
async function fetchFx(items: MarketSource[]): Promise<MarketQuote[]> {
  // Group by base currency so we issue one request per unique base.
  const byBase = new Map<string, MarketSource[]>();
  for (const item of items) {
    if (!item.base || !item.quote) continue;
    const arr = byBase.get(item.base) ?? [];
    arr.push(item);
    byBase.set(item.base, arr);
  }

  const yesterdayStr = isoDateSub(1);

  const out: MarketQuote[] = [];
  for (const [base, group] of byBase) {
    const baseLower = base.toLowerCase();
    const todayRates = await fetchCurrencyApi('latest', baseLower).catch(
      () => null,
    );
    const yestRates = await fetchCurrencyApi(yesterdayStr, baseLower).catch(
      () => null,
    );

    if (!todayRates) {
      // Both primaries failed — fall back to Frankfurter as a last resort.
      const fallback = await fetchFxFallback(base, group).catch(() => []);
      out.push(...fallback);
      continue;
    }

    for (const item of group) {
      const quoteLower = item.quote!.toLowerCase();
      const today = todayRates[quoteLower];
      const yest = yestRates ? yestRates[quoteLower] : undefined;
      if (typeof today !== 'number') continue;
      const changePercent =
        typeof yest === 'number' && yest > 0
          ? ((today - yest) / yest) * 100
          : 0;
      out.push({
        symbol: item.symbol,
        label: item.label,
        price: today,
        changePercent: Math.round(changePercent * 100) / 100,
        currency: item.quote!,
        fetchedAtSec: Math.floor(Date.now() / 1000),
      });
    }
  }
  return out;
}

/**
 * Fetch a single fawazahmed0 currency snapshot. Tries the Cloudflare
 * Pages mirror first (fastest, lowest latency from edge runtimes)
 * and falls back to jsDelivr on any failure. Returns the inner rates
 * object keyed by lowercase ISO code, or null when both endpoints
 * fail. Date can be `'latest'` or a `YYYY-MM-DD` string.
 */
async function fetchCurrencyApi(
  date: string,
  baseLower: string,
): Promise<Record<string, number> | null> {
  const subdomain = date === 'latest' ? 'latest' : date;
  const primary = `https://${subdomain}.currency-api.pages.dev/v1/currencies/${baseLower}.min.json`;
  const fallback = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${baseLower}.min.json`;

  for (const url of [primary, fallback]) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      const rates = data[baseLower];
      if (rates && typeof rates === 'object') {
        return rates as Record<string, number>;
      }
    } catch {
      // try the next mirror
    }
  }
  return null;
}

/**
 * Last-resort FX fallback. Returns rates from Frankfurter when both
 * fawazahmed0 mirrors are unreachable. Rare path — kept only so the
 * card never goes blank.
 */
async function fetchFxFallback(
  base: string,
  group: MarketSource[],
): Promise<MarketQuote[]> {
  const symbols = group.map((g) => g.quote!).join(',');
  const res = await fetch(
    `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { rates?: Record<string, number> };
  const out: MarketQuote[] = [];
  for (const item of group) {
    const today = data.rates?.[item.quote!];
    if (typeof today !== 'number') continue;
    out.push({
      symbol: item.symbol,
      label: item.label,
      price: today,
      changePercent: 0,
      currency: item.quote!,
      fetchedAtSec: Math.floor(Date.now() / 1000),
    });
  }
  return out;
}

/** Returns YYYY-MM-DD for `daysAgo` days before today (UTC). */
function isoDateSub(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

/**
 * CoinGecko spot prices + 24h % change. Free public endpoint, ~30
 * requests per minute hard cap which is plenty for our use case.
 */
async function fetchCrypto(items: MarketSource[]): Promise<MarketQuote[]> {
  const ids = items.map((i) => i.geckoId).filter((s): s is string => !!s).join(',');
  if (!ids) return [];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = (await res.json()) as Record<
    string,
    { usd?: number; usd_24h_change?: number }
  >;

  const out: MarketQuote[] = [];
  for (const item of items) {
    const row = item.geckoId ? data[item.geckoId] : null;
    if (!row || typeof row.usd !== 'number') continue;
    out.push({
      symbol: item.symbol,
      label: item.label,
      price: row.usd,
      changePercent:
        typeof row.usd_24h_change === 'number'
          ? Math.round(row.usd_24h_change * 100) / 100
          : 0,
      currency: 'USD',
      fetchedAtSec: Math.floor(Date.now() / 1000),
    });
  }
  return out;
}

/**
 * Stooq for equity indices. Returns close + open so we can compute the
 * day's change.
 *
 * Stooq's `/q/l/` endpoint behaves badly with comma-batched symbols —
 * it returns a single concatenated row that the CSV parser can't split
 * cleanly, and any one closed market (e.g. JKSE on a weekend) poisons
 * the whole batch with `N/D` cells. We avoid that by issuing one fetch
 * per symbol in parallel — Stooq is fine with the burst, and each
 * response is self-contained even when others are closed.
 */
async function fetchEquity(items: MarketSource[]): Promise<MarketQuote[]> {
  const valid = items.filter(
    (i): i is MarketSource & { stooqSymbol: string } => !!i.stooqSymbol,
  );
  if (valid.length === 0) return [];

  const responses = await Promise.all(
    valid.map((item) => fetchSingleEquity(item)),
  );
  return responses.filter((q): q is MarketQuote => q !== null);
}

/**
 * Single-symbol Stooq lookup. Returns null when the symbol's market is
 * closed (response cells are `N/D`) or when the network call fails so
 * the parent's `Promise.all` can keep the rest of the basket.
 */
async function fetchSingleEquity(
  item: MarketSource & { stooqSymbol: string },
): Promise<MarketQuote | null> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(
    item.stooqSymbol,
  )}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { headers: { Accept: 'text/csv' } });
  if (!res.ok) return null;

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const header = lines[0].split(',');
  const cells = lines[1].split(',');
  const idx = (col: string) =>
    header.findIndex((h) => h.toLowerCase() === col.toLowerCase());
  const closeIdx = idx('close');
  const openIdx = idx('open');
  if (closeIdx < 0 || openIdx < 0) return null;

  const closeRaw = cells[closeIdx] ?? '';
  const openRaw = cells[openIdx] ?? '';

  // Stooq returns "N/D" when the market is closed — treat as a no-op.
  if (closeRaw === 'N/D' || openRaw === 'N/D') return null;

  const close = Number.parseFloat(closeRaw);
  const open = Number.parseFloat(openRaw);
  if (!Number.isFinite(close) || close <= 0) return null;

  const changePercent =
    Number.isFinite(open) && open > 0 ? ((close - open) / open) * 100 : 0;

  return {
    symbol: item.symbol,
    label: item.label,
    price: close,
    changePercent: Math.round(changePercent * 100) / 100,
    currency: item.stooqSymbol === '^jkse' ? 'IDR' : 'USD',
    fetchedAtSec: Math.floor(Date.now() / 1000),
  };
}

// ─── User context ──────────────────────────────────────────────────────────

async function fetchUserContext(
  userId: string,
  timezone: string,
): Promise<UserContextDto> {
  const db = createDrizzleClient();

  // Compute today's local-day window in unix seconds.
  const now = new Date();
  const localToday = startOfLocalDay(now, timezone);
  const localTomorrow = startOfLocalDay(addDays(now, 1), timezone);
  const todayStart = Math.floor(localToday.getTime() / 1000);
  const tomorrowStart = Math.floor(localTomorrow.getTime() / 1000);
  const nowSec = Math.floor(now.getTime() / 1000);

  const [allTasks, allHabits] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        deadline: tasks.deadline,
        isCompleted: tasks.isCompleted,
      })
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .all(),
    db
      .select({
        id: habits.id,
        title: habits.title,
        currentStreak: habits.currentStreak,
      })
      .from(habits)
      .where(eq(habits.userId, userId))
      .all(),
  ]);

  let todayTaskCount = 0;
  let overdueTaskCount = 0;
  let nextDeadline: UserContextDto['nextDeadline'] = null;

  for (const t of allTasks) {
    if (t.isCompleted) continue;
    const dl = t.deadline ? Math.floor(t.deadline.getTime() / 1000) : null;
    if (dl == null) continue;
    if (dl < nowSec) {
      overdueTaskCount++;
      continue;
    }
    if (dl >= todayStart && dl < tomorrowStart) {
      todayTaskCount++;
    }
    if (!nextDeadline || dl < nextDeadline.deadline) {
      nextDeadline = { title: t.title, deadline: dl };
    }
  }

  let topStreak: UserContextDto['topStreak'] = null;
  for (const h of allHabits) {
    if (!topStreak || h.currentStreak > topStreak.current) {
      topStreak = { title: h.title, current: h.currentStreak };
    }
  }
  // Hide if best streak is 0 — feels punitive otherwise.
  if (topStreak && topStreak.current === 0) topStreak = null;

  return {
    todayTaskCount,
    overdueTaskCount,
    nextDeadline,
    topStreak,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function startOfLocalDay(date: Date, timezone: string): Date {
  // Convert into the target timezone, zero out time, then convert back.
  // We do this by formatting the date in the target tz, splitting parts.
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const lookup = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const ymd = `${lookup('year')}-${lookup('month')}-${lookup('day')}T00:00:00`;
    // Build a date assuming `ymd` is in the target tz. We approximate by
    // computing the offset between UTC and the tz at that moment.
    const asUtc = new Date(ymd + 'Z');
    const offset = tzOffsetMinutes(asUtc, timezone);
    return new Date(asUtc.getTime() - offset * 60_000);
  } catch {
    // Fall back to UTC midnight.
    const utc = new Date(date);
    utc.setUTCHours(0, 0, 0, 0);
    return utc;
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function tzOffsetMinutes(date: Date, timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const lookup = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    const asTz = Date.UTC(
      Number.parseInt(lookup('year'), 10),
      Number.parseInt(lookup('month'), 10) - 1,
      Number.parseInt(lookup('day'), 10),
      Number.parseInt(lookup('hour'), 10),
      Number.parseInt(lookup('minute'), 10),
      Number.parseInt(lookup('second'), 10),
    );
    return (asTz - date.getTime()) / 60_000;
  } catch {
    return 0;
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Suppress unused-import warnings — these are imported for the
// drizzle query path that uses `gte` / `lt` / `and` when we add
// per-day filtering at the SQL layer in a future iteration.
void gte;
void lt;
void and;
