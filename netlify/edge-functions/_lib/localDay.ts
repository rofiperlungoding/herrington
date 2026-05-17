/**
 * Local-day boundary computation for server-side streak logic.
 *
 * This module is imported by the Habit_Service edge function (see
 * `netlify/edge-functions/habits.ts`) to derive the `Local_Today`
 * value consumed by `computeNextStreak`. It is a pure function — no
 * I/O, no globals beyond `Intl` and `Date` — and is therefore safe
 * to run inside a Deno/Netlify Edge runtime.
 *
 * ## What it returns
 *
 * `localDayStartSeconds(nowMs, timezone)` returns the Unix-seconds
 * representation of **midnight UTC of the user's local calendar
 * day** on the instant `nowMs`, as observed in the IANA `timezone`.
 *
 * Concretely: given the current UTC instant `nowMs`, it asks
 * `Intl.DateTimeFormat` what calendar date that instant falls on in
 * `timezone`, then encodes that y/m/d triple as `Date.UTC(...) / 1000`.
 *
 * ## Why midnight-UTC encoding
 *
 * The streak algorithm (see `src/shared/streak/computeNextStreak.ts`
 * and the "Streak Computation Algorithm" section of the design doc)
 * needs only three operations on `lastCompletedDate`:
 *
 *   1. Equality with today            → Requirement 7.4 idempotency
 *   2. Adjacency with today (− 86400) → Requirement 7.2 increment
 *   3. Ordering (older than yesterday)→ Requirement 7.3 reset
 *
 * Representing each local calendar day as a fixed integer (midnight
 * UTC of that date) reduces "yesterday in the user's local tz" to
 * `today - 86400`, pure integer arithmetic. This sidesteps the DST
 * and zone-offset bugs that plague naive `new Date(...).getDate() - 1`
 * implementations: the stored value is an opaque day-key, not a
 * wall-clock timestamp, so arithmetic on it cannot cross a DST edge
 * and produce an off-by-one hour that collapses adjacency into
 * equality (or vice versa).
 *
 * The `'en-CA'` locale is chosen because it formats dates as
 * `YYYY-MM-DD`, giving `formatToParts` a predictable `{year, month,
 * day}` shape independent of the host locale.
 */
export function localDayStartSeconds(nowMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs))

  const y = Number(parts.find(p => p.type === 'year')!.value)
  const m = Number(parts.find(p => p.type === 'month')!.value)
  const d = Number(parts.find(p => p.type === 'day')!.value)

  return Math.floor(Date.UTC(y, m - 1, d) / 1000)
}
