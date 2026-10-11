import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRAPH_COLORS, type GraphLink, type GraphNode } from '@/lib/graph/constants'
import {
  LAYOUT_DEFAULTS,
  LayoutInputError,
  MAX_ATTRACTION,
  MIN_ATTRACTION,
  MIN_BOUNDS_RADIUS,
  NODE_RADIUS,
  compute3DLayout,
  type GraphLayout,
  type LayoutOptions,
  type PositionedNode,
} from '@/lib/graph/layout3d'

const node = (id: string, type: GraphNode['type'] = 'entry'): GraphNode => ({
  id: `${type}:${id}`,
  entityId: id,
  type,
  name: `Record ${id}`,
  color: GRAPH_COLORS[type],
  url: type === 'tag' ? null : `/${type}s/${id}`,
})

const link = (source: GraphNode, target: GraphNode, relation = 'mentions'): GraphLink => ({
  id: `${source.id}>${target.id}>${relation}`,
  source: source.id,
  target: target.id,
  relation,
  origins: ['Mention'],
})

/** Two triangles of people and projects, not linked to each other, and two lone tags. */
function islands() {
  const a = [node('a1', 'contact'), node('a2', 'project'), node('a3', 'entry')]
  const b = [node('b1', 'contact'), node('b2', 'task'), node('b3', 'entry')]
  const lone = [node('t1', 'tag'), node('t2', 'tag')]
  const links = [
    link(a[0], a[1]),
    link(a[1], a[2]),
    link(a[2], a[0]),
    link(b[0], b[1]),
    link(b[1], b[2]),
    link(b[2], b[0]),
  ]
  return { a, b, lone, nodes: [...a, ...b, ...lone], links }
}

/** One hub record linked to `count` others. */
function star(count: number) {
  const hub = node('hub', 'contact')
  const leaves = Array.from({ length: count }, (_, i) => node(`leaf${i}`))
  return { nodes: [hub, ...leaves], links: leaves.map((leaf) => link(leaf, hub)) }
}

/** Every one of `count` records linked to every other. */
function clique(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => node(`c${i}`, i % 2 ? 'task' : 'project'))
  const links = nodes.flatMap((a, i) => nodes.slice(i + 1).map((b) => link(a, b)))
  return { nodes, links }
}

