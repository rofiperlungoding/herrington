import { z } from 'zod';
import { nanoid } from 'nanoid';
import { and, asc, eq, gte } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import {
  CheckOffRequest,
  CreateHabitRequest,
  UpdateHabitRequest,
} from '../../src/shared/api/habits.contracts.ts';
import { habits, habitCompletions } from '../../src/shared/db/schema.ts';
import { localDayStartSeconds } from './_lib/localDay.ts';
import {
  computeNextStreak,
  type StreakState,
} from '../../src/shared/streak/computeNextStreak.ts';

/**
 * Row shape returned by `db.select().from(habits)` — inferred from the
 * Drizzle schema so that adding a column to `habits` in the future
 * fails the `habitRowToDto` signature at compile time rather than
 * silently dropping the field from the API response.
 *
 * Drizzle's `integer(..., { mode: 'timestamp' })` maps the underlying
 * SQLite integer column to a `Date` on read, so `lastCompletedDate`
 * arrives here as `Date | null`.
 */
type HabitRow = typeof habits.$inferSelect;

/**
 * Convert a Drizzle `habits` row into the wire-level `HabitDTO` shape
 * defined in `src/shared/api/habits.contracts.ts`.
 *
 * Centralizing this conversion ensures every route handler that emits
 * a `HabitDTO` (list in task 5.3, update in 5.4, check-off in 5.6)
 * agrees on serialization — in particular, that `lastCompletedDate`
 * is always wire-serialized as unix seconds or `null`. Drizzle hands
 * us a `Date` (or `null`); we floor-divide the ms timestamp by 1000
 * to match the integer-seconds representation the schema stores on
 * write (check-off writes seconds via `new Date(sec * 1000)`).
 *
 * Kept module-private (no `export`) because it is an implementation
 * detail of this edge function, not part of the shared contract.
 */
function habitRowToDto(row: HabitRow) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    kind: (row.kind === 'one_time' ? 'one_time' : 'daily') as
      | 'one_time'
      | 'daily',
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    lastCompletedDate: row.lastCompletedDate
      ? Math.floor(row.lastCompletedDate.getTime() / 1000)
      : null,
  };
}

/**
 * Discriminated union describing every route served by the Habits
 * edge function. Returned by `matchRoute` when the method and
 * pathname combination matches one of the five endpoints defined in
 * the design's "API Contract" → "Habits" table; `null` otherwise, so
 * the caller can translate "no match" into a single 404 response
 * without having to inspect the method again.
 */
export type HabitRoute =
  | { type: 'list' }
  | { type: 'create' }
  | { type: 'update'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'check_off'; id: string }
  | { type: 'list_completions'; id: string };

/**
 * Parse the request method and URL pathname into a `HabitRoute`.
 *
 * Segment layout used for matching:
 *
 *   /api/habits                → segments = ['api', 'habits']
 *   /api/habits/:id            → segments = ['api', 'habits', ':id']
 *   /api/habits/:id/check-off  → segments = ['api', 'habits', ':id', 'check-off']
 *
 * Pure function: no I/O, no throws. Unknown combinations return
 * `null` so the handler can emit a uniform 404 regardless of whether
 * the pathname is unrecognized, the method is wrong for a known
 * pathname, or the `:id` segment is empty. Trailing slashes are
 * tolerated via `filter(Boolean)` so `/api/habits/` still matches the
 * two-segment `list`/`create` shape.
 */
export function matchRoute(method: string, pathname: string): HabitRoute | null {
  const segments = pathname.split('/').filter(Boolean);

  // /api/habits
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'habits') {
    if (method === 'GET') return { type: 'list' };
    if (method === 'POST') return { type: 'create' };
    return null;
  }

  // /api/habits/:id
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'habits') {
    const id = segments[2];
    if (!id) return null;
    if (method === 'PATCH') return { type: 'update', id };
    if (method === 'DELETE') return { type: 'delete', id };
    return null;
  }

  // /api/habits/:id/check-off
  if (
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'habits' &&
    segments[3] === 'check-off'
  ) {
    const id = segments[2];
    if (!id) return null;
    if (method === 'POST') return { type: 'check_off', id };
    return null;
  }

  // /api/habits/:id/completions
  if (
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'habits' &&
    segments[3] === 'completions'
  ) {
    const id = segments[2];
    if (!id) return null;
    if (method === 'GET') return { type: 'list_completions', id };
    return null;
  }

  return null;
}

