import { describe, expect, it } from 'vitest'
import { errorText } from '@/lib/mcp/results'
import * as T from '@/lib/mcp/trim'

describe('compact', () => {
  it('drops empty values all the way down and keeps false and 0', () => {
    expect(
      T.compact({
        a: null,
        b: undefined,
        c: '',
        d: [],
        e: {},
        f: { g: null, h: [{ i: null, j: 0 }] },
        k: false,
        l: 'x',
      }),
    ).toEqual({ f: { h: [{ j: 0 }] }, k: false, l: 'x' })
  })
})

describe('page', () => {
  const items = [1, 2, 3, 4, 5]
  it('slices and says where the next page starts', () => {
    expect(T.page(items, 2, 0)).toEqual({ total: 5, items: [1, 2], nextOffset: 2 })
    expect(T.page(items, 2, 4)).toEqual({ total: 5, items: [5] })
    expect(T.page(items, 2, 9)).toEqual({ total: 5, items: [] })
  })
})

describe('plainSnippet', () => {
  it('takes the <mark> tags out', () => {
    expect(T.plainSnippet('coffee with <mark>Jane</mark>')).toBe('coffee with Jane')
    expect(T.plainSnippet(null)).toBeNull()
  })
})

describe('errorText', () => {
  it('is the message, then each issue as path: message', () => {
    expect(errorText({ error: 'Not found' })).toBe('Not found')
    expect(
      errorText({
        error: 'Validation failed',
        issues: [
          { path: ['start'], message: 'Invalid input' },
          { path: [], message: 'Too few' },
        ],
      }),
    ).toBe('Validation failed: start: Invalid input; Too few')
    expect(errorText({})).toBe('Unexpected error')
  })
})

describe('entry', () => {
  const stored = {
    id: 'e1',
    owner: 'tester',
    kind: 'CALL',
    title: 'Catch-up',
    bodyJson: { type: 'doc' },
    bodyText: 'Spoke with Jane',
    body: 'Spoke with @[Jane](contact:c1)',
    occurredAt: '2026-10-01T09:00:00.000Z',
    direction: null,
    durationMin: 30,
    location: null,
    projectId: null,
    deletedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  } as const

  it('keeps ids, dates and the plain body; drops the TipTap JSON and search text', () => {
    const trimmed = T.entry({
      ...stored,
      project: { id: 'p1', slug: 'launch', name: 'Launch', color: '#fff' },
      mentions: [
        {
          id: 'm1',
          entryId: 'e1',
          contactId: 'c1',
          contact: { id: 'c1', slug: 'jane', displayName: 'Jane' },
        },
      ],
      refs: [
        {
          id: 'r1',
          entryId: 'e1',
          targetType: 'TASK',
          taskId: 't1',
          projectId: null,
          task: { id: 't1', slug: 'ship', title: 'Ship', status: 'TODO' },
          project: null,
        },
      ],
      tags: [
        {
          entryId: 'e1',
          tagId: 'g1',
          tag: { id: 'g1', owner: 'tester', name: 'work', color: null },
        },
      ],
      followUp: null,
      followsUp: {
        id: 'e0',
        kind: 'MEETING',
        title: null,
        occurredAt: '2026-09-01T09:00:00.000Z',
        written: true,
      },
    })
    expect(trimmed).toEqual({
      id: 'e1',
      kind: 'CALL',
      title: 'Catch-up',
      occurredAt: '2026-10-01T09:00:00.000Z',
      durationMin: 30,
      body: 'Spoke with @[Jane](contact:c1)',
      project: { id: 'p1', name: 'Launch' },
      people: [{ id: 'c1', name: 'Jane' }],
      tasks: [{ id: 't1', title: 'Ship', status: 'TODO' }],
      tags: ['work'],
      followsUp: {
        id: 'e0',
        kind: 'MEETING',
        occurredAt: '2026-09-01T09:00:00.000Z',
        written: true,
      },
    })
  })

  it('works on a dossier entry, which has no mentions or refs', () => {
    expect(T.entry({ ...stored, project: null, tags: [] })).toEqual({
      id: 'e1',
      kind: 'CALL',
      title: 'Catch-up',
      occurredAt: '2026-10-01T09:00:00.000Z',
      durationMin: 30,
      body: 'Spoke with @[Jane](contact:c1)',
    })
  })
})
