/**
 * Returns the user's IANA timezone identifier (e.g., "Asia/Jakarta", "America/New_York").
 *
 * Used to satisfy Requirement 7.5: every Check_Off request must carry a valid
 * IANA zone so the server can compute the correct local day for streak math.
 *
 * Falls back to `'UTC'` if `Intl.DateTimeFormat` is unavailable or does not
 * populate `resolvedOptions().timeZone` (very old browsers).
 */
export function getUserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof tz === 'string' && tz.length > 0) return tz
  } catch {
    // fall through to UTC fallback
  }
  return 'UTC'
}
