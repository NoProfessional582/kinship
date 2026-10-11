import { describe, expect, it } from 'vitest'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { DESCRIPTION_MAX, GRAPH_COLORS, INFERRED, ORIGINS } from '@/lib/graph/constants'
import { focusGraph, parseGraphQuery } from '@/lib/graph/focus'
import { entryName, excerpt, linkId, normalizeGraph, type GraphRows } from '@/lib/graph/normalize'

const when = new Date('2031-01-05T12:00:00Z')

/** No records at all; each test adds what it needs. */
const empty = (): GraphRows => ({
  contacts: [],
  projects: [],
  entries: [],
  tasks: [],
  tags: [],
  edges: [],
  mentions: [],
  refs: [],
  assignees: [],
  contactTags: [],
  entryTags: [],
  taskTags: [],
})

const contact = (id: string, fields: Partial<GraphRows['contacts'][number]> = {}) => ({
  id,
  slug: id,
  displayName: `Person ${id}`,
  headline: null,
  jobTitle: null,
  company: null,
  ...fields,
})
const project = (id: string, fields: Partial<GraphRows['projects'][number]> = {}) => ({
  id,
  slug: id,
  name: `Project ${id}`,
  status: 'TODO',
  description: null,
  ...fields,
})
const entry = (id: string, fields: Partial<GraphRows['entries'][number]> = {}) => ({
  id,
  kind: 'NOTE',
  title: `Entry ${id}`,
  bodyText: '',
  occurredAt: when,
  projectId: null,
  ...fields,
})
const task = (id: string, fields: Partial<GraphRows['tasks'][number]> = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'TODO',
  description: null,
  projectId: null,
  parentTaskId: null,
  ...fields,
})
const tag = (id: string) => ({ id, name: `tag-${id}` })

/** One of every record, and one link from every source. */
function everything(): GraphRows {
  return {
    ...empty(),
    contacts: [contact('c1'), contact('c2')],
    projects: [project('p1')],
    entries: [entry('e1', { projectId: 'p1' })],
    tasks: [task('t1', { projectId: 'p1' }), task('t2', { parentTaskId: 't1' })],
    tags: [tag('g1')],
    edges: [
      {
        sourceType: 'contact',
        sourceId: 'c1',
        targetType: 'contact',
        targetId: 'c2',
        relation: 'mentors',
      },
    ],
    mentions: [{ entryId: 'e1', contactId: 'c1' }],
    refs: [
      { entryId: 'e1', targetType: 'TASK', taskId: 't1', projectId: null },
      { entryId: 'e1', targetType: 'PROJECT', taskId: null, projectId: 'p1' },
    ],
    assignees: [{ taskId: 't1', contactId: 'c2' }],
    contactTags: [{ contactId: 'c1', tagId: 'g1' }],
    entryTags: [{ entryId: 'e1', tagId: 'g1' }],
    taskTags: [{ taskId: 't2', tagId: 'g1' }],
  }
}

const triples = (graph: ReturnType<typeof normalizeGraph>) =>
  graph.links.map((l) => `${l.source} -${l.relation}-> ${l.target} [${l.origins.join(',')}]`)

