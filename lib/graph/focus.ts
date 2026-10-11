/**
 * `?focusId=<type>:<id>&depth=1|2`: reading the query, and cutting the graph down to
 * one record's neighbourhood. Pure, like normalize.ts.
 */
import { NotFoundError, ValidationError } from '../errors'
import {
  DEFAULT_FOCUS_DEPTH,
  FOCUS_DEPTHS,
  GRAPH_NODE_TYPES,
  type GraphData,
  type GraphNodeType,
} from './constants'

export type FocusDepth = (typeof FOCUS_DEPTHS)[number]

export interface GraphQuery {
  focus: { id: string; type: GraphNodeType; entityId: string } | null
  depth: FocusDepth | null
}

/** Any id a record can have: the app takes any non-empty string, so this only refuses blanks and noise. */
const ENTITY_ID = /^[^\s\p{Cc}]{1,256}$/u

/** One parameter's value; a parameter given twice must say the same thing both times. */
function single(params: URLSearchParams, name: string): string | null {
  const values = [...new Set(params.getAll(name))]
  if (values.length > 1)
    throw new ValidationError(`${name} was given more than once, with different values`)
  return values[0] ?? null
}

export function parseGraphQuery(params: URLSearchParams): GraphQuery {
  const focusId = single(params, 'focusId')
  const depthParam = single(params, 'depth')

  if (focusId === null) {
    if (depthParam !== null) throw new ValidationError('depth needs a focusId')
    return { focus: null, depth: null }
  }

  const colon = focusId.indexOf(':')
  const type = focusId.slice(0, colon)
  const entityId = focusId.slice(colon + 1)
  if (
    colon < 0 ||
    !(GRAPH_NODE_TYPES as readonly string[]).includes(type) ||
    !ENTITY_ID.test(entityId)
  ) {
    throw new ValidationError(
      `focusId must be <type>:<id>, with type one of ${GRAPH_NODE_TYPES.join(', ')}`,
    )
  }

  let depth: FocusDepth = DEFAULT_FOCUS_DEPTH
  if (depthParam !== null) {
    const match = FOCUS_DEPTHS.find((d) => String(d) === depthParam)
    if (match === undefined) throw new ValidationError(`depth must be ${FOCUS_DEPTHS.join(' or ')}`)
    depth = match
  }
  return { focus: { id: focusId, type: type as GraphNodeType, entityId }, depth }
}

/**
 * The focus and every node within `depth` links of it, following links either way,
 * with every link between the nodes kept. Links keep their stored direction. A focus
 * that is not in the graph is a 404, whatever the reason: missing, trashed, a draft or
 * another owner's record all answer the same.
 */
export function focusGraph(graph: GraphData, focusId: string, depth: FocusDepth): GraphData {
  if (!graph.nodes.some((n) => n.id === focusId)) throw new NotFoundError()

  const neighbours = new Map<string, string[]>()
  const add = (from: string, to: string) => {
    const list = neighbours.get(from)
    if (list) list.push(to)
    else neighbours.set(from, [to])
  }
  for (const l of graph.links) {
    add(l.source, l.target)
    add(l.target, l.source)
  }

  const kept = new Set([focusId])
  let frontier = [focusId]
  for (let step = 0; step < depth && frontier.length > 0; step++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (!kept.has(other)) {
          kept.add(other)
          next.push(other)
        }
      }
    }
    frontier = next
  }

  return {
    nodes: graph.nodes.filter((n) => kept.has(n.id)),
    links: graph.links.filter((l) => kept.has(l.source) && kept.has(l.target)),
  }
}
