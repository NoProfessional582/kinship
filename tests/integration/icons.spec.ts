/**
 * /icons/[size]: the home-screen icons the web app manifest lists, drawn at request time
 * (next/og, the path decision 8 patched).
 */
import { test, expect } from '../support/api'
import { pngSize } from '../support/files'

interface Manifest {
  start_url: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

test('every icon the manifest lists is a PNG of its stated size', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.status()).toBe(200)
  const { start_url, icons } = (await manifest.json()) as Manifest
  expect(start_url).toBe('/m')
  expect(icons.map((i) => [i.src, i.purpose])).toEqual([
    ['/icons/192', 'any'],
    ['/icons/512', 'any'],
    ['/icons/512-maskable', 'maskable'],
  ])

  for (const icon of icons) {
    const response = await request.get(icon.src)
    expect(response.status(), icon.src).toBe(200)
    expect(response.headers()['content-type']).toBe('image/png')
    const { width, height } = pngSize(await response.body())
    expect(`${width}x${height}`, icon.src).toBe(icon.sizes)
  }
})

test('the desktop manifest starts at / and shares the icons', async ({ request }) => {
  const [mobile, desktop] = await Promise.all([
    request.get('/manifest.webmanifest').then((r) => r.json()),
    request.get('/desktop.webmanifest').then((r) => r.json()),
  ])
  expect(desktop).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' })
  expect(desktop.orientation).toBeUndefined()
  expect(desktop.icons).toEqual(mobile.icons)
})

// The route answers images, so its refusal is plain text rather than JSON.
test('a size that is not a number from 1 to 1024 is refused', async ({ request }) => {
  for (const size of ['abc', '0', '1025']) {
    const response = await request.get(`/icons/${size}`)
    expect(response.status(), size).toBe(400)
    expect(await response.text()).toBe('Bad size')
  }
})
