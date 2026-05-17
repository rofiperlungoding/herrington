/**
 * Client-side local-date helpers.
 *
 * This module is the client counterpart to
 * `netlify/edge-functions/_lib/localDay.ts`. It provides display
 * formatting for task deadlines (`formatLocal`) plus two pure
 * local-day primitives (`localDayStartSeconds`, `isSameLocalDay`)
 * used by optimistic habit-check-off logic to predict the next
 * streak state without a round-trip to the server.
 *
 * Keeping these helpers browser-safe (no Node/Deno APIs) means they
 * can be imported from React components, hooks, and — indirectly via
 * `src/shared/streak/computeNextStreak.ts` — shared between client
 * and edge function with no additional shimming.
 */

/**
 * Module-scope `Intl.DateTimeFormat` instance reused by every
 * `formatLocal` invocation.
 *
 * Constructing `Intl.DateTimeFormat` is non-trivial (locale data
 * resolution, option canonicalisation), so allocating one per row
 * during list renders showed up as GC churn on long task/habit
 * lists. Hoisting the instance to module scope keeps construction
 * cost to exactly one per option permutation across the lifetime of
 * the application — see design strategy `S4.2` and Requirement 9.5.
 *
 * The host-default locale (`undefined`) plus `dateStyle: 'medium'` /
 * `timeStyle: 'short'` produces strings like `"Mar 14, 2025, 9:30 AM"`
 * on en-US or the locale-appropriate equivalent elsewhere.
 */
const dtf = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * Formats a Unix-seconds timestamp as a human-readable date/time
 * string in the user's local timezone.
 *
 * Reuses the module-scope `dtf` instance — the function never
 * constructs a new `Intl.DateTimeFormat` per call, so a list of N
 * `TaskItem`s costs O(1) format-instance allocations (Requirement
 * 9.5).
 *
 * Consumed by `TaskItem` to render `task.deadline` (see design
 * snippet). The input is seconds, not milliseconds, because that is
 * the encoding used throughout the API contracts and database.
 *
 * @param unixSeconds Unix timestamp in seconds.
 * @returns Locale-formatted date/time string.
 */
export function formatLocal(unixSeconds: number): string {
  return dtf.format(new Date(unixSeconds * 1000))
}

/**
 * Client-side mirror of the edge-function helper in
 * `netlify/edge-functions/_lib/localDay.ts`.
 *
 * Returns the Unix-seconds representation of midnight UTC of the
 * user's local calendar day on the instant `nowMs`, as observed in
 * the IANA `timezone`. See the edge-function module's docstring for
 * the full rationale behind the midnight-UTC encoding; in short, it
 * reduces "yesterday in local time" to `today - 86400` regardless of
 * DST transitions, making adjacency and equality checks safe under
 * pure integer arithmetic.
 *
 * This duplicate lives on the client so `useCheckOffHabit` can call
 * `computeNextStreak` with the same `Local_Today` value the server
 * will derive, keeping the optimistic prediction consistent with the
 * server's authoritative update.
 *
 * @param nowMs Unix timestamp in milliseconds (typically `Date.now()`).
 * @param timezone IANA timezone identifier (e.g., `"Asia/Jakarta"`).
 * @returns Midnight-UTC of the local calendar day, in Unix seconds.
 */
export function localDayStartSeconds(nowMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs))

  const y = Number(parts.find(p => p.type === 'year')!.value)
  const m = Number(parts.find(p => p.type === 'month')!.value)
  const d = Number(parts.find(p => p.type === 'day')!.value)

  return Math.floor(Date.UTC(y, m - 1, d) / 1000)
}

/**
 * Returns `true` if both Unix-seconds timestamps fall on the same
 * local calendar day in the given IANA `timezone`.
 *
 * Implemented by reducing each instant to its `localDayStartSeconds`
 * day-key and comparing for equality. Used by `HabitItem` to disable
 * the check-off button when `habit.lastCompletedDate` shares a local
 * day with the current clock (Requirement 7.6).
 *
 * @param unixA First instant, Unix seconds.
 * @param unixB Second instant, Unix seconds.
 * @param timezone IANA timezone identifier.
 * @returns Whether both instants share a local calendar day.
 */
export function isSameLocalDay(
  unixA: number,
  unixB: number,
  timezone: string,
): boolean {
  return (
    localDayStartSeconds(unixA * 1000, timezone) ===
    localDayStartSeconds(unixB * 1000, timezone)
  )
}

// __vendor_stability_test_marker_1778749263303__