const byId = (layout: GraphLayout) => new Map(layout.nodes.map((n) => [n.id, n]))
const distance = (a: PositionedNode, b: PositionedNode) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** The smallest gap between two orbs' surfaces; negative when two overlap. */
function smallestGap(layout: GraphLayout): number {
  let gap = Infinity
  layout.nodes.forEach((a, i) => {
    for (const b of layout.nodes.slice(i + 1))
      gap = Math.min(gap, distance(a, b) - a.radius - b.radius)
  })
  return gap
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

function expectInBounds(layout: GraphLayout, maxRadius = LAYOUT_DEFAULTS.maxRadius) {
  expect(layout.bounds.center).toEqual({ x: 0, y: 0, z: 0 })
  expect(Number.isFinite(layout.bounds.radius)).toBe(true)
  expect(layout.bounds.radius).toBeLessThanOrEqual(maxRadius + 1e-9)
  for (const n of layout.nodes) {
    for (const c of [n.x, n.y, n.z]) expect(Number.isFinite(c)).toBe(true)
    expect(Math.hypot(n.x, n.y, n.z) + n.radius).toBeLessThanOrEqual(layout.bounds.radius + 1e-9)
  }
}

describe('compute3DLayout: shapes of graph', () => {
  it('gives an empty graph usable bounds', () => {
    const layout = compute3DLayout([], [])
    expect(layout).toEqual({
      nodes: [],
      bounds: { center: { x: 0, y: 0, z: 0 }, radius: MIN_BOUNDS_RADIUS },
      scale: 1,
      iterations: LAYOUT_DEFAULTS.iterations,
    })
  })

  it('puts a single record at the origin', () => {
    const only = node('one', 'project')
    const layout = compute3DLayout([only], [])
    expect(layout.nodes).toEqual([{ ...only, x: 0, y: 0, z: 0, radius: NODE_RADIUS.project }])
    expect(layout.bounds.radius).toBe(MIN_BOUNDS_RADIUS)
  })

  it('keeps linked records together and lone records in view', () => {
    const { a, b, lone, nodes, links } = islands()
    const layout = compute3DLayout(nodes, links)
    expectInBounds(layout)
    const at = byId(layout)
    const within = [
      distance(at.get(a[0].id)!, at.get(a[1].id)!),
      distance(at.get(b[0].id)!, at.get(b[1].id)!),
    ]
    const across = a.flatMap((x) => b.map((y) => distance(at.get(x.id)!, at.get(y.id)!)))
    expect(Math.max(...within)).toBeLessThan(Math.min(...across))
    // Lone tags are neither lost far away nor piled onto the clusters.
    for (const tag of lone) {
      const { x, y, z } = at.get(tag.id)!
      expect(Math.hypot(x, y, z)).toBeLessThan(80)
    }
    expect(smallestGap(layout)).toBeGreaterThan(0)
  })

  it('settles a cycle with every record finite and apart', () => {
    const ring = Array.from({ length: 12 }, (_, i) => node(`r${i}`, 'task'))
    const links = ring.map((n, i) => link(n, ring[(i + 1) % ring.length]))
    const layout = compute3DLayout(ring, links)
    expectInBounds(layout)
    expect(smallestGap(layout)).toBeGreaterThan(0)
  })

  it('spaces the orbs of small graphs for their glow', () => {
    // Collision is a soft force, so this checks known fixtures with room to spare, not every graph.
    for (const graph of [star(10), clique(6), islands()]) {
      const layout = compute3DLayout(graph.nodes, graph.links)
      expect(smallestGap(layout)).toBeGreaterThanOrEqual(LAYOUT_DEFAULTS.spacing * 0.5)
    }
  })

  it('keeps a dense neighbourhood from overlapping', () => {
    const { nodes, links } = clique(30)
    const layout = compute3DLayout(nodes, links)
    expectInBounds(layout)
    expect(smallestGap(layout)).toBeGreaterThan(0)
  })

  it('shrinks a layout wider than maxRadius to fit, never stretching a small one', () => {
    const { nodes, links } = star(80)
    const small = compute3DLayout(nodes, links, { maxRadius: 20 })
    expect(small.scale).toBeLessThan(1)
    expectInBounds(small, 20)
    expect(compute3DLayout(nodes, links).scale).toBe(1)
  })

  it('treats parallel and reversed links as one spring, and ignores self-links', () => {
    const { nodes, links } = islands()
    const extra = [
      ...links,
      { ...link(nodes[1], nodes[0], 'tagged'), origins: ['EntryTag'] },
      link(nodes[0], nodes[1], 'references'),
      link(nodes[6], nodes[6]),
    ]
    expect(compute3DLayout(nodes, extra).nodes).toEqual(compute3DLayout(nodes, links).nodes)
  })
})

describe('compute3DLayout: attraction', () => {
  /** The mean distance between linked records' centres. */
  const meanLink = (layout: GraphLayout, links: GraphLink[]) => {
    const placed = byId(layout)
    const total = links.reduce(
      (sum, l) => sum + distance(placed.get(l.source)!, placed.get(l.target)!),
      0,
    )
    return total / links.length
  }

  it('pulls linked records closer the higher it is, keeping orbs apart', () => {
    const { nodes, links } = clique(10)
    const extra = star(30)
    const all = { nodes: [...nodes, ...extra.nodes], links: [...links, ...extra.links] }
    const lengths = [MIN_ATTRACTION, 1, 1.5, MAX_ATTRACTION].map((attraction) => {
      const layout = compute3DLayout(all.nodes, all.links, { attraction })
      expectInBounds(layout, LAYOUT_DEFAULTS.maxRadius / Math.min(attraction, 1))
      expect(smallestGap(layout)).toBeGreaterThan(0)
      return meanLink(layout, all.links)
    })
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThan(lengths[i - 1])
  })

  it('leaves the layout as it was at 1', () => {
    const { nodes, links } = islands()
    expect(compute3DLayout(nodes, links, { attraction: 1 })).toEqual(compute3DLayout(nodes, links))
  })

  it('gives the same positions every call at any value', () => {
    const { nodes, links } = clique(12)
    expect(compute3DLayout(nodes, links, { attraction: 2.25 })).toEqual(
      compute3DLayout(nodes, links, { attraction: 2.25 }),
    )
  })

  it('grows the room below 1, so a spread-out map is not shrunk back', () => {
    const { nodes, links } = star(80)
    const spread = compute3DLayout(nodes, links, { maxRadius: 20, attraction: 0.5 })
    expectInBounds(spread, 40)
    expect(spread.bounds.radius).toBeGreaterThan(20)
  })
})

describe('compute3DLayout: repeatable and side-effect free', () => {
  it('gives the same positions every call', () => {
    const { nodes, links } = clique(12)
    expect(compute3DLayout(nodes, links)).toEqual(compute3DLayout(nodes, links))
  })

  it('gives the same positions whatever order the nodes and links come in', () => {
    const { nodes, links } = islands()
    const forward = compute3DLayout(nodes, links)
    const shuffled = compute3DLayout([...nodes].reverse(), [...links].reverse())
    // Results come back in the input's order; each record's place is the same.
    expect(shuffled.nodes.map((n) => n.id)).toEqual([...nodes].reverse().map((n) => n.id))
    expect(byId(shuffled)).toEqual(byId(forward))
    expect(shuffled.bounds).toEqual(forward.bounds)
  })

  it('gives a different arrangement for a different seed', () => {
    const { nodes, links } = islands()
    const one = compute3DLayout(nodes, links, { seed: 1 })
    const two = compute3DLayout(nodes, links, { seed: 2 })
    expect(two.nodes).not.toEqual(one.nodes)
    expectInBounds(two)
  })

  it('leaves frozen input as it was and returns new objects', () => {
    const { nodes, links } = islands()
    const before = structuredClone({ nodes, links })
    deepFreeze(nodes)
    deepFreeze(links)
    const layout = compute3DLayout(nodes, links)
    expect({ nodes, links }).toEqual(before)
    layout.nodes.forEach((placed, i) => {
      expect(placed).not.toBe(nodes[i])
      expect(placed).toMatchObject(nodes[i])
    })
  })

  it('returns plain data a worker can post', () => {
    const { nodes, links } = islands()
    const layout = compute3DLayout(nodes, links)
    expect(structuredClone(layout)).toEqual(layout)
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout)
  })

  it('leaves no timer running once the library has let go of its first frame', async () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    await settle()
    const before = timers()
    compute3DLayout(...(Object.values(clique(8)) as [GraphNode[], GraphLink[]]))
    await settle()
    expect(timers()).toBeLessThanOrEqual(before)
  })

  it('imports nothing tied to the DOM, the server or the database', () => {
    const source = readFileSync(path.join(__dirname, '../lib/graph/layout3d.ts'), 'utf8')
    const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports).toEqual(['d3-force-3d', './constants'])
  })
})

