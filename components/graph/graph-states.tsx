/**
 * What the map shows instead of the canvas: while it loads, when there is nothing to map,
 * when the request or the layout failed, and when the browser has no WebGL. The last is a
 * plain list of the records, grouped by type, so the page is still of use.
 *
 * The map's surface is always dark (#080a0e), whatever the app's theme, so these use
 * fixed light text rather than the theme's colours.
 */
import Link from 'next/link'
import { AlertTriangle, Loader2, Orbit } from 'lucide-react'
import {
  GRAPH_COLORS,
  GRAPH_NODE_TYPES,
  type GraphData,
  type GraphNode,
  type GraphNodeType,
} from '@/lib/graph/constants'

export const TYPE_HEADINGS: Record<GraphNodeType, string> = {
  contact: 'People',
  project: 'Projects',
  entry: 'Notes',
  task: 'Tasks',
  tag: 'Tags',
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  )
}

export function GraphLoading() {
  return (
    <Centered>
      <div role="status" className="flex flex-col items-center gap-3 text-slate-300">
        <Loader2 className="h-7 w-7 animate-spin opacity-70 motion-reduce:animate-none" />
        <p className="text-sm">Mapping your records…</p>
      </div>
    </Centered>
  )
}

export function GraphEmpty() {
  return (
    <Centered>
      <Orbit className="h-8 w-8 text-slate-400 opacity-70" />
      <p className="text-sm font-medium text-slate-200">No records yet</p>
      <p className="max-w-xs text-xs text-slate-400">
        People, projects, notes, tasks and tags appear here once you add them.
      </p>
    </Centered>
  )
}

export function GraphError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Centered>
      <div role="alert" className="flex flex-col items-center gap-3">
        <AlertTriangle className="h-7 w-7 text-amber-400" />
        <p className="text-sm font-medium text-slate-200">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
        >
          Try again
        </button>
      )}
    </Centered>
  )
}

/**
 * Records grouped by type in the legend's order, each group by name; empty groups are left
 * out. Shared by the list below and the map's record picker.
 */
export function groupRecords(nodes: readonly GraphNode[]) {
  return GRAPH_NODE_TYPES.map((type) => ({
    type,
    nodes: nodes.filter((node) => node.type === type).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.nodes.length > 0)
}

/** The records as a list, for a browser without WebGL. */
export function GraphRecordList({ graph }: { graph: GraphData }) {
  const groups = groupRecords(graph.nodes)

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 text-slate-200">
      <div className="mx-auto max-w-2xl">
        <div role="note" className="mb-6 rounded-md border border-slate-700 bg-slate-900/60 p-3">
          <p className="text-sm font-medium">
            The 3D map needs WebGL, which this browser has turned off.
          </p>
          <p className="mt-1 text-xs text-slate-400">Here are your records as a list instead.</p>
        </div>
        {groups.map(({ type, nodes }) => (
          <section key={type} aria-labelledby={`map-list-${type}`} className="mb-6">
            <h2
              id={`map-list-${type}`}
              className="mb-2 flex items-center gap-2 text-sm font-semibold"
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: GRAPH_COLORS[type] }}
              />
              {TYPE_HEADINGS[type]} <span className="text-slate-500">({nodes.length})</span>
            </h2>
            <ul className="space-y-1 pl-4.5">
              {nodes.map((node) => (
                <li key={node.id} className="text-sm">
                  {node.url ? (
                    <Link href={node.url} className="text-sky-300 hover:underline">
                      {node.name}
                    </Link>
                  ) : (
                    <span>{node.name}</span>
                  )}
                  {node.subtitle && (
                    <span className="ml-2 text-xs text-slate-500">{node.subtitle}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
