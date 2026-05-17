import * as React from 'react'
import { WandSparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useParseTask } from '@/hooks/useAi'
import { useCreateTask } from '@/hooks/useTasks'
import { formatLocal } from '@/lib/date'
import { cn } from '@/lib/utils'

/**
 * Smart task input.
 *
 * The user types a single sentence — "Nugas AI besok jam 7 malam",
 * "buy groceries on saturday", "kerja capstone deadline jumat siang" —
 * and we route it through Mistral to extract `{title, category, deadline}`,
 * then immediately create the task.
 *
 * Two flows:
 *   1. Press Enter (or click Add) → parse + create in one go.
 *   2. After parse, briefly show a "preview chip" (title + deadline) so
 *      the user sees what the AI understood, then auto-creates. If the
 *      AI got it wrong they can hit Undo (we just delete the task) —
 *      but for simplicity v1 just trusts the parse and the user can
 *      edit/delete via the row's normal affordances.
 */
export function NaturalTaskInput() {
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const parse = useParseTask()
  const create = useCreateTask()

  const isPending = parse.isPending || create.isPending

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    const input = value.trim()
    if (!input || isPending) return

    setError(null)
    try {
      const parsed = await parse.mutateAsync(input)
      const title = parsed.title || input
      const category = parsed.category || 'personal'
      await create.mutateAsync({
        title,
        category,
        deadline: parsed.deadline,
        tags: parsed.tags,
      })
      setValue('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not understand that. Try a different phrasing.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSubmit} className="flex items-center gap-8">
        <div className="relative flex-1">
          <WandSparkles
            className={cn(
              'pointer-events-none absolute left-12 top-1/2 h-16 w-16 -translate-y-1/2',
              isPending ? 'text-primary animate-pulse' : 'text-on-surface-muted',
            )}
            aria-hidden="true"
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='Try "team meeting friday at 2 pm"'
            disabled={isPending}
            autoComplete="off"
            className="pl-32"
            aria-label="Natural language task input"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          disabled={!value.trim() || isPending}
        >
          Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      )}
      {parse.data && !isPending && (
        <p className="text-caption text-on-surface-muted">
          Last parsed:{' '}
          <span className="font-medium text-on-surface">{parse.data.title}</span>
          {parse.data.deadline != null && (
            <>
              {' · '}
              <time>{formatLocal(parse.data.deadline)}</time>
            </>
          )}
        </p>
      )}
    </div>
  )
}
