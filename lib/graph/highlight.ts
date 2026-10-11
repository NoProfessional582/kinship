/**
 * Which records and links the map lights up, from what is hovered and what is selected.
 * Pure, no three: the scene (scene.ts, applyHighlight) turns these looks into material
 * and vertex-colour changes, and the page uses the same state for its status line.
 *
 * The values are the approved prototype's (`updateHighlighting`), with the resting orb's
 * radiance at 0.45 (plan decisions 2026-10-10). A record or link is only ever in one look.
 */
import type { GraphLink } from './constants'

export type HighlightMode = 'none' | 'hover' | 'selected'
export type HighlightRole = 'target' | 'neighbour' | 'other'

/** Every record's direct connections, either way round; built once per graph. */
export type NeighbourSets = ReadonlyMap<string, ReadonlySet<string>>

export interface HighlightState {
  /** The selected record, or else the hovered one; null when neither. */
  activeId: string | null
  mode: HighlightMode
  /** The active record's direct connections (empty when nothing is active). */
  neighbours: ReadonlySet<string>
  /** What the pointer is on and what is selected, which can differ; for growth. */
  hoveredId: string | null
  selectedId: string | null
}

export type NodeLook = 'resting' | 'target' | 'neighbour' | 'otherHover' | 'otherSelected'
export type LinkLook = 'resting' | 'lit' | 'fadedHover' | 'fadedSelected'

export interface NodeLookValues {
  orbOpacity: number
  orbEmissive: number
  labelOpacity: number
  auraOpacity: number
  /** Whether the emissive and aura values are scaled by the glow setting. */
  glows: boolean
}

export const NODE_LOOKS: Readonly<Record<NodeLook, Readonly<NodeLookValues>>> = {
  resting: {
    orbOpacity: 0.95,
    orbEmissive: 0.45,
    labelOpacity: 0.9,
    auraOpacity: 0.7,
    glows: true,
  },
  target: { orbOpacity: 1, orbEmissive: 0.7, labelOpacity: 1, auraOpacity: 0.9, glows: true },
  neighbour: {
    orbOpacity: 0.95,
    orbEmissive: 0.45,
    labelOpacity: 0.95,
    auraOpacity: 0.7,
    glows: true,
  },
  otherHover: {
    orbOpacity: 0.35,
    orbEmissive: 0.08,
    labelOpacity: 0.3,
    auraOpacity: 0.15,
    glows: false,
  },
  otherSelected: {
    orbOpacity: 0.12,
    orbEmissive: 0.08,
    labelOpacity: 0.1,
    auraOpacity: 0.05,
    glows: false,
  },
}

export type LinkLooks = Readonly<Record<LinkLook, { color: string; opacity: number }>>

/** On the dark map, as approved. */
export const LINK_LOOKS: LinkLooks = {
  resting: { color: '#5a6372', opacity: 0.55 },
  lit: { color: '#a5b4fc', opacity: 1 },
  fadedHover: { color: '#404854', opacity: 0.2 },
  fadedSelected: { color: '#404854', opacity: 0.04 },
}

/** On the light map: warm greys from the palette, lit in its terracotta. */
export const LIGHT_LINK_LOOKS: LinkLooks = {
  resting: { color: '#8a857a', opacity: 0.55 },
  lit: { color: '#bd5b3f', opacity: 1 },
  fadedHover: { color: '#b5afa3', opacity: 0.25 },
  fadedSelected: { color: '#b5afa3', opacity: 0.06 },
}

/** A look's values at a glow setting: radiance and aura scale with it, the aura up to 1. */
export function nodeLookValues(look: NodeLook, glow: number) {
  const values = NODE_LOOKS[look]
  const scale = values.glows ? glow : 1
  return {
    orbOpacity: values.orbOpacity,
    orbEmissive: values.orbEmissive * scale,
    labelOpacity: values.labelOpacity,
    auraOpacity: Math.min(1, values.auraOpacity * scale),
  }
}

const NONE: ReadonlySet<string> = new Set()

export function neighbourSets(links: readonly GraphLink[]): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>()
  const add = (from: string, to: string) => {
    let set = sets.get(from)
    if (!set) sets.set(from, (set = new Set()))
    set.add(to)
  }
  for (const { source, target } of links) {
    // A record is not its own connection.
    if (source === target) continue
    add(source, target)
    add(target, source)
  }
  return sets
}

/**
 * On the full map, while something is selected, hovering another record changes nothing.
 * With `hoverFirst` (the small map on a record's page, whose record is always selected) a
 * hover lights that record's connections instead; the selection keeps its growth and beacon.
 */
export function highlightState({
  hoveredId,
  selectedId,
  neighbours,
  hoverFirst = false,
}: {
  hoveredId: string | null
  selectedId: string | null
  neighbours: NeighbourSets
  hoverFirst?: boolean
}): HighlightState {
  const activeId = hoverFirst ? (hoveredId ?? selectedId) : (selectedId ?? hoveredId)
  if (activeId === null) return { activeId, mode: 'none', neighbours: NONE, hoveredId, selectedId }
  return {
    activeId,
    mode: activeId === selectedId ? 'selected' : 'hover',
    neighbours: neighbours.get(activeId) ?? NONE,
    hoveredId,
    selectedId,
  }
}

/**
 * How much bigger than its node size a record draws (prototype `applyScaleTransforms`,
 * user decision 2026-10-11). Unlike the looks, hovering grows a record even while another
 * is selected; the selected one keeps its own growth when the pointer is on it too.
 */
export const GROWTH = { selected: 1.35, hovered: 1.2, resting: 1 } as const

export function growthOf(state: HighlightState, id: string): number {
  if (id === state.selectedId) return GROWTH.selected
  if (id === state.hoveredId) return GROWTH.hovered
  return GROWTH.resting
}

export function roleOf(state: HighlightState, id: string): HighlightRole {
  if (id === state.activeId) return 'target'
  return state.neighbours.has(id) ? 'neighbour' : 'other'
}

export function nodeLook(state: HighlightState, id: string): NodeLook {
  if (state.mode === 'none') return 'resting'
  const role = roleOf(state, id)
  if (role !== 'other') return role
  return state.mode === 'selected' ? 'otherSelected' : 'otherHover'
}

export function linkLook(
  state: HighlightState,
  link: Pick<GraphLink, 'source' | 'target'>,
): LinkLook {
  if (state.mode === 'none') return 'resting'
  if (link.source === state.activeId || link.target === state.activeId) return 'lit'
  return state.mode === 'selected' ? 'fadedSelected' : 'fadedHover'
}

/** The map's status line: what is active and how many records it connects to. */
export function highlightSummary(state: HighlightState, name: string | undefined): string {
  if (state.mode === 'none' || name === undefined) {
    return 'Hover over or select a record to see its direct connections.'
  }
  const count = state.neighbours.size
  const verb = state.mode === 'selected' ? 'Selected' : 'Hovering'
  return `${verb}: ${name} · ${count} direct connection${count === 1 ? '' : 's'}`
}
