import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Compact tag input. Type → press Enter / comma to commit a tag.
 * Backspace on an empty buffer pops the last tag.
 *
 * Tags are lower-cased, deduped, capped at 24 chars / 8 total client-side
 * — same rules the server enforces in `tasks.ts#normalizeTags`. Keeping
 * the rules mirrored avoids a round-trip flicker when the optimistic
 * temp row is replaced by the real server row.
 */
export function TagInput({
  value,
  onChange,
  placeholder = 'Add tag…',
  id,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
}) {
  const [buf, setBuf] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  function commit(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, 24)
    if (!tag) return
    if (value.includes(tag)) return
    if (value.length >= 8) return
    onChange([...value, tag])
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(buf)
      setBuf('')
      return
    }
    if (e.key === 'Backspace' && buf.length === 0 && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  function handleBlur() {
    if (buf.trim().length > 0) {
      commit(buf)
      setBuf('')
    }
  }

  function removeAt(i: number) {
    const next = value.slice()
    next.splice(i, 1)
    onChange(next)
    inputRef.current?.focus()
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-md border border-border bg-surface px-8 py-4',
        'min-h-[40px]',
        'focus-within:border-on-surface',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, i) => (
        <Chip key={tag} label={tag} onRemove={() => removeAt(i)} />
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={buf}
        onChange={(e) => setBuf(e.target.value)}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ''}
        className={cn(
          'flex-1 min-w-[80px] bg-transparent text-body text-on-surface outline-none',
          'placeholder:text-on-surface-muted',
        )}
      />
    </div>
  )
}

/**
 * Read-only / interactive tag chip. When `onRemove` is supplied, the
 * chip renders an inline `×` button. When omitted (e.g. inside a
 * task row), the chip is purely decorative.
 */
export function Chip({
  label,
  onRemove,
  active,
  onClick,
}: {
  label: string
  onRemove?: () => void
  active?: boolean
  onClick?: () => void
}) {
  const interactive = !!onClick
  const Element = (interactive ? 'button' : 'span') as 'button' | 'span'
  return (
    <Element
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-4 rounded-pill px-8 py-4 text-caption',
        'transition-colors duration-fast ease-standard',
        active
          ? 'bg-primary text-on-primary'
          : 'bg-surface-variant text-on-surface-muted',
        interactive && !active && 'hover:text-on-surface',
      )}
    >
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${label}`}
          className={cn(
            'inline-flex h-12 w-12 items-center justify-center rounded-full',
            'transition-colors duration-fast ease-standard',
            'hover:bg-on-surface-muted/20',
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </Element>
  )
}
