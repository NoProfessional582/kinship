import { describe, expect, it } from 'vitest'
import {
  calendarDate,
  canOfferCreate,
  entryTitle,
  normalizeLabel,
  initials,
  MAX_CREATE_LEN,
} from '@/lib/utils'

describe('normalizeLabel', () => {
  it('is case and whitespace insensitive, which is what dedupes @Sarah vs @sarah', () => {
    expect(normalizeLabel('  Sarah   Chen ')).toBe(normalizeLabel('sarah chen'))
  })
})

describe('initials', () => {
  it('uses first and last for a full name', () => expect(initials('Maya Okafor')).toBe('MO'))
  it('uses two letters for a single name', () => expect(initials('Prince')).toBe('PR'))
  it('skips middle names', () => expect(initials('Ada B C Lovelace')).toBe('AL'))
  it('degrades safely on empty input', () => expect(initials('   ')).toBe('?'))
})

describe('canOfferCreate', () => {
  it('offers create for a plain name', () => {
    expect(canOfferCreate('Maya Okafor')).toBe(true)
  })

  it('offers create for a multi-word task title', () => {
    expect(canOfferCreate('Draft the sitemap')).toBe(true)
  })

  it('withholds create for an empty query', () => {
    expect(canOfferCreate('   ')).toBe(false)
  })

  it('withholds create once the query becomes a sentence', () => {
    // What a user typing prose after "@" would otherwise be offered.
    expect(canOfferCreate('Maya and then I kept writing a whole sentence here')).toBe(false)
  })

  it('withholds create past the length bound even with few words', () => {
    expect(canOfferCreate('a'.repeat(MAX_CREATE_LEN + 1))).toBe(false)
  })

  it('accepts a query exactly at the length bound', () => {
    expect(canOfferCreate('a'.repeat(MAX_CREATE_LEN))).toBe(true)
  })

  it('ignores surrounding whitespace when measuring', () => {
    expect(canOfferCreate('  Rafael Ortiz  ')).toBe(true)
  })
})

describe('entryTitle', () => {
  it('uses the writer\u2019s title when there is one', () => {
    expect(entryTitle({ title: 'Kickoff call' })).toBe('Kickoff call')
  })

  it('falls back to Untitled when absent', () => {
    expect(entryTitle({ title: null })).toBe('Untitled')
    expect(entryTitle({})).toBe('Untitled')
  })

  it('treats a whitespace-only title as absent', () => {
    expect(entryTitle({ title: '   ' })).toBe('Untitled')
  })

  it('does not invent a title from anything else', () => {
    // The body is deliberately not consulted -- untitled stays untitled.
    expect(entryTitle({ title: '' })).toBe('Untitled')
  })
})

describe('calendarDate', () => {
  it('keeps the calendar day for a UTC-midnight date-only value', () => {
    // A birthday stored as the 14th must not render as the 13th west of UTC.
    const d = calendarDate('1988-06-14T00:00:00.000Z')!
    expect(d.getFullYear()).toBe(1988)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(14)
  })

  it('accepts a plain YYYY-MM-DD string', () => {
    const d = calendarDate('2026-01-01')!
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
  })

  it('accepts a Date instance', () => {
    const d = calendarDate(new Date(Date.UTC(2026, 11, 31)))!
    expect(d.getMonth()).toBe(11)
    expect(d.getDate()).toBe(31)
  })

  it('returns null for absent input', () => {
    expect(calendarDate(null)).toBeNull()
    expect(calendarDate(undefined)).toBeNull()
    expect(calendarDate('')).toBeNull()
  })
})
