import { describe, expect, it } from 'vitest'
import { createEntrySchema, updateEntrySchema } from '@/lib/validation'

const doc = { type: 'doc', content: [] }

describe('createEntrySchema', () => {
  it('fills in the usual values for keys a first save leaves out', () => {
    const out = createEntrySchema.parse({ bodyJson: doc })
    expect(out.kind).toBe('NOTE')
    expect(out.tags).toEqual([])
    expect(out.pendingEntities).toEqual([])
    expect(out.occurredAt).toBeInstanceOf(Date)
  })

  it('still refuses a null date rather than coercing it to the epoch', () => {
    expect(() => createEntrySchema.parse({ bodyJson: doc, occurredAt: null })).toThrow()
  })
})

describe('updateEntrySchema', () => {
  /**
   * The regression this guards: `createEntrySchema.partial()` left every
   * `.default()` alive, so a PATCH carrying only a body arrived at the service
   * with `occurredAt: now`, `kind: 'NOTE'` and `tags: []` attached — silently
   * re-dating the entry, resetting its kind and clearing its tags. `updateEntry`
   * writes any key that is not `undefined`, so absent has to stay absent.
   */
  it('adds nothing to a body-only patch', () => {
    const out = updateEntrySchema.parse({ bodyJson: doc })
    expect(Object.keys(out)).toEqual(['bodyJson'])
  })

  it('leaves an untouched field undefined rather than defaulted', () => {
    const out = updateEntrySchema.parse({ title: 'Renamed' })
    expect(out.occurredAt).toBeUndefined()
    expect(out.kind).toBeUndefined()
    expect(out.tags).toBeUndefined()
  })

  it('still carries the fields a patch does send', () => {
    const at = new Date('2026-08-27T15:00:00.000Z')
    const out = updateEntrySchema.parse({ kind: 'CALL', occurredAt: at.toISOString(), tags: ['intro'] })
    expect(out.kind).toBe('CALL')
    expect(out.occurredAt).toEqual(at)
    expect(out.tags).toEqual(['intro'])
  })

  it('keeps an explicit empty array, so clearing tags is still expressible', () => {
    expect(updateEntrySchema.parse({ tags: [] }).tags).toEqual([])
  })

  it('validates what it does receive', () => {
    expect(() => updateEntrySchema.parse({ kind: 'BRUNCH' })).toThrow()
  })
})
