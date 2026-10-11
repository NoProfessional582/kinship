/** The inspector's connection rows for a selected record (lib/graph/inspector.ts). */
import { describe, expect, it } from 'vitest'
import { GRAPH_COLORS, type GraphLink, type GraphNode } from '@/lib/graph/constants'
import { connectionRows, linkSpeech, linkText } from '@/lib/graph/inspector'

const node = (id: string, type: GraphNode['type'], name = id): GraphNode => ({
  id: `${type}:${id}`,
  entityId: id,
  type,
  name,
  color: GRAPH_COLORS[type],
  url: type === 'tag' ? null : `/${type}s/${id}`,
})

const link = (
  source: GraphNode,
  target: GraphNode,
  relation: string,
  origins = ['EntityEdge'],
): GraphLink => ({
  id: `${source.id}>${target.id}>${relation}`,
  source: source.id,
  target: target.id,
  relation,
  origins,
})

const maya = node('maya', 'contact', 'Maya')
const zoe = node('zoe', 'contact', 'Zoe')
const atlas = node('atlas', 'project', 'Atlas')
const note = node('n1', 'entry', 'Kickoff')
const tag = node('design', 'tag', 'design')
const nodes = new Map([maya, zoe, atlas, note, tag].map((n) => [n.id, n]))

describe('connectionRows', () => {
  it('keeps each link’s stored direction and relation', () => {
    const rows = connectionRows(
      maya.id,
      [link(maya, atlas, 'works on'), link(note, maya, 'mentions')],
      nodes,
    )
    expect(rows.map((row) => [row.node.id, row.links])).toEqual([
      [
        atlas.id,
        [{ id: `${maya.id}>${atlas.id}>works on`, relation: 'works on', direction: 'out' }],
      ],
      [note.id, [{ id: `${note.id}>${maya.id}>mentions`, relation: 'mentions', direction: 'in' }]],
    ])
  })

  it('reads the same link the other way round from the other end', () => {
    const [row] = connectionRows(atlas.id, [link(maya, atlas, 'works on')], nodes)
    expect(row.node).toBe(maya)
    expect(row.links[0].direction).toBe('in')
    expect(linkText(row.links[0])).toBe('← works on')
  })

  it('puts every link with one record in one row, out first', () => {
    const rows = connectionRows(
      maya.id,
      [link(zoe, maya, 'knows'), link(maya, zoe, 'mentors'), link(maya, zoe, 'knows')],
      nodes,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].links.map(linkText)).toEqual(['→ knows', '→ mentors', '← knows'])
  })

  it('shows a link merged from several tables once', () => {
    const merged = link(note, atlas, 'in project', ['EntityRef', 'Entry.projectId'])
    const rows = connectionRows(atlas.id, [merged, merged], nodes)
    expect(rows).toHaveLength(1)
    expect(rows[0].links).toHaveLength(1)
  })

  it('leaves out links to itself and to records the graph does not have', () => {
    const gone = node('gone', 'task')
    const rows = connectionRows(maya.id, [link(maya, maya, 'self'), link(maya, gone, 'x')], nodes)
    expect(rows).toEqual([])
  })

  it('orders rows by type as the legend does, then by name', () => {
    const rows = connectionRows(
      maya.id,
      [
        link(maya, tag, 'tagged'),
        link(note, maya, 'mentions'),
        link(maya, zoe, 'knows'),
        link(maya, atlas, 'works on'),
      ],
      nodes,
    )
    expect(rows.map((row) => row.node.name)).toEqual(['Zoe', 'Atlas', 'Kickoff', 'design'])
  })

  it('has nothing for a record with no links', () => {
    expect(connectionRows(tag.id, [], nodes)).toEqual([])
  })
})

describe('link wording', () => {
  it('shows an arrow and speaks a direction', () => {
    expect(linkText({ relation: 'works on', direction: 'out' })).toBe('→ works on')
    expect(linkText({ relation: 'mentions', direction: 'in' })).toBe('← mentions')
    expect(linkSpeech({ relation: 'works on', direction: 'out' })).toBe(
      'works on, from this record',
    )
    expect(linkSpeech({ relation: 'mentions', direction: 'in' })).toBe('mentions, to this record')
  })
})
