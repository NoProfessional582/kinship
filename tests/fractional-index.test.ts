import { describe, expect, it } from 'vitest'
import {
  STEP,
  GAP_EPSILON,
  positionBetween,
  positionForIndex,
  needsRenormalize,
  renormalizedPositions,
} from '@/lib/fractional-index'

describe('positionBetween', () => {
  it('seeds an empty column at STEP', () => {
    expect(positionBetween(null, null)).toBe(STEP)
  })

  it('prepends below the first card', () => {
    expect(positionBetween(null, 1000)).toBe(0)
  })

  it('appends above the last card', () => {
    expect(positionBetween(3000, null)).toBe(4000)
  })

  it('takes the midpoint between neighbours', () => {
    expect(positionBetween(2000, 3000)).toBe(2500)
  })

  it('stays strictly between its neighbours under repeated subdivision', () => {
    let before = 0
    const after = 1000
    for (let i = 0; i < 20; i++) {
      const p = positionBetween(before, after)
      expect(p).toBeGreaterThan(before)
      expect(p).toBeLessThan(after)
      before = p
    }
  })
})

describe('positionForIndex', () => {
  const ordered = [1000, 2000, 3000]

  it('drops at the head', () => expect(positionForIndex(ordered, 0)).toBe(0))
  it('drops in the middle', () => expect(positionForIndex(ordered, 1)).toBe(1500))
  it('drops at the tail', () => expect(positionForIndex(ordered, 3)).toBe(4000))
  it('handles an empty column', () => expect(positionForIndex([], 0)).toBe(STEP))
})

describe('renormalization', () => {
  it('is not triggered by comfortable gaps', () => {
    expect(needsRenormalize([1000, 2000, 3000])).toBe(false)
  })

  it('is triggered by a collapsed gap', () => {
    expect(needsRenormalize([1000, 1000 + GAP_EPSILON / 2, 2000])).toBe(true)
  })

  it('is triggered by exact ties, which seeded data can produce', () => {
    expect(needsRenormalize([2000, 2000])).toBe(true)
  })

  it('ignores input ordering', () => {
    expect(needsRenormalize([3000, 1000, 2000])).toBe(false)
  })

  it('respaces evenly and strictly increasing', () => {
    const fresh = renormalizedPositions(4)
    expect(fresh).toEqual([1000, 2000, 3000, 4000])
    expect(needsRenormalize(fresh)).toBe(false)
  })

  it('recovers a column that subdivided to the epsilon', () => {
    let before = 1000
    const after = 1000 + GAP_EPSILON
    const squeezed = [before, positionBetween(before, after), after]
    expect(needsRenormalize(squeezed)).toBe(true)
    expect(needsRenormalize(renormalizedPositions(squeezed.length))).toBe(false)
  })
})
