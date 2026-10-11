/**
 * Times lib/graph/layout3d.ts on a made-up graph the size the plan targets: 1,000 records
 * and 3,000 links, the same every run (a fixed seed). Prints JSON with the times, the
 * memory and where it ran; docs/graph-layout.md records the results.
 *
 *   scripts/node.sh npm run --silent graph:benchmark
 *   scripts/node.sh npm run --silent graph:benchmark -- 2000 6000   (other sizes)
 *
 * Node runs in the pinned image, so a browser on a phone may well be slower; this is a
 * reference point, not a promise.
 */
import os from 'node:os'
import {
  GRAPH_COLORS,
  GRAPH_NODE_TYPES,
  type GraphLink,
  type GraphNode,
} from '../lib/graph/constants'
import { LAYOUT_DEFAULTS, compute3DLayout } from '../lib/graph/layout3d'

const nodeCount = Number(process.argv[2] ?? 1000)
const linkCount = Number(process.argv[3] ?? 3000)
const runs = 5

/** A seeded generator, so every run lays out the same graph. */
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
function syntheticGraph(nodes: number, links: number): { nodes: GraphNode[]; links: GraphLink[] } {
  const random = seeded(20261011)
  const graphNodes: GraphNode[] = Array.from({ length: nodes }, (_, i) => {
    const type = GRAPH_NODE_TYPES[i % GRAPH_NODE_TYPES.length]
    return {
      id: `${type}:bench${i}`,
      entityId: `bench${i}`,
      type,
      name: `Record ${i}`,
      color: GRAPH_COLORS[type],
      url: type === 'tag' ? null : `/${type}s/bench${i}`,
    }
  })
  const lonely = new Set(
    Array.from({ length: Math.floor(nodes * 0.05) }, () => Math.floor(random() * nodes)),
  )
  const linked = graphNodes.filter((_, i) => !lonely.has(i))
  const ends: number[] = [0, 1]
  const seen = new Set<string>()
  const graphLinks: GraphLink[] = []
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

const graph = syntheticGraph(nodeCount, linkCount)
const megabytes = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10

// One run first so the times below are of warm code, as a long-lived worker would be.
compute3DLayout(graph.nodes, graph.links)

const times: number[] = []
let peakHeap = 0
let peakRss = 0
let last = compute3DLayout(graph.nodes, graph.links)
for (let run = 0; run < runs; run++) {
  global.gc?.()
  const started = performance.now()
  last = compute3DLayout(graph.nodes, graph.links)
  times.push(performance.now() - started)
  const memory = process.memoryUsage()
  peakHeap = Math.max(peakHeap, memory.heapUsed)
  peakRss = Math.max(peakRss, memory.rss)
}
times.sort((a, b) => a - b)

// How close the orbs came: the smallest gap between two surfaces, and how many overlap.
let smallestGap = Infinity
let overlaps = 0
last.nodes.forEach((a, i) => {
  for (const b of last.nodes.slice(i + 1)) {
    const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - a.radius - b.radius
    smallestGap = Math.min(smallestGap, gap)
    if (gap < 0) overlaps++
  }
})

console.log(
  JSON.stringify(
    {
      nodes: graph.nodes.length,
      links: graph.links.length,
      iterations: LAYOUT_DEFAULTS.iterations,
      runs,
      ms: {
        min: Math.round(times[0]),
        median: Math.round(times[Math.floor(runs / 2)]),
        max: Math.round(times[runs - 1]),
      },
      memoryMB: { peakHeapUsed: megabytes(peakHeap), peakRss: megabytes(peakRss) },
      result: {
        boundsRadius: Math.round(last.bounds.radius * 10) / 10,
        scale: last.scale,
        smallestGap: Math.round(smallestGap * 100) / 100,
        overlaps,
      },
      runtime: { node: process.version, platform: `${process.platform} ${process.arch}` },
      machine: {
        cpus: os.cpus().length,
        cpu: os.cpus()[0]?.model,
        memoryGB: Math.round(os.totalmem() / 1024 ** 3),
        loadAverage: os.loadavg().map((n) => Math.round(n * 10) / 10),
      },
    },
    null,
    2,
  ),
)
