/** Which records and links the map lights up for a hover or a selection (lib/graph/highlight.ts). */
import { describe, expect, it } from 'vitest'
import type { GraphLink } from '@/lib/graph/constants'
import {
  LINK_LOOKS,
  NODE_LOOKS,
  highlightState,
  highlightSummary,
  linkLook,
  neighbourSets,
  nodeLook,
  nodeLookValues,
  roleOf,
} from '@/lib/graph/highlight'
import { SCENE_STYLE } from '@/lib/graph/scene'

const link = (source: string, target: string, relation = 'mentions'): GraphLink => ({
  id: `${source}>${target}>${relation}`,
  source,
  target,
  relation,
  origins: ['Mention'],
})

const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort()

describe('neighbourSets', () => {
  it('is empty for a graph with no links', () => {
    expect(neighbourSets([]).size).toBe(0)
  })

  it('counts a link either way round, once, however often it repeats', () => {
    const sets = neighbourSets([
      link('a', 'b'),
      link('b', 'a', 'mentioned by'),
      link('a', 'b', 'references'),
      link('a', 'c'),
    ])
    expect(sorted(sets.get('a'))).toEqual(['b', 'c'])
    expect(sorted(sets.get('b'))).toEqual(['a'])
    expect(sorted(sets.get('c'))).toEqual(['a'])
  })

  it('does not make a record its own connection', () => {
    const sets = neighbourSets([link('a', 'a'), link('a', 'b')])
    expect(sorted(sets.get('a'))).toEqual(['b'])
    expect(neighbourSets([link('a', 'a')]).has('a')).toBe(false)
  })
})

describe('highlightState', () => {
  const neighbours = neighbourSets([link('a', 'b'), link('b', 'c'), link('d', 'a')])

  it('is at rest with nothing hovered or selected', () => {
    const state = highlightState({ hoveredId: null, selectedId: null, neighbours })
    expect(state.activeId).toBeNull()
    expect(state.mode).toBe('none')
    expect(state.neighbours.size).toBe(0)
    expect(nodeLook(state, 'a')).toBe('resting')
    expect(linkLook(state, link('a', 'b'))).toBe('resting')
  })

  it('lights a hovered record and its direct connections, and dims the rest', () => {
    const state = highlightState({ hoveredId: 'a', selectedId: null, neighbours })
    expect(state).toMatchObject({ activeId: 'a', mode: 'hover' })
    expect(roleOf(state, 'a')).toBe('target')
    expect(roleOf(state, 'b')).toBe('neighbour')
    expect(roleOf(state, 'd')).toBe('neighbour')
    expect(roleOf(state, 'c')).toBe('other')
    expect(nodeLook(state, 'a')).toBe('target')
    expect(nodeLook(state, 'b')).toBe('neighbour')
    expect(nodeLook(state, 'c')).toBe('otherHover')
    expect(linkLook(state, link('d', 'a'))).toBe('lit')
    expect(linkLook(state, link('b', 'c'))).toBe('fadedHover')
  })

  it('keeps the selection lit while another record is hovered', () => {
    const state = highlightState({ hoveredId: 'c', selectedId: 'a', neighbours })
    expect(state).toMatchObject({ activeId: 'a', mode: 'selected' })
    expect(nodeLook(state, 'a')).toBe('target')
    expect(nodeLook(state, 'c')).toBe('otherSelected')
    expect(linkLook(state, link('a', 'b'))).toBe('lit')
    expect(linkLook(state, link('b', 'c'))).toBe('fadedSelected')
  })

  it('handles a record with no connections', () => {
    const state = highlightState({ hoveredId: null, selectedId: 'lone', neighbours })
    expect(state.neighbours.size).toBe(0)
    expect(nodeLook(state, 'lone')).toBe('target')
    expect(nodeLook(state, 'a')).toBe('otherSelected')
  })
})

describe('the looks', () => {
  it('carry the approved values', () => {
    expect(NODE_LOOKS.target).toMatchObject({ orbOpacity: 1, orbEmissive: 0.7, labelOpacity: 1 })
    expect(NODE_LOOKS.otherHover).toMatchObject({ orbOpacity: 0.35, auraOpacity: 0.15 })
    expect(NODE_LOOKS.otherSelected).toMatchObject({ orbOpacity: 0.12, labelOpacity: 0.1 })
    expect(LINK_LOOKS.lit).toEqual({ color: '#a5b4fc', opacity: 1 })
    expect(LINK_LOOKS.fadedHover).toEqual({ color: '#404854', opacity: 0.2 })
    expect(LINK_LOOKS.fadedSelected).toEqual({ color: '#404854', opacity: 0.04 })
  })

  it('rest exactly as the scene is built', () => {
    const { orb, aura, label, conduit } = SCENE_STYLE
    expect(NODE_LOOKS.resting).toMatchObject({
      orbOpacity: orb.opacity,
      orbEmissive: orb.emissive,
      labelOpacity: label.opacity,
      auraOpacity: aura.opacity,
    })
    expect(LINK_LOOKS.resting).toEqual({ color: conduit.color, opacity: conduit.opacity })
  })

  it('scale radiance and aura with glow, the aura up to 1; dimmed looks do not glow', () => {
    expect(nodeLookValues('target', 2)).toEqual({
      orbOpacity: 1,
      orbEmissive: 1.4,
      labelOpacity: 1,
      auraOpacity: 1,
    })
    expect(nodeLookValues('resting', 0.5).auraOpacity).toBeCloseTo(0.35)
    expect(nodeLookValues('otherHover', 2)).toEqual({
      orbOpacity: 0.35,
      orbEmissive: 0.08,
      labelOpacity: 0.3,
      auraOpacity: 0.15,
    })
  })
})

describe('highlightSummary', () => {
  const neighbours = neighbourSets([link('a', 'b'), link('a', 'c')])

  it('gives the hint when nothing is active', () => {
    const state = highlightState({ hoveredId: null, selectedId: null, neighbours })
    expect(highlightSummary(state, undefined)).toMatch(/^Hover over or select a record/)
  })

  it('names the active record and counts its connections', () => {
    const selected = highlightState({ hoveredId: null, selectedId: 'a', neighbours })
    expect(highlightSummary(selected, 'Maya Lin')).toBe('Selected: Maya Lin · 2 direct connections')
    const hovered = highlightState({ hoveredId: 'b', selectedId: null, neighbours })
    expect(highlightSummary(hovered, 'Kiln')).toBe('Hovering: Kiln · 1 direct connection')
  })
})
