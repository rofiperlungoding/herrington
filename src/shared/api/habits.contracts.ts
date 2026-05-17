/**
 * Zod contracts for the Habits API.
 *
 * Imported by:
 *   - the Client (via `apiFetch`) to parse and validate API responses
 *     (Requirement 9.6: schema-failure rollback).
 *   - the Netlify Edge Functions to validate incoming request bodies
 *     before executing any Drizzle query (Requirement 6.2, 7.5).
 *
 * This module must stay Deno-compatible: no Node-only imports, only `zod`.
 */

import { z } from 'zod';

/**
 * Validates that a string is a recognized IANA time zone identifier.
 *
 * Uses the standard `Intl.DateTimeFormat` round-trip trick: constructing a
 * formatter with an unsupported `timeZone` throws a `RangeError`. This works
 * identically in browsers and in Deno (Netlify Edge runtime), and avoids
 * shipping a static zone table.
 */
export function isValidIanaZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const HabitKind = z.enum(['daily', 'one_time']);
export type HabitKindValue = z.infer<typeof HabitKind>;

/**
 * Canonical shape of a habit row as returned by the API.
 *
 * Mirrors the `habits` Drizzle table in `src/shared/db/schema.ts`:
 *   - `currentStreak` and `longestStreak` are non-negative integers
 *     (Requirement 7.1–7.3).
 *   - `lastCompletedDate` is a unix-seconds integer representing midnight
 *     UTC of the user's Local_Today on the last check-off, or `null` if the
 *     habit has never been checked off.
 *   - `kind` distinguishes a recurring "daily" habit from a single
 *     "one_time" goal. One-time habits are deleted from the DB once
 *     completed; daily ones recur forever and reset at midnight.
 */
export const HabitDTO = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().min(1),
  kind: HabitKind.default('daily'),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  lastCompletedDate: z.number().nullable(),
});

/**
 * Response envelope for `GET /api/habits`.
 */
export const HabitListResponse = z.object({
  habits: z.array(HabitDTO),
});

/**
 * Request body for `POST /api/habits`.
 *
 * The server trims `title`; empty/whitespace-only values are rejected with
 * HTTP 400 (Requirement 6.2). `kind` defaults to 'daily' for backward
 * compatibility with the original UI (which only created daily habits).
 */
export const CreateHabitRequest = z.object({
  title: z.string().min(1),
  kind: HabitKind.optional(),
});

/**
 * Request body for `PATCH /api/habits/:id`.
 *
 * Only `title` is editable; streak fields (`currentStreak`, `longestStreak`,
 * `lastCompletedDate`) are immutable through this endpoint and are updated
 * exclusively by the check-off flow (Requirement 6.4).
 */
export const UpdateHabitRequest = z.object({
  title: z.string().min(1),
});

/**
 * Request body for `POST /api/habits/:id/check-off` (Requirement 7.5).
 *
 * The client supplies its IANA time zone so the server can compute
 * `Local_Today` and drive the streak state machine in
 * `computeNextStreak`.
 */
export const CheckOffRequest = z.object({
  timezone: z.string().refine(isValidIanaZone, 'invalid timezone'),
});

export type Habit = z.infer<typeof HabitDTO>;
export type HabitListResponseBody = z.infer<typeof HabitListResponse>;
export type CreateHabitRequestBody = z.infer<typeof CreateHabitRequest>;
export type UpdateHabitRequestBody = z.infer<typeof UpdateHabitRequest>;
export type CheckOffRequestBody = z.infer<typeof CheckOffRequest>;
