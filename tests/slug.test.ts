import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug, type SlugClient } from '@/lib/slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => expect(slugify('Sarah Chen')).toBe('sarah-chen'))
  it('strips diacritics', () => expect(slugify('Tobias Lindqvíst')).toBe('tobias-lindqvist'))
  it('collapses punctuation runs', () =>
    expect(slugify('Q3 — Planning!! (draft)')).toBe('q3-planning-draft'))
  it('trims leading and trailing separators', () => expect(slugify('  --hello--  ')).toBe('hello'))
  it('falls back for input with nothing sluggable', () => expect(slugify('!!!')).toBe('untitled'))
})

describe('uniqueSlug', () => {
  const owner = 'slug-test-owner'
  /** Stands in for a Prisma delegate over a fixed set of taken slugs. */
  const dbWith = (existing: string[]) => {
    const set = new Set(existing)
    const delegate = {
      findFirst: async ({ where }: { where: { slug: string } }) =>
        set.has(where.slug) ? { id: 'x' } : null,
    }
    const client: SlugClient = { contact: delegate, task: delegate, project: delegate }
    return client
  }

  it('returns the bare slug when free', async () => {
    expect(await uniqueSlug('contact', owner, 'Sarah Chen', dbWith([]))).toBe('sarah-chen')
  })

  it('suffixes on collision', async () => {
    expect(await uniqueSlug('contact', owner, 'Sarah Chen', dbWith(['sarah-chen']))).toBe(
      'sarah-chen-2',
    )
  })

  it('walks past a run of collisions', async () => {
    const db = dbWith(['sarah-chen', 'sarah-chen-2', 'sarah-chen-3'])
    expect(await uniqueSlug('contact', owner, 'Sarah Chen', db)).toBe('sarah-chen-4')
  })

  it('reserves within one transaction, before anything is written', async () => {
    const db = dbWith([])
    const taken = new Set<string>()
    const first = await uniqueSlug('contact', owner, 'Sarah Chen', db, taken)
    const second = await uniqueSlug('contact', owner, 'Sarah Chen', db, taken)
    expect(first).toBe('sarah-chen')
    expect(second).toBe('sarah-chen-2')
  })
})
