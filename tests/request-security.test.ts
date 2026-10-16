import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { allowedOrigins, requestRefusal } from '@/lib/request-security'
import { proxy } from '@/proxy'

const BASE = 'http://127.0.0.1:3000'
function request(method = 'POST', headers: Record<string, string> = {}, path = '/api/contacts') {
  return new Request(BASE + path, {
    method,
    headers: { Host: '127.0.0.1:3000', 'Content-Type': 'application/json', ...headers },
  })
}
beforeEach(() => {
  vi.stubEnv('KINSHIP_OWNER', 'tester')
  vi.stubEnv('KINSHIP_PORT', '')
  vi.stubEnv('KINSHIP_ALLOWED_ORIGINS', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('local request policy', () => {
  it('preserves browser saves and provenance-free CLI requests', () => {
    expect(
      requestRefusal(request('POST', { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' })),
    ).toBeNull()
    expect(requestRefusal(request())).toBeNull()
    expect(requestRefusal(request('POST', { Referer: BASE + '/contacts' }))).toBeNull()
    expect(requestRefusal(request('POST', { 'Sec-Fetch-Site': 'same-origin' }))).toBeNull()
  })

  it.each([
    'https://attacker.example',
    'null',
    'bad origin',
    BASE + '/',
    BASE + '/page',
    'http://localhost:3000',
    'http://127.0.0.1:4444',
    'https://127.0.0.1:3000',
    'http://user:pass@127.0.0.1:3000',
  ])('rejects the source Origin %s', (Origin) => {
    expect(requestRefusal(request('POST', { Origin }))?.status).toBe(403)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('protects the unsafe method %s', (method) => {
    expect(requestRefusal(request(method, { Origin: 'http://localhost:4444' }))?.status).toBe(403)
  })

  it.each(['cross-site', 'same-site', 'none', 'invalid'])('rejects browser site %s', (site) => {
    expect(requestRefusal(request('POST', { 'Sec-Fetch-Site': site }))?.status).toBe(403)
    expect(requestRefusal(request('POST', { Origin: BASE, 'Sec-Fetch-Site': site }))?.status).toBe(
      403,
    )
  })

  it.each(['Sec-Fetch-Mode', 'Sec-Fetch-Dest', 'Sec-Fetch-User'])(
    'does not mistake incomplete browser provenance for CLI (%s)',
    (header) => {
      expect(requestRefusal(request('POST', { [header]: 'navigate' }))?.status).toBe(403)
    },
  )

  it("lets Node's fetch reach /api/mcp, and only there, with nothing else browser-like", () => {
    const node = { 'Sec-Fetch-Mode': 'cors' }
    expect(requestRefusal(request('POST', node, '/api/mcp'))).toBeNull()
    expect(requestRefusal(request('POST', node))?.status).toBe(403)
    for (const extra of <Record<string, string>[]>[
      { 'Sec-Fetch-Mode': 'navigate' },
      { 'Sec-Fetch-Dest': 'empty' },
      { 'Sec-Fetch-User': '?1' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://127.0.0.1:4444' },
      { Referer: 'http://127.0.0.1:4444/page' },
    ]) {
      expect(requestRefusal(request('POST', { ...node, ...extra }, '/api/mcp'))?.status).toBe(403)
    }
    expect(
      requestRefusal(request('POST', { ...node, 'Content-Type': 'text/plain' }, '/api/mcp'))
        ?.status,
    ).toBe(415)
  })

  it('rejects foreign and malformed Referers, even with a matching Origin', () => {
    for (const Referer of [
      'https://attacker.example/page',
      'null',
      'invalid',
      'http://user@127.0.0.1:3000/page',
    ]) {
      expect(requestRefusal(request('PATCH', { Referer }))?.status).toBe(403)
      expect(requestRefusal(request('PATCH', { Referer, Origin: BASE }))?.status).toBe(403)
    }
  })

  it.each([
    'attacker.example:3000',
    '127.0.0.1:4444',
    'localhost.evil:3000',
    'user@127.0.0.1:3000',
    '127.0.0.1:3000/path',
    '127.0.0.1:3000,attacker.example',
  ])('rejects private reads through Host %s', (Host) => {
    for (const path of ['/api/export', '/uploads/avatar.png', '/contacts']) {
      expect(requestRefusal(request('GET', { Host }, path))?.status).toBe(403)
    }
  })

  it('requires Host and ignores forwarded headers', () => {
    const r = request('GET')
    r.headers.delete('host')
    expect(requestRefusal(r)?.status).toBe(403)
    expect(
      requestRefusal(
        request('GET', {
          Host: 'attacker.example',
          'X-Forwarded-Host': '127.0.0.1:3000',
          'X-Forwarded-Proto': 'http',
          Forwarded: 'host=127.0.0.1:3000',
        }),
      )?.status,
    ).toBe(403)
    expect(requestRefusal(request('GET', { 'X-Forwarded-Host': 'attacker.example' }))).toBeNull()
  })

  it('allows bodyless DELETE/OPTIONS and direct export reads', () => {
    for (const method of ['DELETE', 'OPTIONS', 'GET', 'HEAD']) {
      expect(requestRefusal(request(method, { 'Content-Type': '' }))).toBeNull()
    }
  })

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])(
    'rejects the JSON media type %s',
    (type) => {
      expect(requestRefusal(request('POST', { 'Content-Type': type }))?.status).toBe(415)
    },
  )

  it('accepts JSON charset and applies provenance to multipart uploads', () => {
    expect(
      requestRefusal(request('PATCH', { 'Content-Type': 'application/json; charset=utf-8' })),
    ).toBeNull()
    expect(
      requestRefusal(
        request('POST', { 'Content-Type': 'multipart/form-data; boundary=test' }, '/api/upload'),
      ),
    ).toBeNull()
    expect(
      requestRefusal(
        request(
          'POST',
          {
            'Content-Type': 'multipart/form-data; boundary=test',
            Origin: 'http://localhost:4444',
          },
          '/api/upload',
        ),
      )?.status,
    ).toBe(403)
    expect(requestRefusal(request('POST', {}, '/api/upload'))?.status).toBe(415)
  })

  it('handles non-default public ports, local aliases and internal health narrowly', () => {
    vi.stubEnv('KINSHIP_PORT', '43123')
    expect(requestRefusal(request('GET'))?.status).toBe(403)
    for (const host of ['localhost:43123', '127.0.0.1:43123']) {
      expect(requestRefusal(request('POST', { Host: host, Origin: 'http://' + host }))).toBeNull()
    }
    expect(requestRefusal(request('GET', {}, '/api/health'))).toBeNull()
    expect(requestRefusal(request('POST', {}, '/api/health'))?.status).toBe(403)
    expect(requestRefusal(request('GET', {}, '/api/export'))?.status).toBe(403)
  })

  it('uses only explicitly configured test origins', () => {
    vi.stubEnv('KINSHIP_ALLOWED_ORIGINS', 'http://web:3000')
    expect(
      requestRefusal(request('POST', { Host: 'web:3000', Origin: 'http://web:3000' })),
    ).toBeNull()
    expect(requestRefusal(request('GET'))?.status).toBe(403)
    expect(requestRefusal(request('GET', {}, '/api/health'))).toBeNull()
  })

  it.each([
    'https://web:3000',
    '*',
    'http://*.example',
    'http://web:3000/path',
    'http://user@web:3000',
    'http://web:3000?query=1',
    'http://web:3000,',
  ])('fails closed on invalid origin configuration %s', (value) => {
    vi.stubEnv('KINSHIP_ALLOWED_ORIGINS', value)
    expect(() => allowedOrigins()).toThrow('exact HTTP origins')
    expect(proxy(new NextRequest(BASE, { headers: { Host: '127.0.0.1:3000' } })).status).toBe(500)
  })

  it.each(['0', '65536', 'port', '3000/path'])('rejects invalid public port %s', (value) => {
    vi.stubEnv('KINSHIP_PORT', value)
    expect(() => allowedOrigins()).toThrow('port between')
  })
})
