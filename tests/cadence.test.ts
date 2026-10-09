import { describe, expect, it } from 'vitest'
import { CADENCE_DAYS, CADENCE_LABEL, TIER_LABEL, cadenceHealth } from '@/lib/cadence'

const NOW = new Date('2026-08-21T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('cadenceHealth', () => {
  it('is untracked when no cadence is set', () => {
    const h = cadenceHealth('NONE', daysAgo(400), NOW)
    expect(h.state).toBe('untracked')
    expect(h.dueInDays).toBeNull()
  })

  it('flags someone never contacted', () => {
    expect(cadenceHealth('MONTHLY', null, NOW).state).toBe('never')
  })

  it('is on track well inside the window', () => {
    const h = cadenceHealth('MONTHLY', daysAgo(3), NOW)
    expect(h.state).toBe('ontrack')
    expect(h.dueInDays).toBe(27)
  })

  it('warns in the week before the window closes', () => {
    // Nudge before the relationship goes quiet, not after.
    expect(cadenceHealth('BIWEEKLY', daysAgo(12), NOW).state).toBe('due')
    expect(cadenceHealth('BIWEEKLY', daysAgo(6), NOW).state).toBe('ontrack')
  })

  it('goes overdue once the window has passed', () => {
    const h = cadenceHealth('WEEKLY', daysAgo(23), NOW)
    expect(h.state).toBe('overdue')
    expect(h.dueInDays).toBe(-16)
    expect(h.daysSince).toBe(23)
  })

  it('scales the window with the cadence', () => {
    // The same 60-day gap is overdue monthly but fine quarterly.
    expect(cadenceHealth('MONTHLY', daysAgo(60), NOW).state).toBe('overdue')
    expect(cadenceHealth('QUARTERLY', daysAgo(60), NOW).state).toBe('ontrack')
  })

  it('treats the boundary day as due rather than overdue', () => {
    expect(cadenceHealth('WEEKLY', daysAgo(7), NOW).dueInDays).toBe(0)
    expect(cadenceHealth('WEEKLY', daysAgo(7), NOW).state).toBe('due')
  })
})

describe('cadence and tier tables', () => {
  it('gives every cadence a window except NONE', () => {
    for (const [k, v] of Object.entries(CADENCE_DAYS)) {
      if (k === 'NONE') expect(v).toBeNull()
      else expect(v).toBeGreaterThan(0)
    }
  })

  it('labels every cadence and tier', () => {
    expect(Object.keys(CADENCE_LABEL)).toHaveLength(Object.keys(CADENCE_DAYS).length)
    expect(Object.values(TIER_LABEL)).toEqual(['Inner circle', 'Close', 'Active', 'Peripheral'])
  })
})
