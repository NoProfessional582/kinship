'use client'
/**
 * The 3D map of every record and how they connect. Hovering a record previews its direct
 * connections; clicking selects it and opens the inspector, whose connections select the
 * next record. Escape, a click on empty space or the inspector's close button clears it.
 * The "Records" list reaches any record without a pointer. The overlay's settings last for
 * the visit only. No sidebar link yet (plan kinship-3d-map, phase 04).
 */
import * as React from 'react'
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/graph-canvas-loader'
import { GraphInspector } from '@/components/graph/graph-inspector'
import { GraphOverlay } from '@/components/graph/graph-overlay'
import { GraphRecordPicker } from '@/components/graph/graph-record-picker'
import {
  GraphEmpty,
  GraphError,
  GraphLoading,
  GraphRecordList,
} from '@/components/graph/graph-states'
import { MAP_BACKGROUND } from '@/lib/graph/constants'
import { highlightState, highlightSummary, neighbourSets } from '@/lib/graph/highlight'
import { connectionRows } from '@/lib/graph/inspector'
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
  const records = React.useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  )
  const highlight = highlightState({ hoveredId, selectedId, neighbours })
  const selected = selectedId === null ? undefined : records.get(selectedId)
  const rows = React.useMemo(
    () => (selected ? connectionRows(selected.id, graph?.links ?? [], records) : []),
    [selected, graph, records],
  )
  const clear = React.useCallback(() => setSelectedId(null), [])
  // How much of the map the inspector covers, so the canvas keeps the selection in view.
  const [inset, setInset] = React.useState({ right: 0, bottom: 0 })

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
        inset={inset}
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
          drawerOpen={selected !== undefined}
          records={(buttonClass) => (
            <GraphRecordPicker
              nodes={graph!.nodes}
              onSelect={setSelectedId}
              className={buttonClass}
            />
          )}
        />
      )}
      {mapShown && selected && (
        <GraphInspector
          node={selected}
          rows={rows}
          onSelect={setSelectedId}
          onClose={clear}
          onCover={setInset}
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
            highlight.activeId === null ? undefined : records.get(highlight.activeId)?.name,
          )}
        </p>
      )}
    </div>
  )
}
