/**
 * Types for d3-force-3d 3.0.6, which ships none (there is no @types package). Only the
 * part lib/graph/layout3d.ts uses, written against the package's src/*.js: a simulation
 * driven by hand (stop, tick), its random source, and the link, many-body, collide,
 * centre and x/y/z forces. Check them against the source when the package is upgraded.
 */
declare module 'd3-force-3d' {
  export interface SimulationNode {
    index?: number
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
    fx?: number | null
    fy?: number | null
    fz?: number | null
  }

  export interface SimulationLink<N extends SimulationNode> {
    /** A node, or before the link force starts, the node's index or id */
    source: N | number | string
    target: N | number | string
    index?: number
  }

  /** Called with the simulation's alpha on every tick. */
  export interface Force<N extends SimulationNode> {
    (alpha: number): void
    initialize?(nodes: N[], random: () => number, numDimensions: number): void
  }

  export interface Simulation<N extends SimulationNode> {
    /** Runs the forces by hand, without the timer; never fires tick or end events. */
    tick(iterations?: number): this
    restart(): this
    /** Stops the internal timer that a new simulation starts on its own. */
    stop(): this
    numDimensions(): 1 | 2 | 3
    numDimensions(dimensions: 1 | 2 | 3): this
    nodes(): N[]
    nodes(nodes: N[]): this
    alpha(): number
    alpha(alpha: number): this
    alphaMin(): number
    alphaMin(min: number): this
    alphaDecay(): number
    alphaDecay(decay: number): this
    alphaTarget(): number
    alphaTarget(target: number): this
    velocityDecay(): number
    velocityDecay(decay: number): this
    randomSource(): () => number
    randomSource(source: () => number): this
    force(name: string): Force<N> | undefined
    force(name: string, force: Force<N> | null): this
  }

  export function forceSimulation<N extends SimulationNode>(
    nodes?: N[],
    numDimensions?: 1 | 2 | 3,
  ): Simulation<N>

  export interface ForceLink<
    N extends SimulationNode,
    L extends SimulationLink<N>,
  > extends Force<N> {
    links(): L[]
    links(links: L[]): this
    id(id: (node: N, index: number, nodes: N[]) => number | string): this
    iterations(iterations: number): this
    strength(strength: number | ((link: L, index: number, links: L[]) => number)): this
    distance(distance: number | ((link: L, index: number, links: L[]) => number)): this
  }
  export function forceLink<N extends SimulationNode, L extends SimulationLink<N>>(
    links?: L[],
  ): ForceLink<N, L>

  export interface ForceManyBody<N extends SimulationNode> extends Force<N> {
    strength(strength: number | ((node: N, index: number, nodes: N[]) => number)): this
    theta(theta: number): this
    distanceMin(distance: number): this
    distanceMax(distance: number): this
  }
  export function forceManyBody<N extends SimulationNode>(): ForceManyBody<N>

  export interface ForceCollide<N extends SimulationNode> extends Force<N> {
    radius(radius: number | ((node: N, index: number, nodes: N[]) => number)): this
    strength(strength: number): this
    iterations(iterations: number): this
  }
  export function forceCollide<N extends SimulationNode>(
    radius?: number | ((node: N, index: number, nodes: N[]) => number),
  ): ForceCollide<N>

  export interface ForceCenter<N extends SimulationNode> extends Force<N> {
    strength(strength: number): this
  }
  export function forceCenter<N extends SimulationNode>(
    x?: number,
    y?: number,
    z?: number,
  ): ForceCenter<N>

  /** forceX, forceY and forceZ: a pull towards one coordinate on their axis. */
  export interface ForceAxis<N extends SimulationNode> extends Force<N> {
    strength(strength: number | ((node: N, index: number, nodes: N[]) => number)): this
  }
  export function forceX<N extends SimulationNode>(x?: number): ForceAxis<N>
  export function forceY<N extends SimulationNode>(y?: number): ForceAxis<N>
  export function forceZ<N extends SimulationNode>(z?: number): ForceAxis<N>
}
