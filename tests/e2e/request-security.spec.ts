import { createServer } from 'node:http'
import { test, expect, json, unique } from '../support/api'
import { BASE_URL } from '../support/stack'

test('a different local browser origin cannot create a contact or replace data @desktop', async ({
  page,
  request,
}) => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html><body>Unrelated local origin</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No local origin')
    await page.goto('http://127.0.0.1:' + address.port)
    const archive = async () => {
      const data = await json<Record<string, unknown>>(await request.get('/api/export'))
      return { ...data, exportedAt: undefined }
    }
    const before = await archive()
    const name = unique('Hostile browser contact')
    for (const [path, body] of [
      ['/api/contacts', JSON.stringify({ displayName: name })],
      [
        '/api/import?confirm=replace',
        JSON.stringify({ format: 'kb-archive', version: 1, data: {} }),
      ],
    ]) {
      const response = page.waitForResponse(
        (r) => r.url() === BASE_URL + path && r.request().method() === 'POST',
      )
      const type = await page.evaluate(
        async ({ url, body }) => {
          const res = await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body,
          })
          return res.type
        },
        { url: BASE_URL + path, body },
      )
      expect(type).toBe('opaque')
      expect((await response).status()).toBe(403)
    }
    expect(await archive()).toEqual(before)
    // Opaque fetch resolves at response headers; let its network work finish
    // before the foreign page and browser context are torn down.
    await page.waitForLoadState('networkidle')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
})