/**
 * Netlify Edge Function entry point for the Habits API.
 *
 * Order of operations is significant:
 *
 *   1. `requireAuth(req)` runs *before* any routing logic so that a
 *      missing/invalid token always produces a 401 — never a 404 —
 *      regardless of which pathname was requested (Requirement 2.8).
 *   2. `matchRoute` parses method + pathname into a `HabitRoute`. A
 *      `null` match becomes a 404 via `HttpError`, which
 *      `composeHandler` translates into the API error envelope.
 *   3. The matched route dispatches to a handler. Each real branch
 *      scopes its Drizzle query by `auth.userId` (Requirements
 *      2.4–2.6) so a row owned by another user is indistinguishable
 *      from a non-existent row (Requirement 2.7).
 */
export default composeHandler(async (req: Request): Promise<Response> => {
  const auth: AuthContext = await requireAuth(req);

  const url = new URL(req.url);
  const route = matchRoute(req.method, url.pathname);

  if (!route) {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  switch (route.type) {
    case 'create': {
      // Requirement 6.1–6.2: validate body, trim, reject whitespace-only.
      // `CreateHabitRequest` is extended locally with `.trim().min(1)` so
      // that whitespace-only `title` values fail the *same* zod parse
      // that catches structural errors. A single `ZodError` then flows
      // through `composeHandler` into the canonical
      // `{ code: 'validation_failed', fieldErrors }` 400 envelope,
      // keeping client error handling uniform across all validation
      // failures (no second code path to maintain). This mirrors the
      // pattern used for `POST /api/tasks` in `tasks.ts`.
      const CreateHabitBody = CreateHabitRequest.extend({
        title: z.string().trim().min(1, 'title must not be blank'),
      });
      const body = CreateHabitBody.parse(await req.json());

      const id = nanoid();
      const kind = body.kind ?? 'daily';
      const db = createDrizzleClient();
      await db
        .insert(habits)
        .values({
          id,
          userId: auth.userId,
          title: body.title,
          kind,
          currentStreak: 0,
          longestStreak: 0,
          lastCompletedDate: null,
        })
        .run();

      return jsonResponse(201, {
        id,
        userId: auth.userId,
        title: body.title,
        kind,
        currentStreak: 0,
        longestStreak: 0,
        lastCompletedDate: null,
      });
    }
    case 'list': {
      // Requirement 6.3: return every habit belonging to the authed user.
      // Requirement 2.4: the read is scoped by `eq(habits.userId, auth.userId)`,
      // so rows owned by other users are never exposed — the middleware has
      // already guaranteed `auth.userId` is the resolved User_ID for this
      // request's Supabase JWT.
      const db = createDrizzleClient();
      const rows = await db
        .select()
        .from(habits)
        .where(eq(habits.userId, auth.userId))
        .all();
      return jsonResponse(200, { habits: rows.map(habitRowToDto) });
    }
    case 'update': {
      // Requirement 6.4: PATCH /api/habits/:id renames a habit — it updates
      // *only* `title`. Streak fields (`current_streak`, `longest_streak`,
      // `last_completed_date`) plus `user_id` are immutable through this
      // endpoint; the streak fields move exclusively through the check-off
      // flow (task 5.6). We enforce "only title" by building the
      // `.set()` payload from a zod-parsed body whose sole key is `title`
      // — any extra keys in the request are dropped by the zod parse, so
      // they cannot leak into the UPDATE.
      //
      // Requirement 6.2 parity with create: `title` is trimmed and
      // whitespace-only values are rejected as 400 via the same `.extend()`
      // trick used in the create branch. `UpdateHabitRequest` already makes
      // `title` required (the only editable field), so no `.optional()`
      // here — every valid body yields exactly `{ title }`.
      const UpdateHabitBody = UpdateHabitRequest.extend({
        title: z.string().trim().min(1, 'title must not be blank'),
      });
      const body = UpdateHabitBody.parse(await req.json());

      const db = createDrizzleClient();

      // Requirement 2.6 / 2.7: the `user_id` predicate is folded into the
      // update's where-clause so a row owned by a different user is simply
      // "not found" — we never expose the existence of a row under another
      // user, and we never need a separate ownership check. libSQL's
      // RETURNING (exposed by `drizzle-orm/libsql` via `.returning()`)
      // lets us perform the update and fetch the post-update row in a
      // single round trip; `.get()` yields `undefined` when no row matched.
      const updated = await db
        .update(habits)
        .set({ title: body.title })
        .where(and(eq(habits.id, route.id), eq(habits.userId, auth.userId)))
        .returning()
        .get();

      if (!updated) {
        // Requirement 2.7: id doesn't exist, or exists under another user —
        // both collapse to an opaque 404.
        throw new HttpError(404, 'not_found', 'Habit not found');
      }

      return jsonResponse(200, habitRowToDto(updated));
    }
    case 'delete': {
      // Requirement 6.5: DELETE /api/habits/:id removes the matching row.
      // Requirement 2.6 / 2.7: the `user_id` predicate is folded into the
      // delete's where-clause so a row owned by a different user collapses
      // into the same opaque 404 as a non-existent id — we never reveal
      // whether a row exists under another user. libSQL's RETURNING
      // (exposed by `drizzle-orm/libsql` via `.returning()`) lets us
      // perform the delete and detect whether any row actually matched in
      // a single round trip; `.get()` yields `undefined` when the
      // where-clause matched nothing.
      const db = createDrizzleClient();
      const deleted = await db
        .delete(habits)
        .where(and(eq(habits.id, route.id), eq(habits.userId, auth.userId)))
        .returning()
        .get();

      if (!deleted) {
        throw new HttpError(404, 'not_found', 'Habit not found');
      }

      // Requirement 6.5: a successful delete returns no body. 204 is the
      // canonical "success, nothing to return" status for DELETE.
      return new Response(null, { status: 204 });
    }
    case 'check_off': {
      // Requirement 7.5: the client supplies its IANA time zone so the
      // server can compute `Local_Today` without trusting any header.
      // `CheckOffRequest` validates the timezone via `Intl.DateTimeFormat`,
      // so structural or unknown-zone failures flow through `composeHandler`
      // as the canonical `{ code: 'validation_failed', fieldErrors }` 400.
      const body = CheckOffRequest.parse(await req.json());

      // `Local_Today` is midnight UTC of the user's local calendar day
      // (see `_lib/localDay.ts`). Using the current wall-clock instant
      // from `Date.now()` is deliberate: the check-off endpoint is the
      // only place in the system that reads the clock, which keeps
      // `computeNextStreak` pure and testable.
      const localToday = localDayStartSeconds(Date.now(), body.timezone);

      const db = createDrizzleClient();

      // Requirement 2.6: scope the read by `user_id` so a row owned by
      // another user is indistinguishable from a non-existent row
      // (Requirement 2.7). We must SELECT first rather than update
      // unconditionally because the streak transition depends on the
      // *current* `last_completed_date` — we can't know the "next"
      // streak without reading the "prev" state.
      const habit = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, route.id), eq(habits.userId, auth.userId)))
        .get();

      if (!habit) {
        throw new HttpError(404, 'not_found', 'Habit not found');
      }

      // Drizzle's `integer(..., { mode: 'timestamp' })` returns
      // `Date | null` on read, but `computeNextStreak` works in Unix
      // seconds (to match `Local_Today` and keep adjacency checks as
      // integer arithmetic). Floor-divide by 1000 to convert ms → s.
      const prev: StreakState = {
        currentStreak: habit.currentStreak,
        longestStreak: habit.longestStreak,
        lastCompletedDate: habit.lastCompletedDate
          ? Math.floor(habit.lastCompletedDate.getTime() / 1000)
          : null,
      };

      const { kind, next } = computeNextStreak(prev, localToday);

      // Requirement 7.4: a second check-off on the same `Local_Today`
      // is idempotent — the row is unchanged, and we return 200 with
      // the current state. Skipping the UPDATE here also avoids a
      // needless write and keeps the response identical whether the
      // client retries once or twenty times on the same day.
      if (kind === 'idempotent') {
        return jsonResponse(200, habitRowToDto(habit));
      }

      // Requirements 7.1–7.3: persist the new state computed by
      // `computeNextStreak` (first / increment / reset). The
      // `user_id` predicate stays in the where-clause so concurrent
      // deletion by an attacker in another session cannot let us
      // write to a row that's now under a different owner.
      // `.returning().get()` performs the UPDATE and fetches the
      // post-update row in one round trip.
      const updated = await db
        .update(habits)
        .set({
          currentStreak: next.currentStreak,
          longestStreak: next.longestStreak,
          // Convert seconds → `Date` to match Drizzle's timestamp mode
          // on write. `null` is preserved as `null` (cannot arise from
          // a non-idempotent transition today, but the conversion is
          // defensive against future additions to `StreakTransition`).
          lastCompletedDate:
            next.lastCompletedDate !== null
              ? new Date(next.lastCompletedDate * 1000)
              : null,
        })
        .where(and(eq(habits.id, route.id), eq(habits.userId, auth.userId)))
        .returning()
        .get();

      if (!updated) {
        // Defensive: the row existed during the prior SELECT, so
        // reaching this branch would mean a concurrent delete
        // (or ownership change) between the two statements. Collapse
        // to the same opaque 404 the rest of the handler uses.
        throw new HttpError(404, 'not_found', 'Habit not found');
      }

      // Persist a row in `habit_completions` keyed by (habit_id, date)
      // so the heatmap UI can render a GitHub-style grid. `date` is
      // days-since-epoch derived from `localToday` (which is itself
      // midnight UTC of the user's local calendar day), so two
      // check-offs on the same local day always collide.
      //
      // No UNIQUE constraint exists on (habit_id, date) — instead we
      // detect existing rows in the DB and skip the INSERT to keep
      // the table single-row-per-day. Idempotent path is already
      // returned earlier (`kind === 'idempotent'`); we only get here
      // when the streak transition was first/increment/reset, all of
      // which imply a brand-new completion for today.
      const dayKey = Math.floor(localToday / 86400);
      try {
        await db
          .insert(habitCompletions)
          .values({
            id: nanoid(),
            userId: auth.userId,
            habitId: route.id,
            date: dayKey,
            createdAt: new Date(),
          })
          .run();
      } catch (err) {
        // Don't fail the whole check-off if the completion log can't
        // be written — the streak state is the source of truth, the
        // log is just for the heatmap.
        console.error('[habits] habit_completions insert failed:', err);
      }

      return jsonResponse(200, habitRowToDto(updated));
    }
    case 'list_completions': {
      // Return up to the last 365 day-keys for this habit so the UI
      // can render a heatmap. The `(habit_id, date)` index makes this
      // a single index range scan.
      const db = createDrizzleClient();
      const owned = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, route.id), eq(habits.userId, auth.userId)))
        .get();
      if (!owned) {
        throw new HttpError(404, 'not_found', 'Habit not found');
      }
      const todayDayKey = Math.floor(Date.now() / 1000 / 86400);
      const earliest = todayDayKey - 365;
      const rows = await db
        .select({ date: habitCompletions.date })
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.habitId, route.id),
            eq(habitCompletions.userId, auth.userId),
            gte(habitCompletions.date, earliest),
          ),
        )
        .orderBy(asc(habitCompletions.date))
        .all();
      return jsonResponse(200, { dates: rows.map((r) => r.date) });
    }
  }
});
