'use client'
/**
 * The 3D map of every record and how they connect. Hovering a record previews its direct
 * connections; clicking selects it, and Escape or a click on empty space clears it. The
 * overlay's settings last for the visit only. No sidebar link or inspector yet (plan
 * kinship-3d-map, phases 03-04).
 */
import * as React from 'react'
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/graph-canvas-loader'
import { GraphOverlay } from '@/components/graph/graph-overlay'
import {
  GraphEmpty,
  GraphError,
  GraphLoading,
  GraphRecordList,
} from '@/components/graph/graph-states'
import { MAP_BACKGROUND } from '@/lib/graph/constants'
import { highlightState, highlightSummary, neighbourSets } from '@/lib/graph/highlight'
import { SCENE_DEFAULTS, type SceneSettings } from '@/lib/graph/scene'
import { useGraphLayout } from '@/lib/graph/use-graph-layout'

export default function MapPage() {
  const { status, graph, layout, error, retry } = useGraphLayout()
  const [webgl, setWebgl] = React.useState(true)
  const unavailable = React.useCallback(() => setWebgl(false), [])
  // The overlay waits for the canvas's first frame, so it never sits over the loading state.
  const [drawn, setDrawn] = React.useState(false)
  const ready = React.useCallback(() => setDrawn(true), [])
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<SceneSettings>(SCENE_DEFAULTS)
  // Off at first, reduced motion or not; only the user turns it on.
  const [autoOrbit, setAutoOrbit] = React.useState(false)
  const canvas = React.useRef<GraphCanvasHandle>(null)
  const reset = React.useCallback(() => {
    setSelectedId(null)
    canvas.current?.resetCamera()
  }, [])

  const neighbours = React.useMemo(() => neighbourSets(graph?.links ?? []), [graph])
  const names = React.useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node.name])),
    [graph],
  )
  const highlight = highlightState({ hoveredId, selectedId, neighbours })

  React.useEffect(() => {
    if (selectedId === null) return
    const clear = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', clear)
    return () => window.removeEventListener('keydown', clear)
  }, [selectedId])

  let body: React.ReactNode
  let mapShown = false
  if (status === 'error') body = <GraphError message={error!.message} onRetry={retry} />
  else if (status === 'empty') body = <GraphEmpty />
  else if (!webgl && graph) body = <GraphRecordList graph={graph} />
  else if (status === 'ready' && layout && graph) {
    mapShown = true
    body = (
      <GraphCanvas
        ref={canvas}
        layout={layout}
        links={graph.links}
        hoveredId={hoveredId}
        selectedId={selectedId}
        settings={settings}
        autoOrbit={autoOrbit}
        onHover={setHoveredId}
        onSelect={setSelectedId}
        onReady={ready}
        onUnavailable={unavailable}
      />
    )
  } else body = <GraphLoading />

  return (
    <div
      className="relative h-full min-h-[24rem] overflow-hidden"
      style={{ background: MAP_BACKGROUND, colorScheme: 'dark' }}
      data-active-id={highlight.activeId ?? ''}
      data-highlight={highlight.mode}
    >
      <h1 className="sr-only">Map</h1>
      {body}
      {mapShown && drawn && (
        <GraphOverlay
          settings={settings}
          onSettingsChange={setSettings}
          autoOrbit={autoOrbit}
          onAutoOrbitChange={setAutoOrbit}
          onReset={reset}
        />
      )}
      {mapShown && (
        <p
          aria-live="polite"
          className="pointer-events-none absolute right-3 bottom-3 left-3 truncate rounded-md bg-black/55 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-sm sm:right-auto sm:max-w-md"
          data-testid="map-status"
          data-map-chrome
        >
          {highlightSummary(
            highlight,
            highlight.activeId === null ? undefined : names.get(highlight.activeId),
          )}
        </p>
      )}
    </div>
  )
}