describe('normalizeGraph', () => {
  it('is empty for no records', () => {
    expect(normalizeGraph(empty())).toEqual({ nodes: [], links: [] })
  })

  it('makes a typed node for each record, with its colour, name and page', () => {
    const graph = normalizeGraph(everything())
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'contact:c1',
      'contact:c2',
      'entry:e1',
      'project:p1',
      'tag:g1',
      'task:t1',
      'task:t2',
    ])
    for (const n of graph.nodes) {
      expect(n.color).toBe(GRAPH_COLORS[n.type])
      expect(n.id).toBe(`${n.type}:${n.entityId}`)
    }
    const url = Object.fromEntries(graph.nodes.map((n) => [n.id, n.url]))
    expect(url).toEqual({
      'contact:c1': '/contacts/c1',
      'contact:c2': '/contacts/c2',
      'entry:e1': '/notes/e1',
      'project:p1': '/projects/p1',
      'tag:g1': null,
      'task:t1': '/board?task=t1',
      'task:t2': '/board?task=t2',
    })
  })

  it('draws a link from every relationship source, each named and traced to its table', () => {
    expect(triples(normalizeGraph(everything()))).toEqual(
      [
        `contact:c1 -mentors-> contact:c2 [${ORIGINS.edge}]`,
        `contact:c1 -${INFERRED.tagged}-> tag:g1 [${ORIGINS.contactTag}]`,
        `entry:e1 -${INFERRED.mentions}-> contact:c1 [${ORIGINS.mention}]`,
        `entry:e1 -${INFERRED.references}-> task:t1 [${ORIGINS.ref}]`,
        `entry:e1 -${INFERRED.references}-> project:p1 [${ORIGINS.ref}]`,
        `entry:e1 -${INFERRED.inProject}-> project:p1 [${ORIGINS.entryProject}]`,
        `entry:e1 -${INFERRED.tagged}-> tag:g1 [${ORIGINS.entryTag}]`,
        `task:t1 -${INFERRED.assignedTo}-> contact:c2 [${ORIGINS.assignee}]`,
        `task:t1 -${INFERRED.inProject}-> project:p1 [${ORIGINS.taskProject}]`,
        `task:t1 -${INFERRED.subtask}-> task:t2 [${ORIGINS.taskParent}]`,
        `task:t2 -${INFERRED.tagged}-> tag:g1 [${ORIGINS.taskTag}]`,
      ].sort((a, b) => {
        // The answer is sorted by link id; sort the expectation the same way.
        const id = (s: string) => {
          const [, source, relation, target] = /^(\S+) -(.+)-> (\S+) /.exec(s)!
          return linkId(source, target, relation)
        }
        return id(a) < id(b) ? -1 : 1
      }),
    )
  })

  it('keeps ids apart when two types share a database id', () => {
    const rows = {
      ...empty(),
      contacts: [contact('same')],
      tasks: [task('same')],
      tags: [tag('same')],
      assignees: [{ taskId: 'same', contactId: 'same' }],
    }
    const graph = normalizeGraph(rows)
    expect(graph.nodes.map((n) => n.id)).toEqual(['contact:same', 'tag:same', 'task:same'])
    expect(triples(graph)).toEqual([
      `task:same -${INFERRED.assignedTo}-> contact:same [${ORIGINS.assignee}]`,
    ])
  })

  it('merges identical links, keeping every origin, but not reversed or different ones', () => {
    const rows = {
      ...empty(),
      entries: [entry('e1'), entry('e2')],
      edges: [
        {
          sourceType: 'entry',
          sourceId: 'e1',
          targetType: 'entry',
          targetId: 'e2',
          relation: 'follows-up',
        },
        {
          sourceType: 'entry',
          sourceId: 'e2',
          targetType: 'entry',
          targetId: 'e1',
          relation: 'follows-up',
        },
        {
          sourceType: 'entry',
          sourceId: 'e1',
          targetType: 'entry',
          targetId: 'e2',
          relation: 'mentions',
        },
      ],
      mentions: [],
    }
    // An EntityEdge saying exactly what a Mention would says it twice: one link, two origins.
    const withMention = {
      ...rows,
      contacts: [contact('c1')],
      edges: [
        ...rows.edges,
        {
          sourceType: 'entry',
          sourceId: 'e1',
          targetType: 'contact',
          targetId: 'c1',
          relation: 'mentions',
        },
      ],
      mentions: [
        { entryId: 'e1', contactId: 'c1' },
        { entryId: 'e1', contactId: 'c1' },
      ],
    }
    const graph = normalizeGraph(withMention)
    expect(graph.links).toHaveLength(4)
    const merged = graph.links.find((l) => l.source === 'entry:e1' && l.target === 'contact:c1')
    expect(merged?.origins).toEqual([ORIGINS.edge, ORIGINS.mention])
    expect(
      graph.links.filter((l) => l.relation === 'follows-up').map((l) => [l.source, l.target]),
    ).toEqual([
      ['entry:e1', 'entry:e2'],
      ['entry:e2', 'entry:e1'],
    ])
    expect(new Set(graph.links.map((l) => l.id)).size).toBe(graph.links.length)
  })

  it('drops links whose ends are not both nodes, of an unknown type, or to themselves', () => {
    const rows = {
      ...empty(),
      contacts: [contact('c1')],
      entries: [entry('e1', { projectId: 'gone' })],
      tasks: [task('t1', { parentTaskId: 'hidden', projectId: 'gone' })],
      edges: [
        {
          sourceType: 'contact',
          sourceId: 'c1',
          targetType: 'contact',
          targetId: 'other-owner',
          relation: 'x',
        },
        { sourceType: 'contact', sourceId: 'c1', targetType: 'tag', targetId: 'g1', relation: 'x' },
        {
          sourceType: 'widget',
          sourceId: 'c1',
          targetType: 'contact',
          targetId: 'c1',
          relation: 'x',
        },
        {
          sourceType: 'contact',
          sourceId: 'c1',
          targetType: 'contact',
          targetId: 'c1',
          relation: 'x',
        },
        {
          sourceType: 'contact',
          sourceId: 'c1',
          targetType: 'entry',
          targetId: 'e1',
          relation: '',
        },
      ],
      mentions: [{ entryId: 'trashed', contactId: 'c1' }],
      refs: [
        { entryId: 'e1', targetType: 'TASK', taskId: null, projectId: null },
        { entryId: 'e1', targetType: 'PROJECT', taskId: 't1', projectId: null },
      ],
      assignees: [{ taskId: 't1', contactId: 'draft' }],
      contactTags: [{ contactId: 'c1', tagId: 'g1' }],
      entryTags: [],
      taskTags: [],
    }
    const graph = normalizeGraph(rows)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.links).toEqual([])
  })

  it('keeps records that have no links', () => {
    const graph = normalizeGraph({
      ...empty(),
      tags: [tag('lonely')],
      contacts: [contact('alone')],
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['contact:alone', 'tag:lonely'])
    expect(graph.links).toEqual([])
  })

  it('names entries by kind when untitled, and sends a short excerpt, never the body', () => {
    const long = `${'word '.repeat(200)}end`
    const graph = normalizeGraph({
      ...empty(),
      entries: [
        entry('e1', { title: '  ', kind: 'CALL', bodyText: long }),
        entry('e2', { title: null, kind: 'IN_PERSON', bodyText: '' }),
      ],
    })
    const [call, inPerson] = graph.nodes
    expect(call).toMatchObject({ name: 'Untitled call', subtitle: 'Call · 2031-01-05' })
    expect(Array.from(call.description!).length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(call.description!.endsWith('…')).toBe(true)
    expect(inPerson).toMatchObject({ name: 'Untitled in person' })
    expect(inPerson).not.toHaveProperty('description')
    expect(Object.keys(call).sort()).toEqual(
      ['color', 'description', 'entityId', 'id', 'name', 'subtitle', 'type', 'url'].sort(),
    )
  })

  it('subtitles contacts by headline, else role and company, and encodes page addresses', () => {
    const graph = normalizeGraph({
      ...empty(),
      contacts: [
        contact('a', { slug: 'ana/../x y', headline: 'Infra lead' }),
        contact('b', { jobTitle: 'CTO', company: 'Acme' }),
        contact('c'),
      ],
      tasks: [task('t?1&x=2')],
    })
    const [a, b, c, t] = graph.nodes
    expect(a).toMatchObject({ subtitle: 'Infra lead', url: '/contacts/ana%2F..%2Fx%20y' })
    expect(b).toMatchObject({ subtitle: 'CTO · Acme' })
    expect(c).not.toHaveProperty('subtitle')
    expect(t.url).toBe('/board?task=t%3F1%26x%3D2')
  })

  it('gives the same answer whatever order the rows come in', () => {
    const rows = everything()
    const shuffled = Object.fromEntries(
      Object.entries(rows).map(([k, v]) => [k, [...(v as unknown[])].reverse()]),
    ) as unknown as GraphRows
    expect(normalizeGraph(shuffled)).toEqual(normalizeGraph(rows))
  })
})

