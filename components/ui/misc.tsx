'use client'
import * as React from 'react'
import { cn, initials } from '@/lib/utils'

// ------------------------------------------------------------------ Avatar

export function Avatar({
  name,
  size = 32,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] font-medium text-[var(--accent-foreground)]',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
    >
      {initials(name)}
    </span>
  )
}

// ------------------------------------------------------------ Badge / Card

export function Badge({
  className,
  style,
  children,
}: {
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] [box-shadow:var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  )
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {Icon && <Icon className="h-7 w-7 text-[var(--muted-foreground)] opacity-60" />}
      <p className="text-sm font-medium text-[var(--muted-foreground)]">{title}</p>
      {hint && <p className="max-w-xs text-xs text-[var(--muted-foreground)] opacity-75">{hint}</p>}
    </div>
  )
}
