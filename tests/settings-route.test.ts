import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The settings row lives in memory: `stored` is what the database holds, and every
// upsert merges into it, as Prisma's would.
let stored: Record<string, unknown> = {}
const upsert = vi.fn(async ({ update }: { update: Record<string, unknown> }) => {
  stored = { ...stored, ...update }
  return stored
})
vi.mock('@/lib/db', () => ({
  prisma: {
    settings: {
      findUnique: async () => ({ agentAccess: stored.agentAccess }),
      upsert: (args: { update: Record<string, unknown> }) => upsert(args),
    },
  },
}))
const { PATCH } = await import('@/app/api/settings/route')

const BASE = 'http://127.0.0.1:3000'
/** What the app's own pages send with a save. */
const FROM_THE_APP = { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' }

const patch = (body: unknown, headers: Record<string, string> = {}) =>
  PATCH(
    new Request(BASE + '/api/settings', {
      method: 'PATCH',
      headers: { Host: '127.0.0.1:3000', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.stubEnv('KINSHIP_OWNER', 'tester')
  vi.stubEnv('KINSHIP_PORT', '')
  vi.stubEnv('KINSHIP_ALLOWED_ORIGINS', '')
  stored = { agentAccess: 'read', tagline: 'Before' }
  upsert.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('PATCH /api/settings — agent access', () => {
  it('changes agent access for a save from the app', async () => {
    const response = await patch({ agentAccess: 'write' }, FROM_THE_APP)
    expect(response.status).toBe(200)
    expect(stored.agentAccess).toBe('write')
  })

  it.each([
    ['no browser headers (curl)', {}],
    ['an Origin alone', { Origin: BASE }],
    ['Sec-Fetch-Site alone', { 'Sec-Fetch-Site': 'same-origin' }],
    [
      'a Referer instead of an Origin',
      { Referer: BASE + '/settings', 'Sec-Fetch-Site': 'same-origin' },
    ],
    ['another origin', { Origin: 'http://localhost:4444', 'Sec-Fetch-Site': 'same-origin' }],
  ])('refuses to change it with %s', async (_label, headers) => {
    const response = await patch({ agentAccess: 'write', tagline: 'After' }, headers)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Agent access can only be changed in the Kinship app.',
    })
    // Nothing in the request is written, not even the other fields.
    expect(upsert).not.toHaveBeenCalled()
    expect(stored).toEqual({ agentAccess: 'read', tagline: 'Before' })
  })

  it('accepts the current value from anywhere, so a whole-form save still works', async () => {
    const response = await patch({ agentAccess: 'read', tagline: 'After' })
    expect(response.status).toBe(200)
    expect(stored).toEqual({ agentAccess: 'read', tagline: 'After' })
  })

  it('leaves every other setting changeable from curl', async () => {
    const response = await patch({ tagline: 'From curl' })
    expect(response.status).toBe(200)
    expect(stored.tagline).toBe('From curl')
  })

  it('still answers an invalid value with 400, before looking at where it came from', async () => {
    expect((await patch({ agentAccess: 'admin' })).status).toBe(400)
  })
})
