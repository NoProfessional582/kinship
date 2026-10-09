/**
 * Pure cadence and tier logic — no database import, so client components can
 * use the labels and health calculation without dragging `pg` into the browser
 * bundle. The query that reads contacts lives in ./services/cadence.
 */

export type Cadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL' | 'NONE'

/** Intended gap between check-ins, in days. NONE opts a contact out entirely. */
export const CADENCE_DAYS: Record<Cadence, number | null> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 91,
  BIANNUAL: 182,
  ANNUAL: 365,
  NONE: null,
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  BIANNUAL: 'Twice a year',
  ANNUAL: 'Yearly',
  NONE: 'No cadence',
}

export const TIER_LABEL = {
  TIER_1: 'Inner circle',
  TIER_2: 'Close',
  TIER_3: 'Active',
  TIER_4: 'Peripheral',
} as const

export interface CadenceHealth {
  cadence: Cadence
  daysSince: number | null
  dueInDays: number | null
  state: 'ontrack' | 'due' | 'overdue' | 'never' | 'untracked'
}

const DAY = 86_400_000

/**
 * How a contact stands against their intended rhythm.
 *
 * `due` covers the week before the cadence elapses, so the dashboard can nudge
 * before the relationship has actually gone quiet rather than only after.
 */
export function cadenceHealth(
  cadence: Cadence,
  lastContactAt: Date | string | null | undefined,
  now: Date = new Date(),
): CadenceHealth {
  const window = CADENCE_DAYS[cadence]
  if (window == null) return { cadence, daysSince: null, dueInDays: null, state: 'untracked' }
  if (!lastContactAt) return { cadence, daysSince: null, dueInDays: null, state: 'never' }

  const last = lastContactAt instanceof Date ? lastContactAt : new Date(lastContactAt)
  const daysSince = Math.floor((now.getTime() - last.getTime()) / DAY)
  const dueInDays = window - daysSince
  const state = dueInDays < 0 ? 'overdue' : dueInDays <= 7 ? 'due' : 'ontrack'
  return { cadence, daysSince, dueInDays, state }
}
