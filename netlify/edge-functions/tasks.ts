import { z } from 'zod';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import {
  CreateTaskRequest,
  UpdateTaskRequest,
  ToggleCompletionRequest,
} from '../../src/shared/api/tasks.contracts.ts';
import { tasks } from '../../src/shared/db/schema.ts';

/**
 * Row shape returned by `db.select().from(tasks)` — inferred from the
 * Drizzle schema so that adding a column to `tasks` in the future
 * fails the `taskRowToDto` signature at compile time rather than
 * silently dropping the field from the API response.
 *
 * Drizzle's `integer(..., { mode: 'timestamp' })` maps the underlying
 * SQLite integer column to a `Date` on read, so `deadline` and
 * `createdAt` arrive here as `Date` objects (nullable for `deadline`).
 */
type TaskRow = typeof tasks.$inferSelect;

/**
 * Convert a Drizzle `tasks` row into the wire-level `TaskDTO` shape
 * defined in `src/shared/api/tasks.contracts.ts`.
 *
 * Two invariants are enforced here so every route handler that emits
 * a `TaskDTO` agrees on serialization (tasks 4.3 list, 4.4 update,
 * 4.6 completion toggle):
 *
 *   - `deadline` is unix seconds or `null`. Drizzle hands us a `Date`
 *     (or `null`); we floor-divide the ms timestamp by 1000 to match
 *     the integer-seconds representation the schema stores on write.
 *   - `createdAt` is always unix seconds. The column is NOT NULL with
 *     a `strftime('%s','now')` default, so the `Date` is guaranteed
 *     to be present here.
 *
 * Kept module-private (no `export`) because it is an implementation
 * detail of this edge function, not part of the shared contract.
 */
function taskRowToDto(row: TaskRow) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    category: row.category,
    isCompleted: row.isCompleted,
    deadline: row.deadline ? Math.floor(row.deadline.getTime() / 1000) : null,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    rescheduleCount: row.rescheduleCount,
    tags: parseTags(row.tags),
  };
}

/**
 * Parse the comma-separated `tags` column into a normalized array.
 *
 * The column stores whatever the server wrote (already normalized via
 * `normalizeTags`), so this is just `split + filter` — but we keep the
 * filter to defend against any legacy / hand-edited rows that might
 * contain stray empties.
 */
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Normalize a client-supplied tag list into the canonical persisted
 * form: trim each, lower-case for case-insensitive equality, drop
 * empties and duplicates, cap each label at 24 chars and the total
 * count at 8 to keep the column size sane and the UI from drowning
 * in chips.
 */
function normalizeTags(input: string[] | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = raw.trim().toLowerCase().slice(0, 24);
    if (!tag) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Discriminated union describing every route served by the Tasks
 * edge function. Returned by `matchRoute` when the method and
 * pathname combination matches one of the endpoints; `null` otherwise,
 * so the caller can translate "no match" into a single 404 response
 * without having to inspect the method again.
 */
export type TaskRoute =
  | { type: 'list' }
  | { type: 'create' }
  | { type: 'update'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'toggle_completion'; id: string }
  | { type: 'reschedule'; id: string };

/**
 * Parse the request method and URL pathname into a `TaskRoute`.
 *
 * Segment layout used for matching:
 *
 *   /api/tasks                 → segments = ['api', 'tasks']
 *   /api/tasks/:id             → segments = ['api', 'tasks', ':id']
 *   /api/tasks/:id/completion  → segments = ['api', 'tasks', ':id', 'completion']
 *
 * Pure function: no I/O, no throws. Unknown combinations return
 * `null` so the handler can emit a uniform 404 regardless of whether
 * the pathname is unrecognized, the method is wrong for a known
 * pathname, or the `:id` segment is empty. Trailing slashes are
 * tolerated via `filter(Boolean)` so `/api/tasks/` still matches the
 * two-segment `list`/`create` shape.
 */
export function matchRoute(method: string, pathname: string): TaskRoute | null {
  const segments = pathname.split('/').filter(Boolean);

  // /api/tasks
  if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'tasks') {
    if (method === 'GET') return { type: 'list' };
    if (method === 'POST') return { type: 'create' };
    return null;
  }

  // /api/tasks/:id
  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'tasks') {
    const id = segments[2];
    if (!id) return null;
    if (method === 'PATCH') return { type: 'update', id };
    if (method === 'DELETE') return { type: 'delete', id };
    return null;
  }

  // /api/tasks/:id/completion
  if (
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'tasks' &&
    segments[3] === 'completion'
  ) {
    const id = segments[2];
    if (!id) return null;
    if (method === 'PATCH') return { type: 'toggle_completion', id };
    return null;
  }

  // /api/tasks/:id/reschedule
  if (
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'tasks' &&
    segments[3] === 'reschedule'
  ) {
    const id = segments[2];
    if (!id) return null;
    if (method === 'POST') return { type: 'reschedule', id };
    return null;
  }

  return null;
}

