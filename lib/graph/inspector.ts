/**
 * What the inspector lists for a selected record: one row per connected record, each with
 * every link between the two. Pure, no React, so it is tested on its own.
 *
 * A link keeps its stored direction and relation (plan "Visibility, links, and focus"):
 * one the selected record starts reads "→ works on", one that ends at it "← mentions".
 * Following a row selects the other record and changes neither.
 */
import { GRAPH_NODE_TYPES, type GraphLink, type GraphNode } from './constants'

export type LinkDirection = 'out' | 'in'

export interface ConnectionLink {
  /** The link's id, for a React key. */
  id: string
  relation: string
  /** 'out' when the selected record is the link's source. */
  direction: LinkDirection
}

export interface ConnectionRow {
  node: GraphNode
  /** Out before in, each by relation; never the same link twice. */
  links: ConnectionLink[]
}

/** The arrow shown before a relation. */
export const ARROWS: Record<LinkDirection, string> = { out: '→', in: '←' }

/** "→ works on", as shown. */
export function linkText({ relation, direction }: Pick<ConnectionLink, 'relation' | 'direction'>) {
  return `${ARROWS[direction]} ${relation}`
}

/** What a screen reader hears instead of the arrow. */
export function linkSpeech({
  relation,
  direction,
}: Pick<ConnectionLink, 'relation' | 'direction'>) {
  return `${relation}, ${direction === 'out' ? 'from' : 'to'} this record`
}

const TYPE_ORDER = new Map<string, number>(GRAPH_NODE_TYPES.map((type, i) => [type, i]))

/**
 * The selected record's connections, by type (as in the legend) and then name. Links to
 * itself and to records the graph does not have are left out; the same link id is listed
 * once, whatever tables it was merged from.
 */
export function connectionRows(
  id: string,
  links: readonly GraphLink[],
  nodes: ReadonlyMap<string, GraphNode>,
): ConnectionRow[] {
  const rows = new Map<string, ConnectionRow>()
  const seen = new Set<string>()
  for (const link of links) {
    if (link.source !== id && link.target !== id) continue
    if (link.source === link.target || seen.has(link.id)) continue
    const direction: LinkDirection = link.source === id ? 'out' : 'in'
    const otherId = direction === 'out' ? link.target : link.source
    const node = nodes.get(otherId)
    if (!node) continue
    seen.add(link.id)
    let row = rows.get(otherId)
    if (!row) rows.set(otherId, (row = { node, links: [] }))
    row.links.push({ id: link.id, relation: link.relation, direction })
  }

  for (const row of rows.values()) {
    row.links.sort(
      (a, b) =>
        (a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1) ||
        a.relation.localeCompare(b.relation),
    )
  }
  return [...rows.values()].sort(
    (a, b) =>
      (TYPE_ORDER.get(a.node.type) ?? 99) - (TYPE_ORDER.get(b.node.type) ?? 99) ||
      a.node.name.localeCompare(b.node.name) ||
      a.node.id.localeCompare(b.node.id),
  )
}
