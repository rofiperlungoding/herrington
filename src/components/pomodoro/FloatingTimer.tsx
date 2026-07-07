import * as React from 'react'
import { Pause, Play, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useLogPomodoro, formatDurationShort } from '@/hooks/usePomodoro'
import {
  elapsedSeconds,
  remainingSeconds,
  usePomodoroStore,
} from '@/stores/pomodoroStore'
import { cn } from '@/lib/utils'

/**
 * Floating Pomodoro timer.
 *
 * Mounted once at the AppShell level so it survives navigation between
 * routes — a focus session shouldn't break just because the user
 * popped over to Notebooks for a moment. The store is the single
 * source of truth; this component is a thin renderer that reads the
 * derived state on a 1Hz tick.
 *
 * UX:
 *   - Idle           → renders nothing.
 *   - Running/paused → bottom-right floating pill with elapsed/remaining
 *                      ring, task title, and Pause/Stop controls.
 *   - Completed      → same pill, "Done" badge, dismiss button. On
 *                      dismiss we log the session (if it's >= 60s)
 *                      and reset the store.
 *
 * The "stop early" path also logs the session as long as it crossed
 * the 60s minimum — so a 12-minute focus block that gets bailed early
 * still shows up in the data.
 */
export function FloatingTimer() {
  const status = usePomodoroStore((s) => s.status)
  const taskId = usePomodoroStore((s) => s.taskId)
  const taskTitle = usePomodoroStore((s) => s.taskTitle)
  const durationSec = usePomodoroStore((s) => s.durationSec)
  const pause = usePomodoroStore((s) => s.pause)
  const resume = usePomodoroStore((s) => s.resume)
  const consumeForLog = usePomodoroStore((s) => s.consumeForLog)
  const markCompleted = usePomodoroStore((s) => s.markCompleted)
  const reset = usePomodoroStore((s) => s.reset)

  const log = useLogPomodoro()

  // Force a re-render once a second so the elapsed/remaining values tick.
  const [, setNow] = React.useState(0)
  React.useEffect(() => {
    if (status === 'idle' || status === 'completed') return
    const id = window.setInterval(() => setNow((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [status])

  // Auto-fire markCompleted when the deadline hits.
  React.useEffect(() => {
    if (status !== 'running') return
    const remaining = remainingSeconds(usePomodoroStore.getState())
    if (remaining <= 0) {
      markCompleted()
      // Quick haptic-style audible cue could go here later. Keep
      // it silent for now.
    }
  })

  if (status === 'idle') return null

  const elapsed = elapsedSeconds(usePomodoroStore.getState())
  const remaining = remainingSeconds(usePomodoroStore.getState())

  // Progress 0..1 — used for the ring stroke offset.
  const progress = durationSec > 0 ? Math.min(1, elapsed / durationSec) : 0

  function handleStop() {
    const snap = consumeForLog()
    if (snap && snap.durationSec >= 60) {
      log.mutate({
        taskId: snap.taskId,
        durationSec: snap.durationSec,
        startedAt: snap.startedAtSec,
        completedAt: snap.completedAtSec,
      })
    }
  }

  function handleDismiss() {
    if (status === 'completed') {
      // The session already ran to completion — log full duration.
      const snap = consumeForLog()
      if (snap && snap.durationSec >= 60) {
        log.mutate({
          taskId: snap.taskId,
          durationSec: snap.durationSec,
          startedAt: snap.startedAtSec,
          completedAt: snap.completedAtSec,
        })
      } else {
        reset()
      }
    } else {
      reset()
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-16 right-16 z-50',
        'flex items-center gap-12',
        'rounded-pill bg-surface px-12 py-8 shadow-e2',
        'anim-scale-in',
        'max-w-[min(90vw,360px)]',
      )}
    >
      <ProgressRing progress={progress} status={status} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-label font-medium text-on-surface">
          {taskTitle ?? 'Focus session'}
        </span>
        <span className="text-caption tabular-nums text-on-surface-muted">
          {status === 'completed'
            ? `Done · ${formatDurationShort(elapsed)}`
            : status === 'paused'
              ? `Paused · ${formatTime(remaining)} left`
              : `${formatTime(remaining)} left`}
        </span>
      </div>

      {status === 'completed' ? (
        <Button
          variant="text"
          size="icon"
          onClick={handleDismiss}
          aria-label="Dismiss completed session"
        >
          <X className="h-16 w-16" aria-hidden="true" />
        </Button>
      ) : (
        <>
          {status === 'running' ? (
            <Button
              variant="text"
              size="icon"
              onClick={pause}
              aria-label="Pause timer"
            >
              <Pause className="h-16 w-16" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="text"
              size="icon"
              onClick={resume}
              aria-label="Resume timer"
            >
              <Play className="h-16 w-16" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="text"
            size="icon"
            onClick={handleStop}
            aria-label="Stop timer and log"
          >
            <Square className="h-16 w-16" aria-hidden="true" />
          </Button>
        </>
      )}
      {/* Hidden taskId reference so future a11y / testing can correlate
          the timer to the task it's focused on without poking the store. */}
      {taskId && (
        <span className="sr-only" data-task-id={taskId}>
          Focusing on task {taskId}
        </span>
      )}
    </div>
  )
}

/**
 * Small ring that fills clockwise as the session progresses. Uses an
 * inline SVG so we don't pay the bundle cost of a chart library and
 * can match the design tokens exactly.
 */
function ProgressRing({
  progress,
  status,
}: {
  progress: number
  status: 'running' | 'paused' | 'completed' | 'idle'
}) {
  const size = 32
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - progress)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={
          status === 'completed'
            ? 'var(--color-brand-conservatory)'
            : 'var(--color-brand-brass)'
        }
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
      />
    </svg>
  )
}

/** `12:34` mm:ss format for timer countdown. */
function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
