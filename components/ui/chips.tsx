'use client'
import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Free-form chip list, used for interests, hobbies and tags. */
export function ChipsInput({
  value,
  onChange,
  placeholder = 'Add and press Enter',
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = React.useState('')

  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (!value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v])
    setDraft('')
  }

  return (
    <div
      // kb-chips is the hook the dark capture card restyles through; Tailwind
      // classes here would otherwise win over any skin passed down.
      className={cn(
        'kb-chips flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-1.5',
        className,
      )}
    >
      {value.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs text-[var(--accent-foreground)]"
        >
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((c) => c !== chip))}
            className="opacity-60 transition hover:opacity-100"
            aria-label={`Remove ${chip}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
      />
    </div>
  )
}
