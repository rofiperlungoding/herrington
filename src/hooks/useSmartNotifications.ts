import * as React from 'react'

import { useTasks } from '@/hooks/useTasks'
import { useHabits } from '@/hooks/useHabits'
import { isSameLocalDay } from '@/lib/date'
import { getUserTimezone } from '@/lib/timezone'
import type { Task } from '@/shared/api/tasks.contracts'
import type { Habit } from '@/shared/api/habits.contracts'

/**
 * Smart Notifications.
 *
 * Polls the user's tasks and habits once a minute and fires browser
 * notifications when a deadline / streak condition becomes urgent.
 * No backend, no scheduled functions, no third-party service — the
 * tab just needs to be open.
 *
 * Triggers:
 *   1. **Task deadline approaching** — task is incomplete, deadline
 *      is in the next 2 hours, and we haven't notified about THIS
 *      task in the last 90 minutes. Body says "<title> is due in
 *      <X>" with the rounded time-to-deadline.
 *   2. **Streak save** — daily habit, has a non-zero current streak,
 *      hasn't been checked off today, local time is between 22:00
 *      and 23:55, and we haven't notified about this habit today.
 *
 * Per-item dedup keys live in localStorage (`herrington.notif.<id>`) so a
 * page reload doesn't re-spam the user. Keys older than 24h are
 * pruned at startup so the store doesn't grow forever.
 *
 * The hook returns `{ enabled, permission, requestPermission, setEnabled }`
 * so the Settings page can render a toggle that asks for permission
 * the first time it's flipped on.
 */

type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

const ENABLED_KEY = 'herrington.notif.enabled'
const KEY_PREFIX = 'herrington.notif.'
const POLL_MS = 60_000
const TASK_NUDGE_WINDOW_MS = 2 * 60 * 60 * 1000
const TASK_NUDGE_COOLDOWN_MS = 90 * 60 * 1000
const STREAK_HOUR_START = 22
const STREAK_HOUR_END = 24

export function useSmartNotifications() {
  const tasks = useTasks()
  const habits = useHabits()

  const [permission, setPermission] = React.useState<Permission>(() =>
    detectPermission(),
  )
  const [enabled, setEnabledState] = React.useState<boolean>(() =>
    readBool(ENABLED_KEY, false),
  )

  // Prune stale dedup keys on first mount.
  React.useEffect(() => {
    pruneStaleKeys()
  }, [])

  const setEnabled = React.useCallback((value: boolean) => {
    setEnabledState(value)
    try {
      localStorage.setItem(ENABLED_KEY, value ? '1' : '0')
    } catch {
      // private mode etc — fail silent
    }
  }, [])

  const requestPermission = React.useCallback(async (): Promise<Permission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported')
      return 'unsupported'
    }
    try {
      const result = await Notification.requestPermission()
      const next = result as Permission
      setPermission(next)
      return next
    } catch {
      setPermission('denied')
      return 'denied'
    }
  }, [])

  // Polling loop. Stops when the tab is hidden and resumes on
  // visibility change so we don't burn CPU in the background.
  const taskList = tasks.data?.tasks ?? []
  const habitList = habits.data?.habits ?? []

  React.useEffect(() => {
    if (!enabled || permission !== 'granted') return
    if (typeof window === 'undefined') return

    let cancelled = false

    function tick() {
      if (cancelled || document.hidden) return
      checkTasks(taskList)
      checkHabits(habitList)
    }

    // Run immediately so the user doesn't have to wait a full minute
    // after enabling.
    tick()
    const id = window.setInterval(tick, POLL_MS)

    function onVisibility() {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, permission, taskList, habitList])

  return {
    permission,
    enabled,
    setEnabled,
    requestPermission,
  }
}

// ─── Trigger conditions ────────────────────────────────────────────────────

function checkTasks(tasks: Task[]) {
  const nowMs = Date.now()
  for (const task of tasks) {
    if (task.isCompleted) continue
    if (task.deadline == null) continue
    const deadlineMs = task.deadline * 1000
    const dt = deadlineMs - nowMs
    if (dt < 0) continue // already overdue — handled by the row's own UI
    if (dt > TASK_NUDGE_WINDOW_MS) continue

    const key = `task:${task.id}`
    const last = readNumber(KEY_PREFIX + key)
    if (last && nowMs - last < TASK_NUDGE_COOLDOWN_MS) continue

    fireNotification({
      tag: key,
      title: 'Deadline soon',
      body: `${task.title} is due in ${formatDelta(dt)}.`,
    })
    writeNumber(KEY_PREFIX + key, nowMs)
  }
}

function checkHabits(habits: Habit[]) {
  const nowMs = Date.now()
  const now = new Date(nowMs)
  const hour = now.getHours()
  if (hour < STREAK_HOUR_START || hour >= STREAK_HOUR_END) return

  const tz = getUserTimezone()
  const nowSec = Math.floor(nowMs / 1000)

  for (const h of habits) {
    if (h.kind !== 'daily') continue
    if (h.currentStreak <= 0) continue
    // Already checked off today?
    if (
      h.lastCompletedDate != null &&
      isSameLocalDay(h.lastCompletedDate, nowSec, tz)
    ) {
      continue
    }

    // Dedup once per local day.
    const dayKey = new Date(nowMs).toISOString().slice(0, 10)
    const key = `habit:${h.id}:${dayKey}`
    if (readNumber(KEY_PREFIX + key)) continue

    fireNotification({
      tag: key,
      title: 'Streak about to break',
      body: `Check off "${h.title}" before midnight to keep your ${h.currentStreak}-day streak.`,
    })
    writeNumber(KEY_PREFIX + key, nowMs)
  }
}

// ─── Browser bridge ────────────────────────────────────────────────────────

function detectPermission(): Permission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission as Permission
}

function fireNotification({
  tag,
  title,
  body,
}: {
  tag: string
  title: string
  body: string
}) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      body,
      tag,
      // Re-uses the same toast slot when the same `tag` fires again,
      // so the user doesn't get a stack of duplicates.
      icon: '/favicon.svg',
    })
  } catch {
    // Some environments throw when constructing Notification (e.g.,
    // service worker is required). Swallow — the in-app toast / row
    // is already handling the urgent case as a backup.
  }
}

// ─── Storage helpers ───────────────────────────────────────────────────────

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v == null) return fallback
    return v === '1' || v === 'true'
  } catch {
    return fallback
  }
}

function readNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    if (!v) return null
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // ignore quota / private mode
  }
}

function pruneStaleKeys() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const toDelete: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(KEY_PREFIX)) continue
      if (key === ENABLED_KEY) continue
      const v = localStorage.getItem(key)
      if (!v) continue
      const n = Number.parseInt(v, 10)
      if (Number.isFinite(n) && n < cutoff) toDelete.push(key)
    }
    for (const k of toDelete) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}

function formatDelta(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (rem === 0) return `${hours}h`
  return `${hours}h ${rem}m`
}
