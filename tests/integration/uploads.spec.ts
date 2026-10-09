/**
 * POST /api/upload (contact photos) and GET /uploads/[name], which serves them back.
 *
 * Uploaded files have no route that deletes them; the few a run adds stay in the test
 * stack's uploads folder until the stack is removed.
 */
import { test, expect, json, refused } from '../support/api'
import { PNG_1PX } from '../support/files'

const STORED =
  /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/

// The start of a JPEG: the marker the upload route goes by.
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const file = (name: string, mimeType: string, buffer: Buffer) => ({
  multipart: { file: { name, mimeType, buffer } },
})

test('a photo is stored under a new name and served back as it was sent', async ({ request }) => {
  const { url } = await json<{ url: string }>(
    await request.post('/api/upload', file('me.png', 'image/png', PNG_1PX)),
  )
  expect(url).toMatch(STORED)
  expect(url).toMatch(/\.png$/)

  const served = await request.get(url)
  expect(served.status()).toBe(200)
  expect(served.headers()).toMatchObject({
    'content-type': 'image/png',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  expect(Buffer.compare(await served.body(), PNG_1PX)).toBe(0)
})

test('the stored type comes from the bytes, not from what the browser said', async ({
  request,
}) => {
  const { url } = await json<{ url: string }>(
    await request.post('/api/upload', file('photo.png', 'image/png', JPEG_START)),
  )
  expect(url).toMatch(/\.jpg$/)
  const served = await request.get(url)
  expect(served.headers()['content-type']).toBe('image/jpeg')
})

test.describe('refusals', () => {
  test('an upload must be a file', async ({ request }) => {
    await refused(
      await request.post('/api/upload', { multipart: { note: 'no file here' } }),
      400,
      'No file provided',
    )
    await refused(
      await request.post('/api/upload', { data: { file: 'me.png' } }),
      400,
      'Could not read the upload',
    )
  })

  test('only images are taken, judged by their bytes', async ({ request }) => {
    await refused(
      await request.post('/api/upload', file('notes.txt', 'text/plain', Buffer.from('hello'))),
      415,
      'Unsupported type: text/plain',
    )
    await refused(
      await request.post(
        '/api/upload',
        file('page.png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>')),
      ),
      415,
      'That file is not one of: image/png, image/jpeg, image/gif, image/webp',
    )
  })

  test('a photo over 5 MB, or a body over 6 MB, is too large', async ({ request }) => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(5.5 * 1024 * 1024)])
    await refused(
      await request.post('/api/upload', file('big.png', 'image/png', big)),
      413,
      'File exceeds 5 MB',
    )
    const huge = Buffer.concat([PNG_1PX, Buffer.alloc(7 * 1024 * 1024)])
    await refused(
      await request.post('/api/upload', file('huge.png', 'image/png', huge)),
      413,
      'Request body too large. The maximum is 6 MB.',
    )
  })

  test('/uploads serves only names the app made, never a path', async ({ request }) => {
    for (const name of [
      '..%2F..%2Fetc%2Fpasswd',
      '%2Fetc%2Fpasswd',
      '..%2Fpackage.json',
      '..%5C..%5Cpackage.json',
      'server.js',
      // The shape of a stored name, but no such file, or not an image extension.
      '00000000-0000-4000-8000-000000000000.png',
      '00000000-0000-4000-8000-000000000000.txt',
    ]) {
      await refused(await request.get(`/uploads/${name}`), 404, 'Not found')
    }
  })
})