describe('compute3DLayout: refusals', () => {
  it('refuses a link to a record that is not in the graph', () => {
    const a = node('a')
    const ghost = node('ghost')
    expect(() => compute3DLayout([a], [link(a, ghost)])).toThrow(LayoutInputError)
    expect(() => compute3DLayout([a], [link(ghost, a)])).toThrow(/entry:ghost, which is not a node/)
  })

  it('refuses two records with the same id', () => {
    expect(() => compute3DLayout([node('a'), node('a')], [])).toThrow(LayoutInputError)
  })

  const bad: [keyof LayoutOptions, number][] = [
    ['iterations', 0],
    ['iterations', 1.5],
    ['iterations', 1001],
    ['iterations', Number.NaN],
    ['seed', -1],
    ['seed', 2 ** 32],
    ['seed', 0.5],
    ['linkDistance', 0],
    ['linkDistance', Number.POSITIVE_INFINITY],
    ['charge', 1],
    ['charge', Number.NEGATIVE_INFINITY],
    ['chargeRange', 0],
    ['chargeRange', Number.POSITIVE_INFINITY],
    ['spacing', -1],
    ['gravity', -0.1],
    ['gravity', 2],
    ['maxRadius', 3],
    ['maxRadius', Number.NaN],
    ['attraction', MIN_ATTRACTION - 0.01],
    ['attraction', MAX_ATTRACTION + 0.01],
    ['attraction', 0],
    ['attraction', Number.NaN],
  ]
  it.each(bad)('refuses %s = %s', (name, value) => {
    expect(() => compute3DLayout([node('a')], [], { [name]: value })).toThrow(LayoutInputError)
  })

  it('refuses an option that is not a number', () => {
    const options = { iterations: '300' } as unknown as LayoutOptions
    expect(() => compute3DLayout([], [], options)).toThrow(LayoutInputError)
  })

  it('takes options at their limits', () => {
    const { nodes, links } = islands()
    const edge = { iterations: 1, seed: 0, charge: 0, spacing: 0, gravity: 0 }
    expectInBounds(compute3DLayout(nodes, links, edge))
    expectInBounds(compute3DLayout(nodes, links, { seed: 2 ** 32 - 1, gravity: 1 }))
    expectInBounds(compute3DLayout(nodes, links, { attraction: MIN_ATTRACTION }), 240)
    expectInBounds(compute3DLayout(nodes, links, { attraction: MAX_ATTRACTION }))
  })
})
