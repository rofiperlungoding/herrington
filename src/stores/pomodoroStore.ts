import { create } from 'zustand'

/**
 * Pomodoro timer store.
 *
 * Single global timer — running multiple Pomodoros at once doesn't
 * make sense ("focus" implies one thing). Survives navigation because
 * the FloatingTimer is mounted at the AppShell level and reads from
 * this store.
 *
 * Persistence: in-memory only. If the user reloads the page mid-session
 * the timer is lost. We could persist to sessionStorage later if it's
 * a real annoyance — for now we treat reload as "session ended".
 *
 * State machine:
 *
 *   idle    ─ start(taskId, dur) ─▶ running
 *   running ─ pause()             ─▶ paused
 *   paused  ─ resume()            ─▶ running
 *   running ─ tick (deadline hit) ─▶ completed
 *   running ─ stop() (early)      ─▶ idle      (logs if ≥ 60s elapsed)
 *   completed ─ dismiss()         ─▶ idle
 *
 * The component layer is responsible for triggering `tick` on a 1s
 * interval and calling `stop` / `dismiss` from button clicks. The
 * store is dumb — it computes elapsed seconds on demand from the
 * `startedAt` and `pausedAccumSec` fields rather than holding a tick
 * counter, so a missed tick (tab in background) doesn't desync.
 */

export type PomodoroStatus = 'idle' | 'running' | 'paused' | 'completed'

interface PomodoroState {
  status: PomodoroStatus
  /** Task being focused on, or null for an unattached session. */
  taskId: string | null
  /** Title shown in the floating timer chrome. */
  taskTitle: string | null
  /** Total session length in seconds (e.g. 25 * 60). */
  durationSec: number
  /** Unix-ms of the most recent run start (resets when paused/resumed). */
  startedAtMs: number | null
  /** Seconds of elapsed time accumulated across previous (paused) runs. */
  pausedAccumSec: number
  /** Unix-ms of the original session start (used when logging the session). */
  sessionStartedAtMs: number | null

  start: (params: {
    taskId: string | null
    taskTitle: string | null
    durationSec: number
  }) => void
  pause: () => void
  resume: () => void
  /** Snapshot the state needed to emit a log row, then reset to idle. */
  consumeForLog: () => null | {
    taskId: string | null
    durationSec: number
    startedAtSec: number
    completedAtSec: number
  }
  /** Mark the timer as completed (deadline hit). UI animates, then user dismisses. */
  markCompleted: () => void
  /** Drop back to idle without logging (e.g. after dismiss + log already fired). */
  reset: () => void
}

export const usePomodoroStore = create<PomodoroState>((set, get) => ({
  status: 'idle',
  taskId: null,
  taskTitle: null,
  durationSec: 0,
  startedAtMs: null,
  pausedAccumSec: 0,
  sessionStartedAtMs: null,

  start: ({ taskId, taskTitle, durationSec }) => {
    const now = Date.now()
    set({
      status: 'running',
      taskId,
      taskTitle,
      durationSec,
      startedAtMs: now,
      pausedAccumSec: 0,
      sessionStartedAtMs: now,
    })
  },

  pause: () => {
    const s = get()
    if (s.status !== 'running' || !s.startedAtMs) return
    const elapsed = (Date.now() - s.startedAtMs) / 1000
    set({
      status: 'paused',
      pausedAccumSec: s.pausedAccumSec + elapsed,
      startedAtMs: null,
    })
  },

  resume: () => {
    const s = get()
    if (s.status !== 'paused') return
    set({ status: 'running', startedAtMs: Date.now() })
  },

  markCompleted: () => set({ status: 'completed', startedAtMs: null }),

  consumeForLog: () => {
    const s = get()
    if (!s.sessionStartedAtMs) {
      set(initialIdleState())
      return null
    }
    const liveSec =
      s.status === 'running' && s.startedAtMs
        ? (Date.now() - s.startedAtMs) / 1000
        : 0
    const elapsed = Math.floor(s.pausedAccumSec + liveSec)
    const startedAtSec = Math.floor(s.sessionStartedAtMs / 1000)
    const completedAtSec = Math.floor(Date.now() / 1000)
    const snapshot = {
      taskId: s.taskId,
      durationSec: elapsed,
      startedAtSec,
      completedAtSec,
    }
    set(initialIdleState())
    return snapshot
  },

  reset: () => set(initialIdleState()),
}))

function initialIdleState(): Pick<
  PomodoroState,
  | 'status'
  | 'taskId'
  | 'taskTitle'
  | 'durationSec'
  | 'startedAtMs'
  | 'pausedAccumSec'
  | 'sessionStartedAtMs'
> {
  return {
    status: 'idle',
    taskId: null,
    taskTitle: null,
    durationSec: 0,
    startedAtMs: null,
    pausedAccumSec: 0,
    sessionStartedAtMs: null,
  }
}

/**
 * Pure helper: given the current store snapshot, compute the seconds
 * elapsed in the current session. Re-derived on every render rather
 * than stored, so a tab switch / paused tick can't desync the value.
 */
export function elapsedSeconds(s: PomodoroState): number {
  const live =
    s.status === 'running' && s.startedAtMs
      ? (Date.now() - s.startedAtMs) / 1000
      : 0
  return Math.floor(s.pausedAccumSec + live)
}

/**
 * Pure helper: seconds remaining in the current session, clamped at 0.
 */
export function remainingSeconds(s: PomodoroState): number {
  return Math.max(0, s.durationSec - elapsedSeconds(s))
}
