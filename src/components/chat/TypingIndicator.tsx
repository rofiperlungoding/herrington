import { cn } from '@/lib/utils'

/**
 * Typing indicator shown while the assistant is producing a reply.
 *
 * Three dots that pulse in sequence — a small ambient cue rather than
 * a full progress bar. Respects `prefers-reduced-motion` via the
 * shared keyframe utilities, so on reduced-motion devices the dots
 * stay visible but stop animating.
 *
 * Optional `label` lets the parent surface a short tool-call status
 * (e.g. "Reading Gmail", "Creating event") next to the dots so the
 * user can see what the assistant is currently doing.
 */
export function TypingIndicator({
  label,
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Assistant is thinking'}
      className={cn(
        'inline-flex items-center gap-8 rounded-lg bg-surface-variant px-12 py-8',
        className,
      )}
    >
      <span className="flex items-center gap-4">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
      {label && (
        <span className="text-caption text-on-surface-muted">{label}</span>
      )}
    </div>
  )
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-8 w-8 rounded-full bg-on-surface-muted"
      style={{
        animation: 'typing-bounce 1.2s ease-in-out infinite',
        animationDelay: `${delay}ms`,
      }}
    />
  )
}
