/**
 * Places the graph's records in 3D: a force layout (d3-force-3d) where linked records
 * pull together, every record pushes the others away, orbs keep a gap between them, and
 * a weak pull to the centre keeps lone records and separate clusters in view.
 *
 * Pure and DOM-free, like normalize.ts, so the map can run it in a browser worker: no
 * Prisma, no database, no timers left behind. The same graph and options always give the
 * same positions, whatever order the nodes and links come in, and the input is never
 * changed. docs/graph-layout.md has the settings, the measured times and the worker's
 * messages.
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
} from 'd3-force-3d'
import type { GraphLink, GraphNode, GraphNodeType } from './constants'

/** Orb radii in scene units, as in the approved mockup: people and projects a little larger. */
export const NODE_RADIUS: Record<GraphNodeType, number> = {
  contact: 1.6,
  project: 1.6,
  entry: 1.25,
  task: 1.25,
  tag: 1.25,
}

export interface LayoutOptions {
  /** Simulation steps; the work grows with this. At most 1000. */
  iterations?: number
  /** Any whole number from 0 to 2^32 - 1; a different seed gives a different arrangement. */
  seed?: number
  /** How far apart two linked records settle, centre to centre, in scene units. */
  linkDistance?: number
  /** How hard records push one another away: 0 or below, more negative pushes harder. */
  charge?: number
  /**
   * How far that push reaches, in scene units. A short reach keeps a large graph compact
   * (records far apart stop pushing) and leaves small graphs as they would be anyway.
   */
  chargeRange?: number
  /** The gap the layout tries to keep between two orbs' surfaces, for their glow. */
  spacing?: number
  /** The pull towards the centre, from 0 to 1, that keeps lone records near the rest. */
  gravity?: number
  /** The sphere, centred on the origin, that every orb fits inside. */
  maxRadius?: number
  /**
   * How hard linked records pull together, as a multiple of the settings above: from
   * MIN_ATTRACTION to MAX_ATTRACTION, 1 leaves them as they are. Above 1, links are
   * stronger and shorter and the push weaker, so connected records sit closer; below 1,
   * the reverse, with the push reaching further (chargeRange) so the core spreads out
   * too, not only the edges, and maxRadius grown to match so the spread is not shrunk back.
   * Changing linkDistance alone barely moves a large graph, where the push dominates.
   */
  attraction?: number
}

export const LAYOUT_DEFAULTS: Required<LayoutOptions> = {
  iterations: 200,
  seed: 1,
  linkDistance: 18,
  charge: -30,
  chargeRange: 50,
  spacing: 3,
  gravity: 0.05,
  maxRadius: 120,
  attraction: 1,
}

/** The attraction slider's range (LayoutOptions.attraction). */
export const MIN_ATTRACTION = 0.2
export const MAX_ATTRACTION = 2.5

const MAX_ITERATIONS = 1000

/**
 * Barnes-Hut accuracy of the push: higher is coarser and faster. 1.5 instead of d3's 0.9
 * more than halved the time on the benchmark graph and changed the result little.
 */
const CHARGE_THETA = 1.5

/**
 * The share of the steps, at the end, that keep orbs apart. Collision is the second
 * costliest force and only matters once records have settled near their place.
 */
const COLLIDE_SHARE = 0.3

/** The smallest bounds returned, so an empty or one-record map still frames sensibly. */
export const MIN_BOUNDS_RADIUS = 10

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A node as the API sent it, with its place and its orb's radius. */
export type PositionedNode = GraphNode & Vec3 & { radius: number }

export interface GraphLayout {
  /** New objects, in the order the nodes came in. */
  nodes: PositionedNode[]
  /** A sphere holding every orb, for the camera: the centre is the origin. */
  bounds: { center: Vec3; radius: number }
  /** Below 1 when the layout came out larger than maxRadius and was shrunk to fit. */
  scale: number
  /** The simulation steps run. */
  iterations: number
}

