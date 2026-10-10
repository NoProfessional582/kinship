import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { ConfigurationError } from '@/lib/errors'
import {
  OWNER_MISSING_MESSAGE,
  ownerSubject,
  requireConfiguredOwner,
  requireIdentity,
} from '@/lib/identity'
import { proxy } from '@/proxy'

const URL_ = 'http://localhost:3000/api/contacts'
let saved: string | undefined

beforeEach(() => {
  saved = process.env.KINSHIP_OWNER
})
afterEach(() => {
  if (saved === undefined) delete process.env.KINSHIP_OWNER
  else process.env.KINSHIP_OWNER = saved
})

describe('identity with KINSHIP_OWNER set', () => {
  it('resolves every request and CLI command to the owner', () => {
    process.env.KINSHIP_OWNER = 'me'
    expect(ownerSubject()).toBe('me')
    expect(requireIdentity(new Request(URL_)).subject).toBe('me')
    expect(requireConfiguredOwner()).toBe('me')
  })

  it('trims surrounding whitespace', () => {
    process.env.KINSHIP_OWNER = '  me  '
    expect(ownerSubject()).toBe('me')
  })

  it('ignores identity headers a client sends', () => {
    process.env.KINSHIP_OWNER = 'me'
    const claimed = new Request(URL_, {
      headers: {
        'X-Remote-User': 'someone-else',
        'Remote-User': 'intruder',
        'X-Forwarded-User': 'other',
      },
    })
    expect(requireIdentity(claimed).subject).toBe('me')
  })

  it('lets the proxy pass, independently of identity headers', () => {
    process.env.KINSHIP_OWNER = 'me'
    const res = proxy(
      new NextRequest(URL_, { headers: { Host: 'localhost:3000', 'Remote-User': 'intruder' } }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})

describe.each([
  ['missing', undefined],
  ['empty', ''],
  ['blank', '   '],
])('identity with KINSHIP_OWNER %s', (_label, value) => {
  beforeEach(() => {
    if (value === undefined) delete process.env.KINSHIP_OWNER
    else process.env.KINSHIP_OWNER = value
  })

  it('refuses with a clear message', () => {
    expect(() => ownerSubject()).toThrow(ConfigurationError)
    expect(() => ownerSubject()).toThrow(OWNER_MISSING_MESSAGE)
    expect(() => requireConfiguredOwner()).toThrow(OWNER_MISSING_MESSAGE)
  })

  it('does not fall back to an identity header', () => {
    const claimed = new Request(URL_, {
      headers: { 'X-Remote-User': 'someone', 'Remote-User': 'someone' },
    })
    expect(() => requireIdentity(claimed)).toThrow(OWNER_MISSING_MESSAGE)
  })

  it('makes the proxy refuse every request with the message', async () => {
    const res = proxy(new NextRequest(URL_, { headers: { 'X-Forwarded-User': 'someone' } }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: OWNER_MISSING_MESSAGE })
  })
})
