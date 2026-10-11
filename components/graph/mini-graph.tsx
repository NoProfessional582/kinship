'use client'
/**
 * A record's neighbourhood on its own page: the contact or project and everything up to two
 * links away (/api/graph?focusId=…&depth=2), drawn small with the record selected. Hovering
 * lights a record's connections; picking one opens the full map on it, and "Open in map"
 * opens it on the page's own record (lib/graph/deep-link.ts).
 *
 * Nothing is fetched or drawn until the card scrolls into view, so reading the top of a page
 * never starts WebGL. Once shown it stays until the page is left, which frees the canvas
 * (graph-canvas.tsx). A record with no links says so with no canvas; a failed request can be
 * tried again; without WebGL the record's direct connections are listed as links. A record
 * the map does not have (just deleted) hides the card.
 *
 * The canvas is `compact`: the page scrolls over it, so it is not a tab stop and has no
 * keyboard of its own; "Open in map" (and, without WebGL, the list) is the keyboard's way in.
 */
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Orbit } from 'lucide-react'
import { GraphCanvas } from '@/components/graph/graph-canvas-loader'
import { GraphError, GraphLoading } from '@/components/graph/graph-states'
import { Card } from '@/components/ui/misc'
import { GRAPH_COLORS, type GraphData } from '@/lib/graph/constants'
import { mapHref, withRecordHref } from '@/lib/graph/deep-link'
import { connectionRows, linkText } from '@/lib/graph/inspector'
import { graphQueryKey, useGraphLayout, type GraphQuery } from '@/lib/graph/use-graph-layout'
import { useMapTheme } from '@/lib/graph/use-map-theme'
import { m } from '@/lib/mobile/href'

/** How far the small map reaches from its record. */
const DEPTH = 2
/** Connections listed without WebGL; the full map lists them all. */
const LIST_LIMIT = 8
const HUE = 'var(--hue-6)'
/** The share of the card that must show before it loads. */
const VISIBLE_SHARE = 0.01

const queryFor = (focusId: string): GraphQuery => ({ focusId, depth: DEPTH })

/** The small map's request, for refreshAfterDelete to leave alone once its record is gone. */
export const miniGraphKey = (focusId: string) => graphQueryKey(queryFor(focusId))

export interface MiniGraphProps {
  /** The page's record, as a graph id: `contact:<id>` or `project:<id>`. */
  focusId: string
  /** Its name, for the card's accessible name. */
  name: string
  /** On a phone page: shorter, the phone's section style, and every link within /m. */
  phone?: boolean
  /** The heading's level on the page: 3 by default, under the page's own sections. */
  level?: 2 | 3
}

const desktopPath = (path: string) => path

export function MiniGraph(props: MiniGraphProps) {
  // A new record starts afresh: unseen, and not known to be missing.
  return <MiniGraphCard key={props.focusId} {...props} />
}

function MiniGraphCard({ focusId, name, phone = false, level = 3 }: MiniGraphProps) {
  const href = phone ? m : desktopPath
  const card = React.useRef<HTMLElement>(null)
  const [seen, setSeen] = React.useState(false)
  const [missing, setMissing] = React.useState(false)
  const hide = React.useCallback(() => setMissing(true), [])

  React.useEffect(() => {
    const element = card.current
    if (seen || !element) return
    // Some of it showing, not just touching the window's edge, as a card just below a board
    // that fills the view does: that counts as intersecting with no threshold, and would load
    // it at once (and, with a check for area instead, never report it scrolled into view).
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { threshold: VISIBLE_SHARE },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])

  if (missing) return null

  const Heading = level === 2 ? 'h2' : 'h3'
  const open = (
    <Link
      href={href(mapHref(focusId))}
      className={
        phone
          ? 'kb-tap text-xs font-medium text-[var(--primary)]'
          : 'rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none'
      }
      style={phone ? undefined : { color: HUE }}
    >
      Open in map
    </Link>
  )
  const body = seen ? (
    <MiniGraphBody focusId={focusId} href={href} height={phone ? 220 : 260} onMissing={hide} />
  ) : (
    <Frame height={phone ? 220 : 260} />
  )

  if (phone) {
    return (
      <section ref={card} aria-label={`Map around ${name}`} data-testid="mini-map">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <Heading className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
            Map
          </Heading>
          {open}
        </div>
        <Card className="overflow-hidden">{body}</Card>
      </section>
    )
  }
  return (
    <section ref={card} aria-label={`Map around ${name}`} data-testid="mini-map">
      <Card className="overflow-hidden">
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ background: `color-mix(in oklch, ${HUE} 10%, transparent)` }}
        >
          <Orbit aria-hidden className="h-3.5 w-3.5" style={{ color: HUE }} />
          <Heading
            className="flex-1 text-xs font-semibold uppercase tracking-wide"
            style={{ color: HUE }}
          >
            Map
          </Heading>
          {open}
        </div>
        {body}
      </Card>
    </section>
  )
}

