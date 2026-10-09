import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  MODEL_ORDER,
  SCHEMA,
  archiveFilename,
  archiveSchema,
  orderBy,
  parentsFirst,
  reviveRow,
} from '@/lib/archive-rows'
import { ARCHIVE_FORMAT } from '@/lib/archive-format'
import { ValidationError } from '@/lib/errors'

/**
 * The archive's row handling, with no database in sight. What is exercised here
 * is everything that would silently corrupt a move rather than fail it: a table
 * quietly left out, an instant that arrives as a string, a subtask written
 * before its parent.
 */

describe('model coverage', () => {
  it('covers every model in the schema, exactly once', () => {
    const inSchema = Prisma.dmmf.datamodel.models.map((m) => m.name).sort()
    expect([...MODEL_ORDER].sort()).toEqual(inSchema)
    expect(new Set(MODEL_ORDER).size).toBe(MODEL_ORDER.length)
  })

  it('lists a model only after the models it points at', () => {
    // Not derivable from the DMMF any more — Prisma 7 dropped
    // `relationFromFields` — so the dependencies are spelled out and checked.
    const dependsOn: Partial<Record<string, string[]>> = {
      ContactAttribute: ['Contact'],
      ContactChannel: ['Contact'],
      ContactPosition: ['Contact'],
      ContactMilestone: ['Contact'],
      ContactLink: ['Contact'],
      BoardColumn: ['Project'],
      Task: ['Project', 'BoardColumn'],
      TaskAssignee: ['Task', 'Contact'],
      Entry: ['Project'],
      Mention: ['Entry', 'Contact'],
      EntityRef: ['Entry', 'Task', 'Project'],
      ContactTag: ['Contact', 'Tag'],
      EntryTag: ['Entry', 'Tag'],
      TaskTag: ['Task', 'Tag'],
    }
    for (const [model, deps] of Object.entries(dependsOn)) {
      for (const dep of deps!) {
        expect(MODEL_ORDER.indexOf(dep as any)).toBeLessThan(MODEL_ORDER.indexOf(model as any))
      }
    }
  })

  it('never exports the generated search vector', () => {
    // GENERATED ALWAYS: Postgres refuses a value for it, and it rebuilds itself
    // from the restored rows.
    expect(SCHEMA.Contact.fields).not.toContain('searchVector')
    expect(SCHEMA.Entry.fields).not.toContain('searchVector')
  })

  it('finds the instants on each model', () => {
    expect([...SCHEMA.Contact.dates].sort()).toEqual([
      'birthday',
      'createdAt',
      'deletedAt',
      'lastContactAt',
      'updatedAt',
    ])
    expect(SCHEMA.Task.dates.has('dueDate')).toBe(true)
    expect(SCHEMA.Mention.dates.size).toBe(0)
  })

  it('sorts join tables on their composite key, having no id', () => {
    expect(orderBy('Contact')).toEqual([{ id: 'asc' }])
    expect(orderBy('ContactTag')).toEqual([{ contactId: 'asc' }, { tagId: 'asc' }])
  })
})

describe('reviveRow', () => {
  it('turns date columns back into Dates and leaves everything else alone', () => {
    const row = reviveRow('Contact', {
      id: 'c1',
      displayName: 'Ada',
      createdAt: '2026-08-29T12:00:00.000Z',
      interests: ['looms'],
      customFields: { desk: 3 },
    })
    expect(row.createdAt).toBeInstanceOf(Date)
    expect((row.createdAt as Date).toISOString()).toBe('2026-08-29T12:00:00.000Z')
    expect(row.interests).toEqual(['looms'])
    expect(row.customFields).toEqual({ desk: 3 })
  })

  it('leaves a null date null rather than making it the epoch', () => {
    const row = reviveRow('Contact', { id: 'c1', deletedAt: null })
    expect(row.deletedAt).toBeNull()
  })

  it('does not touch a string column that happens to look like a timestamp', () => {
    // The reason revival reads the schema instead of sniffing values: a note
    // whose entire text is an ISO instant is a perfectly ordinary note.
    const row = reviveRow('Entry', { id: 'e1', bodyText: '2026-08-29T12:00:00.000Z' })
    expect(row.bodyText).toBe('2026-08-29T12:00:00.000Z')
  })

  it('drops keys that are not columns', () => {
    const row = reviveRow('Tag', { id: 't1', name: 'work', somethingElse: 'nope' })
    expect(row).toEqual({ id: 't1', name: 'work' })
  })

  it('omits absent columns so the schema default applies', () => {
    // An archive from before a column existed must still restore.
    const row = reviveRow('Contact', { id: 'c1', displayName: 'Ada' })
    expect('tier' in row).toBe(false)
  })

  it('refuses a date that is not one', () => {
    expect(() => reviveRow('Contact', { id: 'c1', createdAt: 'whenever' })).toThrow(ValidationError)
  })
})

