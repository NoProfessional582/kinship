import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Normalizes a label for dedup: lowercase, collapse internal whitespace. */
export function normalizeLabel(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Whether a suggestion query is short enough to offer "create new" for.
 *
 * The `@` and `[[` triggers run with `allowSpaces`, so the query extends to the
 * end of the line — that is what lets multi-word names match. Without a bound,
 * someone who types `@` and keeps writing prose would be offered "Create
 * contact" for the whole sentence. Only the create affordance is withheld past
 * this bound; real search results still show.
 */
export const MAX_CREATE_LEN = 60
export const MAX_CREATE_WORDS = 6

export function canOfferCreate(term: string): boolean {
  const trimmed = term.trim()
  if (!trimmed) return false
  if (trimmed.length > MAX_CREATE_LEN) return false
  return trimmed.split(/\s+/).filter(Boolean).length <= MAX_CREATE_WORDS
}

/**
 * What to show when an entry has no title of its own.
 *
 * The title is stored as NULL rather than the literal string, because
 * Entry.searchVector weights `title` at 'A' -- storing "Untitled" would put that
 * word at top weight on every untitled note and let a search for it match
 * everything. Absence stays absence in the data; the label lives in the UI.
 */
export function entryTitle(entry: { title?: string | null }): string {
  return entry.title?.trim() || 'Untitled'
}

/**
 * Renders a date-only value (Prisma `@db.Date`, or a date input's "YYYY-MM-DD")
 * as the calendar day it actually is.
 *
 * These arrive as UTC midnight. Passing that through `new Date()` and formatting
 * it in a timezone behind UTC yields the *previous* day — a birthday stored as
 * the 14th displaying as the 13th. Reading the Y/M/D parts directly and building
 * a local date keeps the calendar day intact regardless of the viewer's zone.
 */
export function calendarDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const iso = typeof value === 'string' ? value : value.toISOString()
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
