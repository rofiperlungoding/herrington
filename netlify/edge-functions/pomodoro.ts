import { nanoid } from 'nanoid';
import { and, desc, eq, sum } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import { LogPomodoroRequest } from '../../src/shared/api/pomodoro.contracts.ts';
import { pomodoroSessions } from '../../src/shared/db/schema.ts';

/**
 * Pomodoro sessions edge function.
 *
 *   GET  /api/pomodoro/sessions[?taskId=...]   → list user's sessions (filterable)
 *   POST /api/pomodoro/sessions                → log a completed session
 *
 * Sessions are append-only. There is no UPDATE / DELETE — if a user
 * wants to "undo" a session, that's a future feature and would need
 * its own endpoint.
 */

interface SessionRow {
  id: string;
  userId: string;
  taskId: string | null;
  durationSec: number;
  startedAt: number;
  completedAt: number;
  label: string | null;
}

function sessionToDto(row: SessionRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    durationSec: row.durationSec,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    label: row.label,
  };
}

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth: AuthContext = await requireAuth(req);
  const url = new URL(req.url);

  if (url.pathname !== '/api/pomodoro/sessions') {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  const db = createDrizzleClient();

  if (req.method === 'GET') {
    const taskIdFilter = url.searchParams.get('taskId');
    const where = taskIdFilter
      ? and(
          eq(pomodoroSessions.userId, auth.userId),
          eq(pomodoroSessions.taskId, taskIdFilter),
        )
      : eq(pomodoroSessions.userId, auth.userId);

    const rows = await db
      .select()
      .from(pomodoroSessions)
      .where(where)
      .orderBy(desc(pomodoroSessions.startedAt))
      .all();

    // Single rollup query for the "total time" line — avoids re-summing
    // a long history client-side. Drizzle's `sum()` returns a string
    // (libSQL's REAL/INTEGER coalesces through TEXT in some drivers),
    // so we coerce to number and tolerate null on empty result.
    const aggRow = await db
      .select({ total: sum(pomodoroSessions.durationSec) })
      .from(pomodoroSessions)
      .where(where)
      .get();
    const totalSec = aggRow?.total ? Number(aggRow.total) : 0;

    return jsonResponse(200, {
      sessions: rows.map(sessionToDto),
      totalSec: Number.isFinite(totalSec) ? totalSec : 0,
    });
  }

  if (req.method === 'POST') {
    const body = LogPomodoroRequest.parse(await req.json());

    // Sanity check: completedAt must be >= startedAt and the duration
    // must roughly match (within 5s slop for clock drift). If the
    // numbers don't add up, drop to the wall-clock delta — the
    // authoritative duration is what the timer measured locally,
    // not whatever metadata the client sent.
    const wallSec = Math.max(0, body.completedAt - body.startedAt);
    if (body.completedAt < body.startedAt) {
      throw new HttpError(
        400,
        'invalid_range',
        'completedAt must be greater than or equal to startedAt',
      );
    }
    const durationSec =
      Math.abs(wallSec - body.durationSec) <= 5 ? body.durationSec : wallSec;

    if (durationSec < 60) {
      throw new HttpError(
        400,
        'too_short',
        'Sessions under 60 seconds are not logged',
      );
    }

    const row = {
      id: nanoid(),
      userId: auth.userId,
      taskId: body.taskId ?? null,
      durationSec,
      startedAt: body.startedAt,
      completedAt: body.completedAt,
      label: body.label?.trim() ? body.label.trim() : null,
    };

    await db.insert(pomodoroSessions).values(row).run();

    return jsonResponse(201, sessionToDto(row));
  }

  throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
});
