import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertCircle, CheckSquare, Focus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { TaskItemSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { NaturalTaskInput } from '@/components/tasks/NaturalTaskInput'
import { TaskCreateForm } from '@/components/tasks/TaskCreateForm'
import { TaskFilterBar, filterTasksByTags } from '@/components/tasks/TaskFilterBar'
import { TaskItem } from '@/components/tasks/TaskItem'
import { useTasks, tasksListQueryOptions } from '@/hooks/useTasks'
import { BreakEngine } from '@/components/tasks/BreakEngine'

const ZenMode = React.lazy(() =>
  import('@/components/tasks/ZenMode').then((m) => ({ default: m.ZenMode })),
)

/**
 * Task Manager page (`/tasks`).
 *
 * Top of page: smart natural-language input — user types a sentence,
 * Mistral parses it into a task. The classic structured form is still
 * available below (collapsed) for users who prefer explicit fields.
 *
 * Header offers a "Zen mode" toggle that swaps the entire list for a
 * single-task focus view (pickFocus picks the most urgent incomplete task).
 */
export const Route = createFileRoute('/_authed/tasks')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(tasksListQueryOptions).catch(() => {
      // Allow the component to mount and render <ErrorState> via query.isError.
    }),
  component: TasksPage,
})

function TasksPage() {
  const query = useTasks()
  const [zen, setZen] = React.useState(false)
  const [showStructuredForm, setShowStructuredForm] = React.useState(false)
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])

  const allTasks = query.data?.tasks ?? []
  const tasks = filterTasksByTags(allTasks, selectedTags)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-24 p-24 md:p-32">
      <PageHeader
        eyebrow="Today"
        title="Tasks"
        description={
          query.data?.tasks
            ? selectedTags.length > 0
              ? `${tasks.length} of ${allTasks.length} matching · type naturally below`
              : `${tasks.length} on the board · type naturally below`
            : 'Type naturally — the assistant figures out the rest.'
        }
        action={
          <Button
            variant="text"
            onClick={() => setZen(true)}
            disabled={!query.data || tasks.length === 0}
          >
            <Focus className="h-16 w-16" aria-hidden="true" />
            Zen mode
          </Button>
        }
      />

      {/* Smart input */}
      <div className="flex flex-col gap-12">
        <NaturalTaskInput />
        <button
          type="button"
          onClick={() => setShowStructuredForm((v) => !v)}
          className="self-start text-caption text-on-surface-muted underline-offset-2 hover:underline"
        >
          {showStructuredForm
            ? 'Hide manual form'
            : 'Or fill the form manually'}
        </button>
        {showStructuredForm && <TaskCreateForm />}
      </div>

      {/* Spontaneous Break Engine */}
      <BreakEngine />

      {/* Tag filter — only renders when there are tagged tasks */}
      <TaskFilterBar
        tasks={allTasks}
        selected={selectedTags}
        onChange={setSelectedTags}
      />

      {/* Feedback states */}
      <div>
        {query.isPending && !query.data ? (
          <ul
            className="flex flex-col gap-8"
            aria-busy="true"
            aria-label="Loading tasks"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <TaskItemSkeleton key={i} />
            ))}
          </ul>
        ) : query.isError ? (
          <ErrorState
            icon={<AlertCircle className="h-32 w-32" />}
            title="Couldn't load your tasks"
            description="Something didn't go through. Mind trying again?"
            action={
              <Button variant="secondary" onClick={() => query.refetch()}>
                Retry
              </Button>
            }
          />
        ) : tasks.length === 0 ? (
          selectedTags.length > 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-32 w-32" />}
              title="Nothing matching"
              description={`No tasks carry ${selectedTags
                .map((t) => `"${t}"`)
                .join(' + ')} right now. Clear the filter to see the rest.`}
            />
          ) : (
            <EmptyState
              icon={<CheckSquare className="h-32 w-32" />}
              title="A quiet board"
              description='Type naturally above — try "team meeting friday at 2 pm" — and the rest is looked after.'
            />
          )
        ) : (
          <div className="anim-stagger flex flex-col gap-8" role="list">
            {tasks.map((task, i) => (
              <TaskItem
                key={task.id}
                task={task}
                style={{ ['--anim-i' as string]: i }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Zen mode overlay */}
      {zen && (
        <React.Suspense fallback={null}>
          <ZenMode tasks={tasks} onClose={() => setZen(false)} />
        </React.Suspense>
      )}
    </div>
  )
}