describe('excerpt and entryName', () => {
  it('collapses whitespace and leaves short text whole', () => {
    expect(excerpt('  two\n\nlines  ')).toBe('two lines')
    expect(excerpt('   ')).toBeUndefined()
    expect(excerpt(null)).toBeUndefined()
  })

  it('does not cut a character in half', () => {
    const out = excerpt('😀'.repeat(DESCRIPTION_MAX + 5))!
    expect(Array.from(out)).toHaveLength(DESCRIPTION_MAX)
    expect(out.endsWith('😀…')).toBe(true)
  })

  it('falls back to "entry" for a kind it does not know', () => {
    expect(entryName(null, 'SOMETHING_NEW')).toBe('Untitled entry')
    expect(entryName(' Kept ', 'NOTE')).toBe('Kept')
  })
})

const q = (query: string) => parseGraphQuery(new URLSearchParams(query))

describe('parseGraphQuery', () => {
  it('asks for the whole graph when there is no focus', () => {
    expect(q('')).toEqual({ focus: null, depth: null })
    expect(q('unrelated=1')).toEqual({ focus: null, depth: null })
  })

  it('reads a typed focus, with depth 2 unless 1 is asked for', () => {
    expect(q('focusId=contact:abc')).toEqual({
      focus: { id: 'contact:abc', type: 'contact', entityId: 'abc' },
      depth: 2,
    })
    expect(q('focusId=tag:x&depth=1').depth).toBe(1)
    expect(q('focusId=task:a:b').focus).toEqual({ id: 'task:a:b', type: 'task', entityId: 'a:b' })
    expect(q('focusId=entry:x&focusId=entry:x').focus?.id).toBe('entry:x')
  })

  it.each([
    ['depth=1', 'depth needs a focusId'],
    ['focusId=', /focusId must be/],
    ['focusId=abc', /focusId must be/],
    ['focusId=contact:', /focusId must be/],
    ['focusId=:abc', /focusId must be/],
    ['focusId=person:abc', /focusId must be/],
    ['focusId=Contact:abc', /focusId must be/],
    ['focusId=contact:a%20b', /focusId must be/],
    [`focusId=contact:${'x'.repeat(257)}`, /focusId must be/],
    ['focusId=contact:a&depth=0', 'depth must be 1 or 2'],
    ['focusId=contact:a&depth=3', 'depth must be 1 or 2'],
    ['focusId=contact:a&depth=01', 'depth must be 1 or 2'],
    ['focusId=contact:a&depth=', 'depth must be 1 or 2'],
    ['focusId=contact:a&depth=two', 'depth must be 1 or 2'],
    [
      'focusId=contact:a&focusId=contact:b',
      'focusId was given more than once, with different values',
    ],
    ['focusId=contact:a&depth=1&depth=2', 'depth was given more than once, with different values'],
  ])('refuses %s', (query, message) => {
    expect(() => q(query)).toThrow(ValidationError)
    expect(() => q(query)).toThrow(message)
  })
})

