import * as React from 'react'

import { ListItem } from '@/components/ui/list-item'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/tasks/TagInput'
import { formatLocal } from '@/lib/date'
import { useToggleTaskCompletion } from '@/hooks/useToggleTaskCompletion'
import { useDeleteTask, useRescheduleTask } from '@/hooks/useTasks'
import type { Task } from '@/shared/api/tasks.contracts'
import {
  AlertTriangle,
  Calendar,
  MoreVertical,
  Pencil,
  Scissors,
  Timer,
} from 'lucide-react'
import { cn } from '@/lib/utils'

import { useTaskTimeMap, formatDurationShort } from '@/hooks/usePomodoro'
import { usePomodoroStore } from '@/stores/pomodoroStore'

const TaskEditDialog = React.lazy(() =>
  import('./TaskEditDialog').then((m) => ({ default: m.TaskEditDialog })),
)
const TaskSliceDialog = React.lazy(() =>
  import('./TaskSliceDialog').then((m) => ({ default: m.TaskSliceDialog })),
)

/**
 * Single task row with three quick actions reachable via the trailing
 * "more" menu:
 *
 *   - Edit          → opens TaskEditDialog
 *   - Slice         → opens TaskSliceDialog (AI breaks the task down)
 *   - Reschedule    → bumps the deadline forward by 1 day; if the user
 *                     hits this 3 days in a row, an AI-flavored nudge
 *                     replaces the row's meta line.
 *
 * Wrapped in `React.memo` so the list doesn't re-render every row when
 * a sibling changes.
 */