/** The map's surface, in the app's theme, at the card's height. */
function Frame({ height, children }: { height: number; children?: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{ height, background: 'var(--map-background)' }}
    >
      {children}
    </div>
  )
}

function MiniGraphBody({
  focusId,
  href,
  height,
  onMissing,
}: {
  focusId: string
  href: (path: string) => string
  height: number
  onMissing: () => void
}) {
  const { status, graph: data, layout, error, retry } = useGraphLayout(queryFor(focusId))
  const graph = React.useMemo(() => withRecordHref(data, href), [data, href])
  const notFound = status === 'error' && error!.notFound
  React.useEffect(() => {
    if (notFound) onMissing()
  }, [notFound, onMissing])

  const [webgl, setWebgl] = React.useState(true)
  const unavailable = React.useCallback(() => setWebgl(false), [])
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const theme = useMapTheme()
  const router = useRouter()
  const pick = React.useCallback(
    (id: string | null) => {
      if (id !== null) router.push(href(mapHref(id)))
    },
    [router, href],
  )

  if (notFound) return null
  if (status === 'error') {
    return (
      <Frame height={height}>
        <GraphError message={error!.message} onRetry={retry} />
      </Frame>
    )
  }
  if (graph && graph.nodes.length <= 1) {
    return (
      <p className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
        No connections yet. People, projects, notes, tasks and tags linked to this record show here.
      </p>
    )
  }
  if (!webgl && graph) return <ConnectionList focusId={focusId} graph={graph} />
  if (status !== 'ready' || !layout || !graph) {
    return (
      <Frame height={height}>
        <GraphLoading />
      </Frame>
    )
  }

  const others = graph.nodes.length - 1
  const hovered = hoveredId === null ? undefined : graph.nodes.find((n) => n.id === hoveredId)
  return (
    <Frame height={height}>
      <GraphCanvas
        layout={layout}
        links={graph.links}
        hoveredId={hoveredId}
        selectedId={focusId}
        theme={theme}
        compact
        onHover={setHoveredId}
        onSelect={pick}
        onUnavailable={unavailable}
      />
      <p
        className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-(--panel)/85 dark:bg-black/55 px-2 py-1 text-[11px] text-(--ink-raw) dark:text-slate-200"
        data-testid="mini-map-caption"
      >
        {hovered ? hovered.name : `${others} record${others === 1 ? '' : 's'} within two links`}
      </p>
    </Frame>
  )
}

/** Without WebGL: the record's direct connections, as links to their pages. */
function ConnectionList({ focusId, graph }: { focusId: string; graph: GraphData }) {
  const rows = connectionRows(
    focusId,
    graph.links,
    new Map(graph.nodes.map((node) => [node.id, node])),
  )
  const more = rows.length - LIST_LIMIT
  return (
    <div className="px-4 py-3">
      <p role="note" className="mb-2 text-xs text-[var(--muted-foreground)]">
        The map needs WebGL, which this browser has turned off. Connected records:
      </p>
      <ul className="flex flex-col gap-1.5" data-testid="mini-map-list">
        {rows.slice(0, LIST_LIMIT).map(({ node, links }) => (
          <li key={node.id} className="flex min-w-0 items-baseline gap-2 text-sm">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: GRAPH_COLORS[node.type] }}
            />
            {node.url ? (
              <Link href={node.url} className="min-w-0 truncate hover:underline">
                {node.name}
              </Link>
            ) : (
              <span className="min-w-0 truncate">{node.name}</span>
            )}
            <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
              {links.map(linkText).join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">and {more} more on the map</p>
      )}
    </div>
  )
}
