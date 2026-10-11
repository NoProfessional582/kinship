/**
 * A made-up graph the size the map plan targets, the same every run (a fixed seed): the
 * layout benchmark (scripts/benchmark-graph-layout.ts) times laying it out, and the render
 * benchmark (tests/benchmark) serves it to /map in place of the API's answer.
 *
 * Imports nothing from the app, so the Playwright image can load it; its shapes are the
 * graph API's (docs/api/graph.openapi.json).
 */

const TYPES = ['contact', 'project', 'entry', 'task', 'tag'] as const
const COLORS = {
  contact: '#3b82f6',
  project: '#8b5cf6',
  entry: '#ec4899',
  task: '#f59e0b',
  tag: '#10b981',
} as const

export interface SyntheticNode {
  id: string
  entityId: string
  type: (typeof TYPES)[number]
  name: string
  color: string
  url: string | null
}

export interface SyntheticLink {
  id: string
  source: string
  target: string
  relation: string
  origins: string[]
}

/** A seeded generator, so every run makes the same graph. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * Records of every type; links mostly from new records to earlier ones, picked in
 * proportion to the links those already have, so a few hubs collect many links as people
 * and projects do. About 5% of records get no link.
 */
export function syntheticGraph(
  nodes: number,
  links: number,
): { nodes: SyntheticNode[]; links: SyntheticLink[] } {
  const random = seeded(20261011)
  const graphNodes: SyntheticNode[] = Array.from({ length: nodes }, (_, i) => {
    const type = TYPES[i % TYPES.length]
    return {
      id: `${type}:bench${i}`,
      entityId: `bench${i}`,
      type,
      name: `Record ${i}`,
      color: COLORS[type],
      url: type === 'tag' ? null : `/${type}s/bench${i}`,
    }
  })
  const lonely = new Set(
    Array.from({ length: Math.floor(nodes * 0.05) }, () => Math.floor(random() * nodes)),
  )
  const linked = graphNodes.filter((_, i) => !lonely.has(i))
  const ends: number[] = [0, 1]
  const seen = new Set<string>()
  const graphLinks: SyntheticLink[] = []
  while (graphLinks.length < links) {
    const from = 1 + Math.floor(random() * (linked.length - 1))
    const to =
      random() < 0.7
        ? ends[Math.floor(random() * ends.length)]
        : Math.floor(random() * linked.length)
    if (from === to) continue
    const source = linked[from].id
    const target = linked[to].id
    const id = `${source}>${target}>bench`
    if (seen.has(id)) continue
    seen.add(id)
    ends.push(from, to)
    graphLinks.push({ id, source, target, relation: 'bench', origins: ['bench'] })
  }
  return { nodes: graphNodes, links: graphLinks }
}