describe('focusGraph', () => {
  // A chain a → b ← c → d, a cycle d → e → f → d, and g on its own.
  const chain = normalizeGraph({
    ...empty(),
    contacts: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => contact(id)),
    edges: [
      ['a', 'b'],
      ['c', 'b'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'd'],
    ].map(([s, t]) => ({
      sourceType: 'contact',
      sourceId: s,
      targetType: 'contact',
      targetId: t,
      relation: 'knows',
    })),
  })
  const ids = (g: ReturnType<typeof focusGraph>) => g.nodes.map((n) => n.entityId)

  it('follows links either way, up to the depth', () => {
    expect(ids(focusGraph(chain, 'contact:b', 1))).toEqual(['a', 'b', 'c'])
    expect(ids(focusGraph(chain, 'contact:b', 2))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(focusGraph(chain, 'contact:d', 1))).toEqual(['c', 'd', 'e', 'f'])
  })

  it('keeps every link between kept nodes, in its stored direction', () => {
    const near = focusGraph(chain, 'contact:d', 1)
    // e → f joins two neighbours of d, so it stays although neither end is d.
    expect(near.links.map((l) => `${l.source}>${l.target}`).sort()).toEqual([
      'contact:c>contact:d',
      'contact:d>contact:e',
      'contact:e>contact:f',
      'contact:f>contact:d',
    ])
  })

  it('is just the focus for a record with no links', () => {
    expect(focusGraph(chain, 'contact:g', 2)).toEqual({
      nodes: [chain.nodes.find((n) => n.id === 'contact:g')],
      links: [],
    })
  })

  it('is a 404 for a focus that is not in the graph', () => {
    expect(() => focusGraph(chain, 'contact:missing', 2)).toThrow(NotFoundError)
    expect(() => focusGraph(chain, 'task:a', 2)).toThrow(NotFoundError)
  })
})