export const TaskItem = React.memo(function TaskItem({
  task,
  style,
}: {
  task: Task
  style?: React.CSSProperties
}) {
  const toggle = useToggleTaskCompletion()
  const reschedule = useRescheduleTask()
  const del = useDeleteTask()
  const startFocus = usePomodoroStore((s) => s.start)
  const timerStatus = usePomodoroStore((s) => s.status)
  const timeMap = useTaskTimeMap()
  const timeSpent = timeMap.get(task.id) ?? 0
  const [editOpen, setEditOpen] = React.useState(false)
  const [sliceOpen, setSliceOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const isOverdue =
    task.deadline != null &&
    !task.isCompleted &&
    task.deadline * 1000 < Date.now()

  // Same "shame mode" rule as before — pushed to tomorrow 3+ times in a row.
  const isShamed = task.rescheduleCount >= 3 && !task.isCompleted

  // Auto-vanish when completed: 3-second countdown, then fade out, then
  // DELETE the row from the DB. The user can untick within the countdown
  // window to cancel — we reset the state if `task.isCompleted` flips
  // back to `false` mid-countdown.
  const wasCompletedOnMountRef = React.useRef(task.isCompleted)
  const COUNTDOWN_TOTAL = 3
  const [secondsLeft, setSecondsLeft] = React.useState<number>(COUNTDOWN_TOTAL)
  const [fadingOut, setFadingOut] = React.useState(false)
  const [hidden, setHidden] = React.useState<boolean>(
    () => wasCompletedOnMountRef.current,
  )
  const deleteFiredRef = React.useRef(false)

  // Reset the countdown when the user un-completes the task (untick).
  React.useEffect(() => {
    if (!task.isCompleted) {
      setSecondsLeft(COUNTDOWN_TOTAL)
      setFadingOut(false)
      // Note: we don't unhide here. If the row was hidden because it
      // was completed-on-mount, that decision stays — un-completing
      // requires the parent list to re-render, which would mount a
      // fresh TaskItem.
    }
  }, [task.isCompleted])

  // Tick down once per second once the user just completed the task.
  React.useEffect(() => {
    if (!task.isCompleted || hidden || fadingOut) return
    if (wasCompletedOnMountRef.current) return // mount-already-done, no animation
    if (secondsLeft <= 0) {
      setFadingOut(true)
      return
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [task.isCompleted, secondsLeft, fadingOut, hidden])

  // After fade-out: hide locally + DELETE from DB.
  React.useEffect(() => {
    if (!fadingOut) return
    const t = window.setTimeout(() => {
      setHidden(true)
      if (!deleteFiredRef.current) {
        deleteFiredRef.current = true
        del.mutate(task.id)
      }
    }, 500)
    return () => window.clearTimeout(t)
  }, [fadingOut, task.id, del])

  // Already-completed-on-mount → fire delete once, no animation.
  React.useEffect(() => {
    if (
      wasCompletedOnMountRef.current &&
      hidden &&
      !deleteFiredRef.current
    ) {
      deleteFiredRef.current = true
      del.mutate(task.id)
    }
  }, [hidden, task.id, del])

  if (hidden) return null

  return (
    <>
      <div
        className="transition-all duration-500 ease-out"
        style={{
          ...style,
          opacity: fadingOut ? 0 : 1,
          transform: fadingOut ? 'translateX(20px)' : 'translateX(0)',
          maxHeight: fadingOut ? '0px' : '200px',
          // Only clip while fading out — otherwise the action menu
          // dropdown gets cut off by the row's bounding box.
          overflow: fadingOut ? 'hidden' : 'visible',
          marginBottom: fadingOut ? '0px' : undefined,
        }}
      >
        <ListItem
          tone={isOverdue ? 'error' : task.isCompleted ? 'success' : 'default'}
          leading={
            <Checkbox
              checked={task.isCompleted}
              onCheckedChange={(v) => {
                toggle.mutate({ id: task.id, isCompleted: v === true })
              }}
            />
          }
          title={
            <span className="flex items-center gap-8">
              <span
                className={
                  task.isCompleted
                    ? 'line-through text-on-surface-muted'
                    : undefined
                }
              >
                {task.title}
              </span>
              {task.tags.length > 0 && (
                <span className="flex flex-wrap items-center gap-4">
                  {task.tags.map((t) => (
                    <Chip key={t} label={t} />
                  ))}
                </span>
              )}
            </span>
          }
          meta={
            task.isCompleted && !fadingOut && secondsLeft > 0 ? (
              <span className="text-on-surface-muted">
                deleting in {secondsLeft}s
              </span>
            ) : isShamed ? (
              <span className="text-on-surface-muted">
                pushed {task.rescheduleCount}× — maybe slice it instead?
              </span>
            ) : task.deadline != null ? (
              isOverdue ? (
                <span className="flex items-center gap-8">
                  <span className="flex items-center gap-4">
                    <AlertTriangle className="h-12 w-12" aria-hidden="true" />
                    Overdue
                  </span>
                  {timeSpent >= 60 && (
                    <span className="text-on-surface-muted">
                      · {formatDurationShort(timeSpent)} focused
                    </span>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-8">
                  <time>{formatLocal(task.deadline)}</time>
                  {timeSpent >= 60 && (
                    <span className="text-on-surface-muted">
                      · {formatDurationShort(timeSpent)} focused
                    </span>
                  )}
                </span>
              )
            ) : timeSpent >= 60 ? (
              <span className="text-on-surface-muted">
                {formatDurationShort(timeSpent)} focused
              </span>
            ) : undefined
          }
          trailing={
            <ActionMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              taskTitle={task.title}
              disabled={task.isCompleted}
              focusDisabled={task.isCompleted || timerStatus !== 'idle'}
              onEdit={() => {
                setMenuOpen(false)
                setEditOpen(true)
              }}
              onSlice={() => {
                setMenuOpen(false)
                setSliceOpen(true)
              }}
              onReschedule={() => {
                setMenuOpen(false)
                if (!reschedule.isPending) {
                  reschedule.mutate(task.id)
                }
              }}
              onFocus={() => {
                setMenuOpen(false)
                startFocus({
                  taskId: task.id,
                  taskTitle: task.title,
                  durationSec: 25 * 60,
                })
              }}
            />
          }
        />
      </div>
      {editOpen && (
        <React.Suspense fallback={null}>
          <TaskEditDialog
            task={task}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
        </React.Suspense>
      )}
      {sliceOpen && (
        <React.Suspense fallback={null}>
          <TaskSliceDialog
            task={task}
            open={sliceOpen}
            onOpenChange={setSliceOpen}
          />
        </React.Suspense>
      )}
    </>
  )
})

/**
 * Trailing-slot action menu. Click the "..." button to reveal Edit /
 * Slice / Reschedule. Click anywhere else to dismiss.
 */
function ActionMenu({
  open,
  onOpenChange,
  taskTitle,
  disabled,
  focusDisabled,
  onEdit,
  onSlice,
  onReschedule,
  onFocus,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  taskTitle: string
  disabled: boolean
  focusDisabled: boolean
  onEdit: () => void
  onSlice: () => void
  onReschedule: () => void
  onFocus: () => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Close the menu when clicking outside or pressing Escape.
  React.useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="text"
        size="icon"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${taskTitle}`}
      >
        <MoreVertical className="h-20 w-20" />
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-10 mt-4 flex w-48 flex-col',
            'rounded-md bg-surface shadow-e2',
            'anim-scale-in',
          )}
          style={{ width: '180px' }}
        >
          <MenuItem
            icon={<Pencil className="h-16 w-16" aria-hidden="true" />}
            label="Edit"
            onClick={onEdit}
          />
          <MenuItem
            icon={<Timer className="h-16 w-16" aria-hidden="true" />}
            label="Start 25-min focus"
            onClick={onFocus}
            disabled={focusDisabled}
          />
          <MenuItem
            icon={<Scissors className="h-16 w-16" aria-hidden="true" />}
            label="Slice with AI"
            onClick={onSlice}
            disabled={disabled}
          />
          <MenuItem
            icon={<Calendar className="h-16 w-16" aria-hidden="true" />}
            label="Push to tomorrow"
            onClick={onReschedule}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-8 px-12 py-8 text-left text-label',
        'transition-colors duration-fast ease-standard',
        'first:rounded-t-md last:rounded-b-md',
        disabled
          ? 'cursor-not-allowed text-on-surface-muted opacity-60'
          : 'text-on-surface hover:bg-surface-variant',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
