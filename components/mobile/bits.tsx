'use client'
import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The mobile GUI's small shared parts. The desktop equivalents are built for a
 * wide card on a pointer device — generous padding, hover affordances, a
 * multi-column grid — and none of that survives a 412px column, so these are
 * deliberately their own thing rather than the desktop ones with overrides.
 */

/**
 * The surface a group of objects sits on. The desktop separates one object from
 * the next with `Card` — a bordered, shadowed panel lifted off the paper
 * background — and the mobile GUI was drawing its lists straight onto the page
 * instead, so two adjacent sections ran together with nothing between them but
 * a mono label. Same idea as the desktop card at phone density: the same
 * `--shadow-card`, less padding.
 */
export function MTile({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 [box-shadow:var(--shadow-card)]',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}

/**
 * A labelled band. Quiet mono label above the tile, content inside it, so the
 * label reads as a caption for the panel rather than as a row within it.
 *
 * `bare` is for a section whose children bring their own surface — the board's
 * column stack, where every column is already a tile and one more around the
 * whole lot is a box in a box.
 */
export function Section({
  title,
  action,
  children,
  className,
  bare,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bare?: boolean
}) {
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {title && (
            <h2 className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {bare ? children : <MTile>{children}</MTile>}
    </section>
  )
}

/**
 * One line, not a panel. The desktop `EmptyState` spends 80px of vertical
 * padding announcing that nothing is there, which on a phone pushes the next
 * real section off the screen.
 */
export function MEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[13px] text-[var(--muted-foreground)] opacity-80">{children}</p>
}

/** A separated list. Borders between rows rather than a card each. */
export function MList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('flex flex-col', className)}>{children}</ul>
}

/**
 * The list row every mobile screen is built from. Renders as a link or a
 * button depending on what it was given, so a row is one tap target either way
 * rather than a div with a clickable region inside it.
 */
export function MRow({
  href,
  onClick,
  lead,
  title,
  meta,
  sub,
  chevron,
  className,
}: {
  href?: string
  onClick?: () => void
  lead?: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  sub?: React.ReactNode
  chevron?: boolean
  className?: string
}) {
  const inner = (
    <>
      {lead && <span className="flex shrink-0 items-center">{lead}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm">{title}</span>
        {sub && <span className="truncate text-[11px] text-[var(--muted-foreground)]">{sub}</span>}
      </span>
      {meta && (
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">
          {meta}
        </span>
      )}
      {chevron && (
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] opacity-50" />
      )}
    </>
  )
  const cls = cn('kb-tap flex w-full items-center gap-2.5 py-2 text-left', className)
  // The divider belongs to the `li`, not to the link inside it. On the link,
  // `last:border-0` matched *every* row — a link is always the only, and
  // therefore the last, child of its own `li` — so the separators this list has
  // been asking for since it was written never drew at all. On the `li` the
  // variant means what it reads as: every row but the last.
  const item = 'border-b border-[var(--border)] last:border-0'
  if (href)
    return (
      <li className={item}>
        <Link href={href} className={cls}>
          {inner}
        </Link>
      </li>
    )
  return (
    <li className={item}>
      <button onClick={onClick} className={cls}>
        {inner}
      </button>
    </li>
  )
}
