'use client'
/**
 * The map's data: fetches the graph from /api/graph and lays it out in the layout worker.
 * A new graph, or a new attraction, cancels the layout still running, and leaving the page
 * cancels both the request and the layout and stops the worker. What the page shows comes
 * from graphLayoutState, which only ever pairs a layout with the graph it was made from;
 * while a new attraction is being laid out, the map keeps the layout it has.
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isNotFound } from '@/lib/hooks/api'
import { DEFAULT_FOCUS_DEPTH, type FOCUS_DEPTHS, type GraphData } from './constants'
import type { GraphLayout } from './layout3d'
import {
  LayoutCancelledError,
  createLayoutClient,
  startLayoutWorker,
  type LayoutClient,
} from './layout-client'

export interface GraphQuery {
  /** A typed graph id, such as `contact:<id>`: only that record and its neighbours. */
  focusId?: string
  depth?: (typeof FOCUS_DEPTHS)[number]
}

export type GraphLayoutStatus = 'loading' | 'empty' | 'ready' | 'error'

export interface GraphLayoutState {
  status: GraphLayoutStatus
  /** The graph and its layout, together, when the status is ready. */
  graph?: GraphData
  layout?: GraphLayout
  /** For the error status: a message for the page, and whether the record was not found. */
  error?: { message: string; notFound: boolean }
  /** Ready, but the layout shown was made at another attraction; the new one is coming. */
  rearranging?: boolean
}

/** A finished layout, or the error it ended in, and the graph it was made for. */
export interface LayoutOutcome {
  graph: GraphData
  /** The attraction it was laid out at. */
  attraction: number
  layout?: GraphLayout
  error?: Error
}

/** The performance entry timing each layout, request to answer, in the browser. */
export const LAYOUT_MEASURE = 'graph:layout'

export const GRAPH_LOAD_FAILED = 'The map could not load your records.'
export const FOCUS_NOT_FOUND = 'That record is not on the map. It may have been deleted.'

export function graphUrl({ focusId, depth }: GraphQuery = {}): string {
  if (!focusId) return '/api/graph'
  const params = new URLSearchParams({ focusId, depth: String(depth ?? DEFAULT_FOCUS_DEPTH) })
  return `/api/graph?${params}`
}

/**
 * What the page shows, from the request and the latest finished layout. A layout counts
 * only for the very graph it was made from, so a layout of an earlier graph is never
 * drawn: until the current graph's layout arrives, the map is still loading. A layout of
 * this graph at another attraction is still drawn, marked as rearranging.
 */
export function graphLayoutState(
  request: { data?: GraphData; error?: unknown },
  outcome: LayoutOutcome | null,
  attraction = 1,
): GraphLayoutState {
  if (request.error) {
    const notFound = isNotFound(request.error)
    return {
      status: 'error',
      error: { message: notFound ? FOCUS_NOT_FOUND : GRAPH_LOAD_FAILED, notFound },
    }
  }
  const graph = request.data
  if (!graph) return { status: 'loading' }
  if (graph.nodes.length === 0) return { status: 'empty', graph }
  if (!outcome || outcome.graph !== graph) return { status: 'loading', graph }
  if (outcome.error) {
    return { status: 'error', graph, error: { message: outcome.error.message, notFound: false } }
  }
  if (outcome.attraction !== attraction) {
    return { status: 'ready', graph, layout: outcome.layout, rearranging: true }
  }
  return { status: 'ready', graph, layout: outcome.layout }
}

/** The request's React Query key, so a page can leave one alone (refreshAfterDelete). */
export const graphQueryKey = (query: GraphQuery = {}) => ['graph', graphUrl(query)] as const

/**
 * `attraction` is LayoutOptions.attraction; each new value lays the graph out again, so
 * the caller passes it once a slider has settled, not on every step.
 */
export function useGraphLayout(
  query: GraphQuery = {},
  attraction = 1,
): GraphLayoutState & { retry: () => void } {
  const url = graphUrl(query)
  const request = useQuery({
    queryKey: graphQueryKey(query),
    // React Query aborts the request when the page leaves or the query changes.
    queryFn: ({ signal }) => api.get<GraphData>(url, { signal }),
  })

  const client = useRef<LayoutClient | null>(null)
  const [outcome, setOutcome] = useState<LayoutOutcome | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const created = createLayoutClient(startLayoutWorker)
    client.current = created
    return () => {
      created.dispose()
      if (client.current === created) client.current = null
    }
  }, [])

  const graph = request.data
  useEffect(() => {
    const layouts = client.current
    if (!graph || graph.nodes.length === 0 || !layouts) return
    let current = true
    const started = performance.now()
    // The default is left out of the request, so the worker gets what it always did.
    const options = attraction === 1 ? undefined : { attraction }
    layouts.layout(graph, options).then(
      (layout) => {
        if (!current) return
        // Read by the render benchmark (tests/benchmark); one entry per layout.
        performance.measure(LAYOUT_MEASURE, { start: started })
        setOutcome({ graph, attraction, layout })
      },
      (err: unknown) => {
        if (!current || err instanceof LayoutCancelledError) return
        const error = err instanceof Error ? err : new Error(String(err))
        setOutcome({ graph, attraction, error })
      },
    )
    return () => {
      current = false
      layouts.cancel()
    }
  }, [graph, attraction, attempt])

  const { error, refetch } = request
  const retry = useCallback(() => {
    // A failed request is asked again; a failed layout is laid out again.
    if (error) {
      void refetch()
    } else {
      setOutcome(null)
      setAttempt((n) => n + 1)
    }
  }, [error, refetch])

  return { ...graphLayoutState(request, outcome, attraction), retry }
}
