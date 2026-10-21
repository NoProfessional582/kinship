import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The one header every desktop page but the dashboard uses: an eyebrow, the
 * display-face title and a line of description, with the page's controls on
 * the description's line. Pages place it at the top of the shared measure
 * (`px-6 pt-8 lg:px-8`) so the title lands in the same spot on every screen.
 *
 * Deliberately not flex-wrap. A wrapping flex line moves the whole controls
 * group onto its own row the moment the header runs out of width; shrinking
 * the prose instead keeps them on the description's line.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-6 flex items-end justify-between gap-4', className)}>
      <div className="min-w-0 flex-1">
        <p className="h-4 truncate font-mono text-[11px] leading-4 uppercase tracking-[0.14em] text-[var(--primary)]">
          {eyebrow}
        </p>
        <h1 className="mt-1 min-h-[1.1em] text-[2.6rem] leading-[1.08]">{title}</h1>
        {description && (
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-end gap-2">{actions}</div>}
    </header>
  )
}