/**
 * Netlify Edge Function entry point for the Tasks API.
 *
 * Order of operations is significant:
 *
 *   1. `requireAuth(req)` runs *before* any routing logic so that a
 *      missing/invalid token always produces a 401 — never a 404 —
 *      regardless of which pathname was requested (Requirement 2.8).
 *   2. `matchRoute` parses method + pathname into a `TaskRoute`. A
 *      `null` match becomes a 404 via `HttpError`, which
 *      `composeHandler` translates into the API error envelope.
 *   3. The matched route dispatches to a handler. Each branch scopes
 *      its Drizzle query by `auth.userId` (Requirements 2.4–2.6) so
 *      a row owned by another user is indistinguishable from a
 *      non-existent row (Requirement 2.7).
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
      // Requirement 3.1–3.3: validate body, trim, reject whitespace-only.
      // `CreateTaskRequest` is extended locally with `.trim().min(1)` so
      // that whitespace-only `title` / `category` values fail the *same*
      // zod parse that catches structural errors. A single `ZodError`
      // then flows through `composeHandler` into the canonical
      // `{ code: 'validation_failed', fieldErrors }` 400 envelope,
      // keeping client error handling uniform across all validation
      // failures (no second code path to maintain).
      const CreateTaskBody = CreateTaskRequest.extend({
        title: z.string().trim().min(1, 'title must not be blank'),
        category: z.string().trim().min(1, 'category must not be blank'),
      });
      const body = CreateTaskBody.parse(await req.json());

      // Compute the canonical unix-seconds timestamp once. Drizzle's
      // `integer(..., { mode: 'timestamp' })` maps `Date` → seconds on
      // write and seconds → `Date` on read, so we round-trip through
      // `new Date(sec * 1000)` on the way in to guarantee the row's
      // persisted `created_at` equals the `createdAt` we return here.
      const id = nanoid();
      const createdAtSec = Math.floor(Date.now() / 1000);
      const deadlineSec = body.deadline ?? null;
      const tagsArr = normalizeTags(body.tags);
      const tagsCsv = tagsArr.join(',');

      const db = createDrizzleClient();
      await db
        .insert(tasks)
        .values({
          id,
          // Requirement 2.5: the server stamps `user_id` from the auth
          // context; any `userId` that might appear in the body is
          // ignored because it isn't part of `CreateTaskRequest`.
          userId: auth.userId,
          title: body.title,
          category: body.category,
          // Requirement 3.1: new tasks are always created incomplete.
          isCompleted: false,
          deadline: deadlineSec != null ? new Date(deadlineSec * 1000) : null,
          createdAt: new Date(createdAtSec * 1000),
          rescheduleCount: 0,
          tags: tagsCsv,
        })
        .run();

      return jsonResponse(201, {
        id,
        userId: auth.userId,
        title: body.title,
        category: body.category,
        isCompleted: false,
        deadline: deadlineSec,
        createdAt: createdAtSec,
        rescheduleCount: 0,
        tags: tagsArr,
      });
    }
    case 'list': {
      // Requirement 3.4: return every task belonging to the authed user.
      // Requirement 2.4: the read is scoped by `eq(tasks.userId, auth.userId)`,
      // so rows owned by other users are never exposed — the middleware has
      // already guaranteed `auth.userId` is the resolved User_ID for this
      // request's Supabase JWT.
      const db = createDrizzleClient();
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.userId, auth.userId))
        .all();
      return jsonResponse(200, { tasks: rows.map(taskRowToDto) });
    }
    case 'update': {
      // Requirement 3.5: PATCH updates only title / category / deadline and
      // leaves is_completed, user_id, and created_at untouched. We enforce
      // that by only building a Drizzle `.set()` payload from those three
      // fields; anything else in the body (intentional or accidental) is
      // dropped by the zod parse since `UpdateTaskRequest` has no other keys.
      //
      // Requirement 3.2 / 3.3 parity with create: title and category are
      // trimmed and whitespace-only values are rejected as 400 via the same
      // `.extend()` trick used in the create branch. We keep them optional
      // here because PATCH is a partial update.
      const UpdateTaskBody = UpdateTaskRequest.extend({
        title: z.string().trim().min(1, 'title must not be blank').optional(),
        category: z.string().trim().min(1, 'category must not be blank').optional(),
      });
      const body = UpdateTaskBody.parse(await req.json());

      // Build a minimal update payload. `undefined` means "field absent from
      // request body" (leave column alone); `null` on `deadline` is a real
      // value that clears the column. We therefore distinguish the two with
      // explicit `!== undefined` checks rather than a truthiness test.
      const updates: Partial<typeof tasks.$inferInsert> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.category !== undefined) updates.category = body.category;
      if (body.deadline !== undefined) {
        // Drizzle's `integer(..., { mode: 'timestamp' })` takes a `Date` on
        // write and stores it as unix seconds. Inputs arrive as unix seconds
        // already, so we multiply by 1000 to form the `Date`; `null` passes
        // through to clear the column.
        updates.deadline =
          body.deadline === null ? null : new Date(body.deadline * 1000);
      }
      if (body.tags !== undefined) {
        // `tags` replaces the entire list (set semantics, not patch).
        updates.tags = normalizeTags(body.tags).join(',');
      }

      const db = createDrizzleClient();

      // Requirement 2.6 / 2.7: the `user_id` predicate is folded into the
      // update's where-clause so a row owned by a different user is simply
      // "not found" — we never expose the existence of a row under another
      // user, and we never need a separate ownership check.
      const whereOwned = and(
        eq(tasks.id, route.id),
        eq(tasks.userId, auth.userId),
      );

      // If the body sets the deadline EARLIER than the current value (or
      // clears it entirely), reset the reschedule streak — the user is no
      // longer pushing the task forward. We need the current row to make
      // that decision, so fetch it first when a deadline change is part of
      // the update.
      if (body.deadline !== undefined) {
        const current = await db.select().from(tasks).where(whereOwned).get();
        if (current) {
          const currentMs = current.deadline?.getTime() ?? null;
          const nextMs =
            body.deadline === null
              ? null
              : new Date(body.deadline * 1000).getTime();
          // Deadline moved earlier (smaller timestamp) or cleared while
          // there was one before → reset.
          const movedEarlier =
            (currentMs != null && nextMs != null && nextMs < currentMs) ||
            (currentMs != null && nextMs == null);
          if (movedEarlier) {
            updates.rescheduleCount = 0;
          }
        }
      }

      // If the body contained no updatable fields, skip the UPDATE entirely
      // — some Drizzle drivers reject an empty `.set({})`, and there's no
      // work to do regardless. Fall through to a scoped SELECT so we can
      // still emit the canonical 404 / current-row response shape.
      if (Object.keys(updates).length === 0) {
        const current = await db
          .select()
          .from(tasks)
          .where(whereOwned)
          .get();
        if (!current) {
          throw new HttpError(404, 'not_found', 'Task not found');
        }
        return jsonResponse(200, taskRowToDto(current));
      }

      // libSQL supports RETURNING, and `drizzle-orm/libsql` exposes it via
      // `.returning()`, letting us perform the update and fetch the post-
      // update row in a single round trip. `.get()` picks the first row;
      // with the owner-scoped predicate there is at most one.
      const updated = await db
        .update(tasks)
        .set(updates)
        .where(whereOwned)
        .returning()
        .get();

      if (!updated) {
        // Requirement 2.7 + 3.7: id doesn't exist, or exists under another
        // user — both collapse to an opaque 404.
        throw new HttpError(404, 'not_found', 'Task not found');
      }

      return jsonResponse(200, taskRowToDto(updated));
    }
    case 'delete': {
      // Requirement 2.6 / 2.7 / 3.6 / 3.7: delete scoped by user_id so that
      // an id owned by a different user collapses into the same opaque 404
      // as an id that doesn't exist at all. libSQL's RETURNING is exposed
      // by drizzle-orm/libsql via `.returning()`, which lets us detect
      // whether any row actually matched in a single round trip — if the
      // where-clause matched nothing, `.get()` yields `undefined`.
      const db = createDrizzleClient();
      const deleted = await db
        .delete(tasks)
        .where(and(eq(tasks.id, route.id), eq(tasks.userId, auth.userId)))
        .returning()
        .get();

      if (!deleted) {
        throw new HttpError(404, 'not_found', 'Task not found');
      }

      // Requirement 3.6: a successful delete returns no body. 204 is the
      // canonical "success, nothing to return" status for DELETE.
      return new Response(null, { status: 204 });
    }
    case 'toggle_completion': {
      // Requirement 4.1: PATCH /api/tasks/:id/completion sets is_completed
      // to the boolean supplied in the body. Extra keys are dropped by
      // the zod parse so we cannot accidentally update title/category/etc.
      const body = ToggleCompletionRequest.parse(await req.json());

      const db = createDrizzleClient();

      // When marking complete, reset the reschedule streak — the task
      // is done, the user shouldn't be guilt-tripped about prior pushes.
      const setPayload: Partial<typeof tasks.$inferInsert> = {
        isCompleted: body.isCompleted,
      };
      if (body.isCompleted) {
        setPayload.rescheduleCount = 0;
      }

      const updated = await db
        .update(tasks)
        .set(setPayload)
        .where(and(eq(tasks.id, route.id), eq(tasks.userId, auth.userId)))
        .returning()
        .get();

      if (!updated) {
        throw new HttpError(404, 'not_found', 'Task not found');
      }

      return jsonResponse(200, taskRowToDto(updated));
    }
    case 'reschedule': {
      // Push the task's deadline forward by 1 day (24h) and bump the
      // reschedule streak counter so the frontend can show a nudge after
      // 3 in a row. If there's no current deadline, set it to "tomorrow
      // at the same time as now" — that gives the user a sensible default.
      const db = createDrizzleClient();
      const whereOwned = and(
        eq(tasks.id, route.id),
        eq(tasks.userId, auth.userId),
      );

      const current = await db.select().from(tasks).where(whereOwned).get();
      if (!current) {
        throw new HttpError(404, 'not_found', 'Task not found');
      }

      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const baseMs = current.deadline?.getTime() ?? Date.now();
      const newDeadline = new Date(baseMs + ONE_DAY_MS);

      const updated = await db
        .update(tasks)
        .set({
          deadline: newDeadline,
          rescheduleCount: current.rescheduleCount + 1,
        })
        .where(whereOwned)
        .returning()
        .get();

      if (!updated) {
        throw new HttpError(404, 'not_found', 'Task not found');
      }

      return jsonResponse(200, taskRowToDto(updated));
    }
  }
});
