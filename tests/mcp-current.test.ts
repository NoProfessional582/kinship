import { describe, expect, it } from 'vitest'
import { contactInput, overlay, projectInput, taskInput } from '@/lib/mcp/current'
import { upsertContactSchema, upsertProjectSchema, upsertTaskSchema } from '@/lib/validation'

/**
 * An update tool lays the agent's fields over the record as `current.ts` reads it back.
 * A field the mapping missed would be cleared by every agent edit, so each mapping must
 * name every field of its save's schema.
 */

const lists = { channels: [], positions: [], milestones: [], links: [], attributes: [] }

describe('the record an update starts from', () => {
  it('names every field a contact save takes', () => {
    const input = contactInput({ tags: [], ...lists } as never)
    expect(Object.keys(input).sort()).toEqual(Object.keys(upsertContactSchema.shape).sort())
  })

  it('names every field a task save takes', () => {
    const input = taskInput({ assignees: [{ contactId: 'c1' }], tags: [] } as never)
    expect(Object.keys(input).sort()).toEqual(Object.keys(upsertTaskSchema.shape).sort())
    expect(input.assigneeIds).toEqual(['c1'])
  })

  it('names every field a project save takes', () => {
    expect(Object.keys(projectInput({} as never)).sort()).toEqual(
      Object.keys(upsertProjectSchema.shape).sort(),
    )
  })

  it('takes the fields sent, clears those sent as null, keeps those left out', () => {
    expect(overlay({ a: 1, b: 2, c: 3 }, { a: 9, b: null, c: undefined })).toEqual({
      a: 9,
      b: null,
      c: 3,
    })
  })
})
