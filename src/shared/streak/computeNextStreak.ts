/**
 * Pure streak transition function for the Habit Tracker.
 *
 * This module is imported by both the Netlify Edge Function (Deno) that
 * handles `POST /api/habits/:id/check-off` and by the React client, which
 * may use it to predict optimistic streak values. It must therefore remain:
 *
 *   - Pure: no side effects, no I/O, no `Date.now()`, no globals.
 *   - Deno-compatible: no Node built-ins or Node-only imports.
 *
 * `Local_Today` is the Unix-seconds timestamp of 00:00:00 on the user's
 * local calendar day, represented as midnight UTC of that date. Adjacency
 * checks therefore reduce to integer arithmetic on 86400-second steps,
 * which avoids DST and zone-offset pitfalls.
 */

/**
 * State of a habit's streak fields at a point in time.
 *
 * `lastCompletedDate` is Unix seconds representing midnight UTC of the
 * `Local_Today` on which the habit was last checked off. `null` means the
 * habit has never been checked off.
 */
export type StreakState = {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: number | null;
};

/**
 * Discriminated result of `computeNextStreak`. The `kind` tag records which
 * branch of the transition was taken so callers (and tests) can reason about
 * behaviour without inspecting the numeric fields.
 *
 *   - `first`       — the first-ever check-off; streak becomes 1.
 *   - `idempotent`  — same `Local_Today` as the previous check-off; state unchanged.
 *   - `increment`   — previous check-off was yesterday; streak increases by 1.
 *   - `reset`       — previous check-off was 2+ days ago; streak restarts at 1.
 */
export type StreakTransition =
  | { kind: 'idempotent'; next: StreakState }
  | { kind: 'first'; next: StreakState }
  | { kind: 'increment'; next: StreakState }
  | { kind: 'reset'; next: StreakState };

const SECONDS_PER_DAY = 86400;

/**
 * Pure. Given the previous habit state and `Local_Today` (midnight UTC
 * seconds of the user's local calendar day), return the next state and the
 * kind of transition that was applied.
 *
 *   - `null`            -> `first`       : streak = 1
 *   - equal to today    -> `idempotent`  : state unchanged (Requirement 7.4)
 *   - exactly yesterday -> `increment`   : streak += 1 (Requirement 7.2)
 *   - otherwise (older) -> `reset`       : streak = 1, `longestStreak` unchanged
 *                                          (Requirement 7.3)
 */
export function computeNextStreak(
  prev: StreakState,
  localToday: number,
): StreakTransition {
  if (prev.lastCompletedDate === null) {
    return {
      kind: 'first',
      next: {
        currentStreak: 1,
        longestStreak: Math.max(prev.longestStreak, 1),
        lastCompletedDate: localToday,
      },
    };
  }

  if (prev.lastCompletedDate === localToday) {
    // Same local day -> idempotent (Requirement 7.4)
    return { kind: 'idempotent', next: prev };
  }

  const yesterday = localToday - SECONDS_PER_DAY;

  if (prev.lastCompletedDate === yesterday) {
    // Consecutive day (Requirement 7.2)
    const newStreak = prev.currentStreak + 1;
    return {
      kind: 'increment',
      next: {
        currentStreak: newStreak,
        longestStreak: Math.max(prev.longestStreak, newStreak),
        lastCompletedDate: localToday,
      },
    };
  }

  // prev.lastCompletedDate < yesterday, i.e. 2+ days ago (Requirement 7.3)
  return {
    kind: 'reset',
    next: {
      currentStreak: 1,
      longestStreak: prev.longestStreak, // unchanged per Requirement 7.3
      lastCompletedDate: localToday,
    },
  };
}
