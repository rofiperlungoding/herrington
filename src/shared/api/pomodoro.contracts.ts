import { z } from 'zod'

/**
 * Pomodoro session contracts.
 *
 * Sessions are append-only records of focus time. Each session attaches
 * to a task or floats free. The wire shape is unix-seconds integers
 * everywhere — the schema mirrors that exactly to keep round-tripping
 * cheap (no Date conversion on either side).
 */

export const PomodoroSessionDTO = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  durationSec: z.number().int().positive(),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  label: z.string().nullable(),
})

/** `GET /api/pomodoro/sessions[?taskId=...]` — list sessions for the user.
 *
 * When `taskId` is supplied, only sessions for that task are returned.
 * Both shapes return `{ sessions, totalSec }` so the caller can compute
 * a single-line "X min spent" without re-summing on the client.
 */
export const PomodoroListResponse = z.object({
  sessions: z.array(PomodoroSessionDTO),
  totalSec: z.number().int().nonnegative(),
})

/** `POST /api/pomodoro/sessions` — log one completed session. */
export const LogPomodoroRequest = z.object({
  taskId: z.string().nullable().optional(),
  durationSec: z.number().int().min(60).max(8 * 60 * 60),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  label: z.string().trim().max(120).nullable().optional(),
})

export type PomodoroSession = z.infer<typeof PomodoroSessionDTO>
export type PomodoroListResponseBody = z.infer<typeof PomodoroListResponse>
export type LogPomodoroRequestBody = z.infer<typeof LogPomodoroRequest>
