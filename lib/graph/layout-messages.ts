/**
 * The messages between the map and its layout worker (layout.worker.ts), shared by both
 * sides so they cannot drift apart. Everything is plain data, safe for postMessage.
 *
 * Every request carries a request id and its answer repeats it, so the map can tell an
 * answer to the graph it is showing from one to a graph it has already moved on from.
 * docs/graph-layout.md "Worker messages" describes them.
 */
import type { GraphLink, GraphNode } from './constants'
import { LayoutInputError, compute3DLayout, type GraphLayout, type LayoutOptions } from './layout3d'

export interface LayoutRequest {
  requestId: number
  nodes: GraphNode[]
  links: GraphLink[]
  options?: LayoutOptions
}

export type LayoutResponse =
  { requestId: number; layout: GraphLayout } | { requestId: number; error: string }

/** What the worker shows when the layout fails for a reason other than the graph itself. */
export const LAYOUT_FAILED = 'The map could not be laid out.'

/** Runs one request. The worker's whole job, kept here so it can be tested without one. */
export function answerLayoutRequest(request: LayoutRequest): LayoutResponse {
  const { requestId } = request
  try {
    return { requestId, layout: compute3DLayout(request.nodes, request.links, request.options) }
  } catch (err) {
    // A refusal names what is wrong with the graph; anything else is a fault in the
    // layout, and the map only needs to know it has no picture to draw.
    return { requestId, error: err instanceof LayoutInputError ? err.message : LAYOUT_FAILED }
  }
}