/** A graph or options the layout cannot use: a caller's mistake, not bad luck. */
export class LayoutInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutInputError'
  }
}

interface SimNode extends Vec3 {
  id: string
  radius: number
  index?: number
  vx?: number
  vy?: number
  vz?: number
}

interface SimLink {
  source: number | SimNode
  target: number | SimNode
}

export function compute3DLayout(
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
  options: LayoutOptions = {},
): GraphLayout {
  const settings = readOptions(options)
  const pull = settings.attraction
  const linkDistance = settings.linkDistance / pull
  const charge = settings.charge / pull
  const maxRadius = settings.maxRadius / Math.min(pull, 1)
  const chargeRange = settings.chargeRange / Math.min(pull, 1)

  // Sorted by id, so the order the graph arrives in can't change the result. Plain
  // comparison, not localeCompare: the same everywhere, whatever the locale.
  const sorted = [...nodes].sort((a, b) => compare(a.id, b.id))
  const indexById = new Map<string, number>()
  sorted.forEach((node, i) => {
    if (typeof node.id !== 'string' || node.id === '')
      throw new LayoutInputError('A node has no id.')
    if (indexById.has(node.id)) throw new LayoutInputError(`Two nodes have the id ${node.id}.`)
    indexById.set(node.id, i)
  })

  // One spring per linked pair, whichever way the links point and however many there are.
  // A record linked to itself gets none.
  const pairs = new Map<string, SimLink>()
  for (const link of links) {
    const source = indexById.get(link.source)
    const target = indexById.get(link.target)
    if (source === undefined || target === undefined) {
      const missing = source === undefined ? link.source : link.target
      throw new LayoutInputError(`Link ${link.id} names ${missing}, which is not a node.`)
    }
    if (source === target) continue
    const [low, high] = source < target ? [source, target] : [target, source]
    pairs.set(`${low} ${high}`, { source: low, target: high })
  }
  const springs = [...pairs.entries()].sort(([a], [b]) => compare(a, b)).map(([, pair]) => pair)

  // Seeded starting places, spread through a ball that grows with the graph.
  const random = mulberry32(settings.seed)
  const start = linkDistance * Math.cbrt(Math.max(sorted.length, 1))
  const simNodes: SimNode[] = sorted.map((node) => ({
    id: node.id,
    radius: NODE_RADIUS[node.type] ?? NODE_RADIUS.entry,
    ...pointInBall(random, start),
  }))

  // A new simulation starts its own timer; it is stopped at once and driven by hand, so
  // nothing stays scheduled after this returns (d3-timer's one pending frame then finds
  // nothing to run and clears itself). alpha cools to its floor on the last step.
  const alphaMin = 0.001
  const simulation = forceSimulation<SimNode>(simNodes, 3)
    .stop()
    .randomSource(random)
    .alphaMin(alphaMin)
    .alphaDecay(1 - Math.pow(alphaMin, 1 / settings.iterations))
    .force('link', linkForce(springs, pull).distance(linkDistance).iterations(1))
    .force(
      'charge',
      forceManyBody<SimNode>().strength(charge).theta(CHARGE_THETA).distanceMax(chargeRange),
    )
    .force('x', forceX<SimNode>(0).strength(settings.gravity))
    .force('y', forceY<SimNode>(0).strength(settings.gravity))
    .force('z', forceZ<SimNode>(0).strength(settings.gravity))
    .force('center', forceCenter<SimNode>(0, 0, 0))
  const colliding = Math.max(1, Math.round(settings.iterations * COLLIDE_SHARE))
  simulation.tick(settings.iterations - colliding)
  simulation.force(
    'collide',
    forceCollide<SimNode>((node) => node.radius + settings.spacing / 2),
  )
  simulation.tick(colliding)
  simulation.stop()

  for (const node of simNodes) {
    if (![node.x, node.y, node.z].every(Number.isFinite))
      throw new Error(`The layout gave ${node.id} no finite position.`)
  }

  // Centred on the origin, then shrunk, never stretched, so every orb fits in maxRadius.
  const centre = { x: 0, y: 0, z: 0 }
  for (const node of simNodes) {
    centre.x += node.x / simNodes.length
    centre.y += node.y / simNodes.length
    centre.z += node.z / simNodes.length
  }
  let farthest = 0
  let largestOrb = 0
  for (const node of simNodes) {
    node.x -= centre.x
    node.y -= centre.y
    node.z -= centre.z
    farthest = Math.max(farthest, Math.hypot(node.x, node.y, node.z))
    largestOrb = Math.max(largestOrb, node.radius)
  }
  const scale = farthest + largestOrb > maxRadius ? (maxRadius - largestOrb) / farthest : 1
  let reach = 0
  for (const node of simNodes) {
    node.x *= scale
    node.y *= scale
    node.z *= scale
    reach = Math.max(reach, Math.hypot(node.x, node.y, node.z) + node.radius)
  }

  const placed = new Map(simNodes.map((node) => [node.id, node]))
  return {
    nodes: nodes.map((node) => {
      const { x, y, z, radius } = placed.get(node.id)!
      return { ...node, x: tidy(x), y: tidy(y), z: tidy(z), radius }
    }),
    bounds: { center: { x: 0, y: 0, z: 0 }, radius: Math.max(reach, MIN_BOUNDS_RADIUS) },
    scale,
    iterations: settings.iterations,
  }
}

