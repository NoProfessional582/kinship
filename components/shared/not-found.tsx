'use client'
import Link from 'next/link'
import { ArrowLeft, SearchX } from 'lucide-react'
import { isNotFound } from '@/lib/hooks/api'

/** The words for a record that did not load: a 404 or no error is "not found". */
export function notFoundText(error: unknown, what: string) {
  return !error || isNotFound(error)
    ? { title: `${what} not found`, hint: 'It may have been deleted, or the link is wrong.' }
    : {
        title: `Could not load this ${what.toLowerCase()}`,
        hint: error instanceof Error ? error.message : 'Something went wrong.',
      }
}

/**
 * What a detail page shows when its record did not load: "not found" for the
 * API's 404 (an unknown or deleted id), the error's message for anything else,
 * and a way back either way. Used by the desktop pages and the ones under /m.
 */
export function NotFound({
  error,
  what,
  href,
  back,
}: {
  /** The query's error; a 404 or none reads as "not found". */
  error: unknown
  /** The kind of record, capitalised: "Contact". */
  what: string
  /** Where the way back leads, and its label. */
  href: string
  back: string
}) {
  const { title, hint } = notFoundText(error, what)
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <SearchX className="h-7 w-7 text-[var(--muted-foreground)] opacity-60" />
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="max-w-xs text-sm text-[var(--muted-foreground)]">{hint}</p>
      <Link
        href={href}
        className="kb-tap inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {back}
      </Link>
    </div>
  )
}
