/**
 * /api/settings: the owner's one row of preferences. Every test puts back what it changed,
 * because the browser tests read these settings too. Weather is never turned on (the
 * stack's network has no way out).
 */
import { test, expect, json, invalid, unique } from '../support/api'
import type { APIRequestContext } from '@playwright/test'

interface Settings {
  timezone: string | null
  userName: string
  appTitle: string
  tagline: string
  weatherEnabled: boolean
  weatherLocation: string
  weatherUnit: string
  calendarWeekStart: string
  fontScale: number
  defaultCadence: string
}

const read = async (request: APIRequestContext) =>
  json<Settings>(await request.get('/api/settings'))

const save = (request: APIRequestContext, data: Partial<Settings>) =>
  request.patch('/api/settings', { data })

test.beforeEach(async ({ request, cleanup }) => {
  const before: Partial<Settings> = { ...(await read(request)) }
  delete before.weatherEnabled
  cleanup.add('put the settings back', async () => json(await save(request, before)))
})

test('a save changes what it is sent and keeps the rest', async ({ request }) => {
  const before = await read(request)
  const userName = unique('Tester')
  const weekStart = before.calendarWeekStart === 'monday' ? 'sunday' : 'monday'
  const saved = await json<Settings>(
    await save(request, {
      userName,
      calendarWeekStart: weekStart,
      fontScale: 1.12,
      timezone: 'Europe/Oslo',
      defaultCadence: 'QUARTERLY',
    }),
  )
  expect(saved).toEqual({
    ...before,
    userName,
    calendarWeekStart: weekStart,
    fontScale: 1.12,
    timezone: 'Europe/Oslo',
    defaultCadence: 'QUARTERLY',
  })
  expect(await read(request)).toEqual(saved)

  // One field alone leaves the others as they are.
  const tagline = unique('Tagline')
  expect(await json<Settings>(await save(request, { tagline }))).toEqual({ ...saved, tagline })
})

test('a null time zone means "follow the browser"', async ({ request }) => {
  await json(await save(request, { timezone: 'Asia/Tokyo' }))
  expect((await json<Settings>(await save(request, { timezone: null }))).timezone).toBeNull()
  expect((await read(request)).timezone).toBeNull()
})

test.describe('refusals', () => {
  test('unknown zones, sizes, days, units and cadences are refused', async ({ request }) => {
    await invalid(
      await save(request, { timezone: 'Mars/Olympus_Mons' }),
      'timezone',
      'Not a recognised IANA timezone',
    )
    await invalid(await save(request, { fontScale: 2 }), 'fontScale')
    await invalid(await save(request, { calendarWeekStart: 'friday' }), 'calendarWeekStart')
    await invalid(await save(request, { weatherUnit: 'kelvin' }), 'weatherUnit')
    await invalid(await save(request, { defaultCadence: 'HOURLY' }), 'defaultCadence')
    await invalid(await save(request, { userName: 'x'.repeat(81) }), 'userName')
  })
})
