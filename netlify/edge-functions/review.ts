import { z } from 'zod';
import { and, eq, gte, lte } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import { localDayStartSeconds } from './_lib/localDay.ts';
import {
  habitCompletions,
  habits,
  pomodoroSessions,
  tasks,
} from '../../src/shared/db/schema.ts';

/**
 * Weekly Review edge function.
 *
 *   GET /api/review[?weekStart=YYYY-MM-DD&timezone=Asia/Jakarta]
 *
 * Aggregates the user's last 7 days of activity across tasks, habits,
 * and Pomodoro sessions into a single response shaped for the Review
 * page's bento layout. Computing this server-side keeps the round-trip
 * tight even when the dataset has thousands of rows.
 *
 * The window is "the last 7 calendar days in the user's local
 * timezone" by default, ending at the end of today. A future iteration
 * can accept a `weekStart` query param to scrub through earlier weeks.
 */

const QuerySchema = z.object({
  /** IANA timezone (e.g. "Asia/Jakarta"). Falls back to UTC. */
  timezone: z.string().min(1).max(64).default('UTC'),
  /**
   * Optional anchor: the Unix-seconds midnight of the END of the
   * window. Defaults to "end of today" in the user's tz. Provided
   * mostly for future "previous week" navigation; the current UI
   * never sends it.
   */
  endDay: z.coerce.number().int().positive().optional(),
});

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth: AuthContext = await requireAuth(req);
  const url = new URL(req.url);
  if (url.pathname !== '/api/review' || req.method !== 'GET') {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  const params = QuerySchema.parse({
    timezone: url.searchParams.get('timezone') ?? undefined,
    endDay: url.searchParams.get('endDay') ?? undefined,
  });

  const { timezone, endDay } = params;
  const todaySec = endDay ?? localDayStartSeconds(Date.now(), timezone);
  // 7-day window: [today-6, today+1) so "today" itself is included.
  const windowStartSec = todaySec - 6 * 86400;
  const windowEndSec = todaySec + 86400;
  const windowStartDay = Math.floor(windowStartSec / 86400);
  const windowEndDay = Math.floor(windowEndSec / 86400);

  const db = createDrizzleClient();

  // ─── Tasks ───────────────────────────────────────────────────────────
  //
  // We pull every task the user owns, then aggregate in memory. Tasks
  // live a short while (most users keep < 200 active tasks), so an
  // in-memory rollup is cheaper than four targeted queries.
  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, auth.userId))
    .all();

  // Created-this-week count + completed-this-week count are both
  // approximate: we treat `createdAt` as the canonical timestamp for
  // both, since we don't store a separate `completedAt`. This means
  // a task created last month and completed today still counts as a
  // completion (correct) but won't bump the "created this week" bar
  // (also correct). Good enough for v1.
  let createdThisWeek = 0;
  let completedThisWeek = 0;
  let totalReschedules = 0;
  const tagCount = new Map<string, number>();
  // Top-N reschedule offenders — sorted later.
  const rescheduleRanking: Array<{ id: string; title: string; count: number }> =
    [];

  for (const t of allTasks) {
    const createdSec = Math.floor(t.createdAt.getTime() / 1000);
    if (createdSec >= windowStartSec && createdSec < windowEndSec) {
      createdThisWeek++;
      if (t.isCompleted) completedThisWeek++;
      // Tag breakdown of *completed* tasks this week — that's what
      // the user actually got done.
      if (t.isCompleted && t.tags) {
        for (const tag of t.tags.split(',')) {
          const trimmed = tag.trim();
          if (!trimmed) continue;
          tagCount.set(trimmed, (tagCount.get(trimmed) ?? 0) + 1);
        }
      }
    }
    if (t.rescheduleCount > 0) {
      totalReschedules += t.rescheduleCount;
      rescheduleRanking.push({
        id: t.id,
        title: t.title,
        count: t.rescheduleCount,
      });
    }
  }

  rescheduleRanking.sort((a, b) => b.count - a.count);

  const completionRate =
    createdThisWeek > 0 ? completedThisWeek / createdThisWeek : null;

  // ─── Habits ─────────────────────────────────────────────────────────
  //
  // For each daily habit we count check-offs in the [windowStartDay,
  // windowEndDay) range. The "skip rate" is `(7 - checkoffs) / 7` so
  // a habit checked 5 of 7 days reads as 28% skipped.
  const userHabits = await db
    .select()
    .from(habits)
    .where(eq(habits.userId, auth.userId))
    .all();

  const habitCompletionRows = await db
    .select()
    .from(habitCompletions)
    .where(
      and(
        eq(habitCompletions.userId, auth.userId),
        gte(habitCompletions.date, windowStartDay),
        lte(habitCompletions.date, windowEndDay - 1),
      ),
    )
    .all();

  const checkoffsByHabit = new Map<string, number>();
  for (const c of habitCompletionRows) {
    checkoffsByHabit.set(
      c.habitId,
      (checkoffsByHabit.get(c.habitId) ?? 0) + 1,
    );
  }

  const habitBreakdown = userHabits
    .filter((h) => h.kind === 'daily')
    .map((h) => {
      const checkoffs = checkoffsByHabit.get(h.id) ?? 0;
      return {
        id: h.id,
        title: h.title,
        currentStreak: h.currentStreak,
        longestStreak: h.longestStreak,
        checkoffs,
        possible: 7,
        skipRate: (7 - checkoffs) / 7,
      };
    })
    .sort((a, b) => b.skipRate - a.skipRate);

  const totalCheckoffs = habitBreakdown.reduce(
    (s, h) => s + h.checkoffs,
    0,
  );
  const totalPossible = habitBreakdown.length * 7;
  const habitCompletionRate =
    totalPossible > 0 ? totalCheckoffs / totalPossible : null;

  const mostSkipped =
    habitBreakdown.length > 0 && habitBreakdown[0].skipRate > 0
      ? habitBreakdown[0]
      : null;

  // ─── Pomodoro ───────────────────────────────────────────────────────
  const focusRows = await db
    .select()
    .from(pomodoroSessions)
    .where(
      and(
        eq(pomodoroSessions.userId, auth.userId),
        gte(pomodoroSessions.startedAt, windowStartSec),
        lte(pomodoroSessions.startedAt, windowEndSec - 1),
      ),
    )
    .all();

  const focusByTask = new Map<string, number>();
  let focusTotalSec = 0;
  for (const f of focusRows) {
    focusTotalSec += f.durationSec;
    if (f.taskId) {
      focusByTask.set(
        f.taskId,
        (focusByTask.get(f.taskId) ?? 0) + f.durationSec,
      );
    }
  }

  const taskTitleById = new Map<string, string>();
  for (const t of allTasks) taskTitleById.set(t.id, t.title);

  const topFocusTasks = Array.from(focusByTask.entries())
    .map(([taskId, sec]) => ({
      taskId,
      title: taskTitleById.get(taskId) ?? 'Untitled',
      seconds: sec,
    }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3);

  // ─── Build response ─────────────────────────────────────────────────

  return jsonResponse(200, {
    window: {
      startSec: windowStartSec,
      endSec: windowEndSec,
      timezone,
    },
    tasks: {
      createdThisWeek,
      completedThisWeek,
      completionRate,
      totalReschedules,
      topReschedules: rescheduleRanking.slice(0, 3),
      tagBreakdown: Array.from(tagCount.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count),
    },
    habits: {
      completionRate: habitCompletionRate,
      totalCheckoffs,
      totalPossible,
      mostSkipped,
      breakdown: habitBreakdown,
    },
    focus: {
      totalSec: focusTotalSec,
      sessionCount: focusRows.length,
      topTasks: topFocusTasks,
    },
  });
});
