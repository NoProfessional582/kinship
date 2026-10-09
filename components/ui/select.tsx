'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Native select. Radix's Select brings a portal and scroll-locking that fights
 * the enrichment dialog; the native control behaves correctly inside one.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-sm shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'
