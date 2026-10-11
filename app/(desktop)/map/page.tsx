'use client'
/**
 * The 3D map of every record and how they connect. Bare for now: no sidebar link, overlay,
 * highlighting or inspector yet (plan kinship-3d-map, phases 03-04).
 */
import * as React from 'react'
import { GraphCanvas } from '@/components/graph/graph-canvas-loader'
import {
  GraphEmpty,
  GraphError,
  GraphLoading,
  GraphRecordList,
} from '@/components/graph/graph-states'
import { MAP_BACKGROUND } from '@/lib/graph/constants'
import { useGraphLayout } from '@/lib/graph/use-graph-layout'

export default function MapPage() {
  const { status, graph, layout, error, retry } = useGraphLayout()
  const [webgl, setWebgl] = React.useState(true)
  const unavailable = React.useCallback(() => setWebgl(false), [])

  let body: React.ReactNode
  if (status === 'error') body = <GraphError message={error!.message} onRetry={retry} />
  else if (status === 'empty') body = <GraphEmpty />
  else if (!webgl && graph) body = <GraphRecordList graph={graph} />
  else if (status === 'ready' && layout && graph)
    body = <GraphCanvas layout={layout} links={graph.links} onUnavailable={unavailable} />
  else body = <GraphLoading />

  return (
    <div
      className="relative h-full min-h-[24rem] overflow-hidden"
      style={{ background: MAP_BACKGROUND, colorScheme: 'dark' }}
    >
      <h1 className="sr-only">Map</h1>
      {body}
    </div>
  )
}
