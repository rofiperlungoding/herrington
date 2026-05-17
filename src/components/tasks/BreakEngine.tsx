import * as React from 'react'
import { Coffee } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useBreakRecommend, type BreakRecommendation } from '@/hooks/useAi'

/**
 * Spontaneous Break Engine — "Aku Bosan" button.
 *
 * Asks the AI for three short, time-aware recharge ideas. The
 * recommendation set varies with the user's local hour (early →
 * calm wake-up activities, afternoon slump → low-effort reset, etc.)
 * so the same button feels different at 09:00 vs 16:00 vs 22:00.
 *
 * Visual: matches the Tasks page tone — borderless ambient list, plain
 * text actions, no card-in-card chrome.
 */
export function BreakEngine() {
  const recommend = useBreakRecommend()
  const [recs, setRecs] = React.useState<BreakRecommendation[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  function handleClick() {
    setError(null)
    recommend.mutate(
      {},
      {
        onSuccess: (data) => setRecs(data.recommendations),
        onError: (err) =>
          setError(
            err instanceof Error
              ? err.message
              : 'Couldn\'t fetch ideas right now.',
          ),
      },
    )
  }

  function handleReset() {
    setRecs(null)
    setError(null)
  }

  if (recs) {
    return (
      <div className="anim-fade-in flex flex-col gap-12">
        <ul className="anim-stagger flex flex-col gap-8">
          {recs.map((r, i) => (
            <li
              key={i}
              style={{ ['--anim-i' as string]: i }}
              className="flex flex-col gap-4 rounded-md bg-surface-variant px-12 py-8"
            >
              <div className="flex items-baseline justify-between gap-8">
                <p className="text-body font-medium text-on-surface">
                  {r.title}
                </p>
                <span className="shrink-0 text-caption text-on-surface-muted">
                  {r.duration}
                </span>
              </div>
              <p className="text-caption text-on-surface-muted">{r.why}</p>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-16 text-caption">
          <button
            type="button"
            onClick={handleClick}
            disabled={recommend.isPending}
            className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
          >
            {recommend.isPending ? 'Thinking…' : 'New ideas'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="text-on-surface-muted underline-offset-2 hover:underline"
          >
            Close
          </button>
        </div>

        {error && (
          <p role="alert" className="text-caption text-error">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <Button
        variant="secondary"
        onClick={handleClick}
        disabled={recommend.isPending}
        loading={recommend.isPending}
      >
        <Coffee className="h-16 w-16" aria-hidden="true" />
        I'm bored, give me ideas
      </Button>
      {error && (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      )}
    </div>
  )
}
