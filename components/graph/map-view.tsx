'use client'
/**
 * The 3D map of every record and how they connect, as the desktop page (/map) and the phone
 * page (/m/map) both show it. Hovering a record previews its direct connections; clicking
 * selects it and opens the inspector, whose connections select the next record. Escape, a
 * click on empty space or the inspector's close button clears it. The "Records" list
 * reaches any record without a pointer. The overlay's settings, and the legend's filter of
 * which record types show, last for the visit only.
 * Its "Attraction" slider lays the map out again once it has settled for ATTRACTION_SETTLE
 * ms; the map drawn stays until the new arrangement is in, and the selection is kept.
 * The map follows the app's theme (use-map-theme.ts).
 *
 * `?focus=<type>:<id>` (lib/graph/deep-link.ts) selects that record once the map is drawn,
 * as a pick from the Records list would. A focus that is not on the map, or not a record id
 * at all, leaves the whole map showing with a notice to say so. Selecting other records
 * afterwards leaves the URL as it was.
 *
 * Records link to their own pages by their desktop paths; `recordHref` turns those into
 * the page's own (m() on a phone, so the phone stays in its own pages).
 */
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
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
import type { GraphNodeType } from '@/lib/graph/constants'
import { readMapFocus, withRecordHref } from '@/lib/graph/deep-link'
import { highlightState, highlightSummary, neighbourSets } from '@/lib/graph/highlight'
import { connectionRows } from '@/lib/graph/inspector'
import { SCENE_DEFAULTS, type SceneSettings } from '@/lib/graph/scene'
import { FOCUS_NOT_FOUND, useGraphLayout } from '@/lib/graph/use-graph-layout'
import { useMapTheme } from '@/lib/graph/use-map-theme'

export interface MapViewProps {
  /** A record's page, from its desktop path; the desktop's own path when left out. */
  recordHref?: (path: string) => string
}

export const REARRANGING = 'Arranging the map…'

const FRAME = 'relative h-full min-h-[24rem] overflow-hidden'
const FRAME_STYLE = { background: 'var(--map-background)' } as const

export function MapView(props: MapViewProps) {
  // The query is only known in the browser; until then the frame shows it is loading.
  return (
    <React.Suspense
      fallback={
        <div className={FRAME} style={FRAME_STYLE}>
          <h1 className="sr-only">Map</h1>
          <GraphLoading />
        </div>
      }
    >
      <MapBody {...props} />
    </React.Suspense>
  )
}

/** How long the Attraction slider rests before the map is laid out again. */
export const ATTRACTION_SETTLE = 250

function MapBody({ recordHref }: MapViewProps) {
  // The slider's value at once; the layout's once it has settled.
  const [attraction, setAttraction] = React.useState(1)
  const [settled, setSettled] = React.useState(1)
  React.useEffect(() => {
    if (attraction === settled) return
    const timer = window.setTimeout(() => setSettled(attraction), ATTRACTION_SETTLE)
    return () => window.clearTimeout(timer)
  }, [attraction, settled])
  const {
    status,
    graph: data,
    layout,
    error,
    retry,
    rearranging,
  } = useGraphLayout(undefined, settled)
  const theme = useMapTheme()
  const graph = React.useMemo(() => withRecordHref(data, recordHref), [data, recordHref])
  const [webgl, setWebgl] = React.useState(true)
  const unavailable = React.useCallback(() => setWebgl(false), [])
  // The overlay waits for the canvas's first frame, so it never sits over the loading state.
  const [drawn, setDrawn] = React.useState(false)
  const ready = React.useCallback(() => setDrawn(true), [])
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<SceneSettings>(SCENE_DEFAULTS)
  // The legend's filter; every type shows at first.
  const [hiddenTypes, setHiddenTypes] = React.useState<ReadonlySet<GraphNodeType>>(() => new Set())
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
  // A record whose type the legend hides is neither hovered nor selected.
  const hidden = (id: string | null) => {
    const type = id === null ? undefined : records.get(id)?.type
    return type !== undefined && hiddenTypes.has(type)
  }
  if (hidden(hoveredId)) setHoveredId(null)
  if (hidden(selectedId)) setSelectedId(null)
  const highlight = highlightState({ hoveredId, selectedId, neighbours })
  const selected = selectedId === null ? undefined : records.get(selectedId)
  const rows = React.useMemo(
    () => (selected ? connectionRows(selected.id, graph?.links ?? [], records) : []),
    [selected, graph, records],
  )
  const clear = React.useCallback(() => setSelectedId(null), [])
  // How much of the map the inspector covers, so the canvas keeps the selection in view.
  const [inset, setInset] = React.useState({ right: 0, bottom: 0 })

  // The link's focus, acted on once per value: when the map has drawn (or, without WebGL,
  // once the records are in), it selects the record or puts up the notice.
  const params = useSearchParams()
  const focus = readMapFocus(params)
  const focusKey = JSON.stringify(params.getAll('focus'))
  const [handledFocus, setHandledFocus] = React.useState('[]')
  const [notice, setNotice] = React.useState<string | null>(null)
  if (focusKey !== handledFocus && status === 'ready' && (drawn || !webgl)) {
    setHandledFocus(focusKey)
    if (focus.kind === 'record' && records.has(focus.id)) {
      setSelectedId(focus.id)
      setNotice(null)
    } else setNotice(focus.kind === 'none' ? null : FOCUS_NOT_FOUND)
  }

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
        hiddenTypes={hiddenTypes}
        frame={data}
        theme={theme}
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
      className={FRAME}
      style={FRAME_STYLE}
      data-active-id={highlight.activeId ?? ''}
      data-highlight={highlight.mode}
      data-attraction={rearranging || attraction !== settled ? undefined : settled}
      aria-busy={rearranging || attraction !== settled || undefined}
    >
      <h1 className="sr-only">Map</h1>
      {body}
      {mapShown && drawn && (
        <GraphOverlay
          settings={settings}
          onSettingsChange={setSettings}
          hiddenTypes={hiddenTypes}
          onHiddenTypesChange={setHiddenTypes}
          attraction={attraction}
          onAttractionChange={setAttraction}
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
      {notice && <FocusNotice message={notice} onDismiss={() => setNotice(null)} />}
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
          className="pointer-events-none absolute right-3 bottom-3 left-3 truncate rounded-md bg-(--panel)/85 px-3 py-1.5 text-xs text-(--ink-raw) backdrop-blur-sm sm:right-auto sm:max-w-md"
          data-testid="map-status"
          data-map-chrome
        >
          {rearranging
            ? REARRANGING
            : highlightSummary(
                highlight,
                highlight.activeId === null ? undefined : records.get(highlight.activeId)?.name,
              )}
        </p>
      )}
    </div>
  )
}

/**
 * Says the linked record is not on the map. Below the controls on a phone (and under them,
 * should their panel open), at the top right on a wide screen, and under the inspector.
 */
function FocusNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      data-testid="map-notice"
      data-map-chrome
      className="absolute top-14 right-3 left-3 z-[5] flex items-start gap-2 rounded-lg border border-(--ochre)/50 bg-(--panel)/95 p-3 text-sm text-(--ink-raw) shadow-lg backdrop-blur-md sm:top-3 sm:left-auto sm:max-w-sm"
    >
      <p className="min-w-0 flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded-md p-1 text-(--muted-raw) hover:bg-(--ink-raw)/[0.07] hover:text-(--ink-raw) focus-visible:ring-2 focus-visible:ring-(--terracotta) focus-visible:outline-none"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </div>
  )
}
