/**
 * Links that open the map on one record: `/map?focus=<type>:<id>` (or `/m/map?focus=…` on
 * a phone). Pure, like focus.ts. Only the link is read here; whether the record is on the
 * map is up to the map, once it has loaded.
 */
import { parseGraphId } from './focus'

export const MAP_PATH = '/map'

/**
 * What a map URL asks to focus on: nothing, a well-formed graph id, or something that is
 * not one (blank, an unknown type, `focus` given twice with different values).
 */
export type MapFocus = { kind: 'none' } | { kind: 'record'; id: string } | { kind: 'malformed' }

export function readMapFocus(params: Pick<URLSearchParams, 'getAll'>): MapFocus {
  const values = [...new Set(params.getAll('focus'))]
  if (values.length === 0) return { kind: 'none' }
  if (values.length > 1) return { kind: 'malformed' }
  const focus = parseGraphId(values[0])
  return focus === null ? { kind: 'malformed' } : { kind: 'record', id: focus.id }
}

/** The desktop map, opened on `focusId` when given; a phone page passes it through m(). */
export function mapHref(focusId?: string): string {
  if (!focusId) return MAP_PATH
  return `${MAP_PATH}?${new URLSearchParams({ focus: focusId })}`
}
