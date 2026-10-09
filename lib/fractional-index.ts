/**
 * Fractional indexing for Kanban ordering.
 *
 * Cards carry a float `position`. Inserting between two cards takes the midpoint,
 * so a move writes exactly one row instead of renumbering the column. Repeated
 * midpoints halve the gap, so once neighbours get closer than GAP_EPSILON the
 * column is renormalized back to STEP, 2*STEP, 3*STEP, ...
 */

export const STEP = 1000
export const GAP_EPSILON = 1e-4

export function positionBetween(before?: number | null, after?: number | null): number {
  if (before == null && after == null) return STEP
  if (before == null) return (after as number) - STEP
  if (after == null) return (before as number) + STEP
  return (before + after) / 2
}

/** True when any adjacent pair is too close to subdivide safely again. */
export function needsRenormalize(positions: number[]): boolean {
  const sorted = [...positions].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < GAP_EPSILON) return true
  }
  return false
}

/** Evenly spaced positions for `count` items, preserving their current order. */
export function renormalizedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * STEP)
}

/**
 * Resolves the position for dropping an item at `toIndex` within an ordered
 * column, excluding the dragged item itself from the neighbour lookup.
 */
export function positionForIndex(ordered: number[], toIndex: number): number {
  const before = toIndex > 0 ? ordered[toIndex - 1] : null
  const after = toIndex < ordered.length ? ordered[toIndex] : null
  return positionBetween(before, after)
}
