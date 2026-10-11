import { describe, expect, it } from 'vitest'
import { mapHref, readMapFocus } from '@/lib/graph/deep-link'
import { m } from '@/lib/mobile/href'

const focusOf = (query: string) => readMapFocus(new URLSearchParams(query))

describe('readMapFocus', () => {
  it('finds no focus in a URL without one', () => {
    expect(focusOf('')).toEqual({ kind: 'none' })
    expect(focusOf('depth=2')).toEqual({ kind: 'none' })
  })

  it('reads a well-formed record id, decoded', () => {
    expect(focusOf('focus=contact:abc123')).toEqual({ kind: 'record', id: 'contact:abc123' })
    expect(focusOf('focus=task%3Ax%2Fy')).toEqual({ kind: 'record', id: 'task:x/y' })
    // The same value twice says the same thing.
    expect(focusOf('focus=tag:t1&focus=tag:t1')).toEqual({ kind: 'record', id: 'tag:t1' })
  })

  it.each([
    ['blank', 'focus='],
    ['no type', 'focus=abc123'],
    ['an unknown type', 'focus=person:abc123'],
    ['no id', 'focus=contact:'],
    ['spaces in the id', 'focus=contact:a%20b'],
    ['two different values', 'focus=contact:a&focus=contact:b'],
  ])('calls a focus with %s malformed', (_, query) => {
    expect(focusOf(query)).toEqual({ kind: 'malformed' })
  })
})

describe('mapHref', () => {
  it('is the bare map without a focus', () => {
    expect(mapHref()).toBe('/map')
    expect(mapHref('')).toBe('/map')
  })

  it('encodes the focus, and reads back as it went in', () => {
    const id = 'entry:a&b=c?#'
    const href = mapHref(id)
    expect(href).toBe('/map?focus=entry%3Aa%26b%3Dc%3F%23')
    expect(readMapFocus(new URL(href, 'http://x').searchParams)).toEqual({ kind: 'record', id })
  })

  it('goes to the phone map through m()', () => {
    expect(m(mapHref('contact:c1'))).toBe('/m/map?focus=contact%3Ac1')
  })
})
