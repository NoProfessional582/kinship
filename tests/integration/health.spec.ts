/**
 * The health check compose waits on, and the weather lookup, which is off by default and
 * stays off: it is the one feature that reaches outside the machine, and the test stack's
 * network has no way out.
 */
import { test, expect, json } from '../support/api'

test('GET /api/health: the server and the database answer', async ({ request }) => {
  expect(await json(await request.get('/api/health'))).toEqual({ ok: true })
})

test('GET /api/weather: off by default, so nothing is looked up', async ({ request }) => {
  expect(await json(await request.get('/api/weather'))).toEqual({ enabled: false })
  const settings = await json<{ weatherEnabled: boolean }>(await request.get('/api/settings'))
  expect(settings.weatherEnabled).toBe(false)
})