function readOptions(options: LayoutOptions): Required<LayoutOptions> {
  const settings = { ...LAYOUT_DEFAULTS }
  const take = (name: keyof LayoutOptions, valid: (n: number) => boolean, rule: string) => {
    const value = options[name]
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isFinite(value) || !valid(value))
      throw new LayoutInputError(`${name} must be ${rule}; got ${String(value)}.`)
    settings[name] = value
  }
  take(
    'iterations',
    (n) => Number.isInteger(n) && n >= 1 && n <= MAX_ITERATIONS,
    `a whole number from 1 to ${MAX_ITERATIONS}`,
  )
  take(
    'seed',
    (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff,
    'a whole number from 0 to 4294967295',
  )
  take('linkDistance', (n) => n > 0, 'above 0')
  take('charge', (n) => n <= 0, '0 or below')
  take('chargeRange', (n) => n > 0, 'above 0')
  take('spacing', (n) => n >= 0, '0 or above')
  take('gravity', (n) => n >= 0 && n <= 1, 'from 0 to 1')
  const largest = Math.max(...Object.values(NODE_RADIUS))
  take(
    'attraction',
    (n) => n >= MIN_ATTRACTION && n <= MAX_ATTRACTION,
    `from ${MIN_ATTRACTION} to ${MAX_ATTRACTION}`,
  )
  take('maxRadius', (n) => n > largest * 2, `above ${largest * 2}, room for two orbs`)
  return settings
}

/**
 * d3's link force, its springs' strength (1 over the busier end's link count) times
 * `pull`, capped at 1: a stronger spring overshoots and the layout comes apart.
 */
function linkForce(springs: SimLink[], pull: number) {
  const force = forceLink<SimNode, SimLink>(springs)
  if (pull === 1) return force
  const strength = force.strength()
  return force.strength((link, i, all) => Math.min(1, pull * strength(link, i, all)))
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** A small seeded generator (mulberry32): numbers in [0, 1), the same for the same seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A point spread evenly through a ball of the given radius. */
function pointInBall(random: () => number, radius: number): Vec3 {
  for (;;) {
    const x = random() * 2 - 1
    const y = random() * 2 - 1
    const z = random() * 2 - 1
    if (x * x + y * y + z * z <= 1) return { x: x * radius, y: y * radius, z: z * radius }
  }
}

/** -0 as 0, so the results compare and serialise plainly. */
function tidy(n: number): number {
  return n === 0 ? 0 : n
}