describe('parentsFirst', () => {
  const task = (id: string, parentTaskId: string | null = null) => ({ id, parentTaskId })
  const idsOf = (rows: Record<string, unknown>[]) => rows.map((r) => r.id)

  it('puts a parent ahead of its child', () => {
    expect(idsOf(parentsFirst([task('child', 'root'), task('root')]))).toEqual(['root', 'child'])
  })

  it('orders a chain emitted entirely backwards', () => {
    const rows = [task('c', 'b'), task('b', 'a'), task('a')]
    expect(idsOf(parentsFirst(rows))).toEqual(['a', 'b', 'c'])
  })

  it('keeps every row exactly once', () => {
    const rows = [task('c', 'b'), task('b', 'a'), task('a'), task('d', 'a'), task('e')]
    const out = parentsFirst(rows)
    expect(out).toHaveLength(rows.length)
    expect(new Set(idsOf(out)).size).toBe(rows.length)
  })

  it('leaves a parent from outside the set alone', () => {
    // Cannot happen from an export, but a hand-edited file could do it, and the
    // foreign key is the right thing to complain rather than an infinite loop.
    expect(idsOf(parentsFirst([task('orphan', 'gone')]))).toEqual(['orphan'])
  })

  it('terminates on a cycle instead of overflowing the stack', () => {
    const out = parentsFirst([task('a', 'b'), task('b', 'a')])
    expect(out).toHaveLength(2)
  })
})

describe('archiveSchema', () => {
  const valid = { format: ARCHIVE_FORMAT, version: 1, data: {} }

  it('accepts a minimal archive and defaults the optional parts', () => {
    const parsed = archiveSchema.parse(valid)
    expect(parsed.uploads).toEqual([])
    expect(parsed.migrations).toEqual([])
  })

  it('rejects a file that is not an archive', () => {
    expect(archiveSchema.safeParse({ hello: 'world' }).success).toBe(false)
  })

  it('says so when the marker is missing', () => {
    const result = archiveSchema.safeParse({ ...valid, format: 'something-else' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Not a Kinship archive (missing the "kb-archive" marker)',
    )
  })

  it("keeps the old app's marker, so archives move both ways", () => {
    expect(ARCHIVE_FORMAT).toBe('kb-archive')
    expect(archiveSchema.safeParse({ ...valid, format: 'kb-archive' }).success).toBe(true)
  })

  it.each(['../escape.png', 'nested/escape.png', '..\\escape.png', '.hidden'])(
    'refuses the upload name %s',
    (name) => {
      const result = archiveSchema.safeParse({
        ...valid,
        uploads: [{ name, data: 'AAAA' }],
      })
      expect(result.success).toBe(false)
    },
  )

  it('accepts a plain filename', () => {
    expect(
      archiveSchema.safeParse({
        ...valid,
        uploads: [{ name: 'a1b2.png', data: 'AAAA' }],
      }).success,
    ).toBe(true)
  })

  it('refuses upload data that is not base64', () => {
    expect(
      archiveSchema.safeParse({
        ...valid,
        uploads: [{ name: 'a.png', data: 'not base64!' }],
      }).success,
    ).toBe(false)
  })
})

describe('archiveFilename', () => {
  it('is named for Kinship, sortable, stamped, and free of characters a filesystem dislikes', () => {
    const name = archiveFilename(new Date('2026-08-29T12:34:56.000Z'))
    expect(name).toBe('kinship-archive-2026-08-29-12-34-56.json')
    expect(name).not.toMatch(/[:]/)
  })
})
