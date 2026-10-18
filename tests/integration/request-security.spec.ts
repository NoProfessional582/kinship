import { test, expect, json, refused, newContact } from '../support/api'
import { BASE_URL } from '../support/stack'

test('foreign origins cannot mutate any write route', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup)
  const archive = async () => {
    const body = await json<Record<string, unknown>>(await request.get('/api/export'))
    return { ...body, exportedAt: undefined }
  }
  const before = await archive()
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of [
      '/api/contacts',
      '/api/tasks',
      '/api/projects',
      '/api/entries',
      '/api/columns',
      '/api/edges',
      '/api/trash',
      '/api/settings',
      '/api/calendar',
      '/api/contacts/' + contact.id,
      '/api/contacts/' + contact.id + '/attributes',
      '/api/columns/reorder',
      '/api/tasks/unknown/move',
      '/api/edges/unknown',
    ]) {
      await refused(
        await request.fetch(path, {
          method,
          headers: { Origin: 'http://127.0.0.1:4444' },
          data: {},
        }),
        403,
        'Request origin is not allowed.',
      )
    }
  }
  for (const Origin of ['null', 'bad origin', new URL(BASE_URL).origin + '/page']) {
    await refused(
      await request.post('/api/contacts', {
        headers: { Origin },
        data: { displayName: 'Refused contact' },
      }),
      403,
      'Request origin is not allowed.',
    )
  }
  await refused(
    await request.post('/api/import?confirm=replace', {
      headers: { Origin: 'http://127.0.0.1:4444', 'Content-Type': 'text/plain' },
      data: JSON.stringify({ format: 'kb-archive', version: 1, data: {} }),
    }),
    403,
    'Request origin is not allowed.',
  )
  expect(await archive()).toEqual(before)
})

test('JSON routes refuse simple media types without changing data', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  for (const path of ['/api/contacts', '/api/import?confirm=replace']) {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      await refused(
        await request.post(path, {
          headers: { 'Content-Type': type },
          data: '{"displayName":"Refused"}',
        }),
        415,
        'Content-Type must be application/json.',
      )
    }
  }
  const row = await json<{ contact: { displayName: string } }>(
    await request.get('/api/contacts/' + contact.id),
  )
  expect(row.contact.displayName).toBe(contact.displayName)
})

test('host validation protects exports and custom public ports work', async ({
  request,
  cleanup,
}) => {
  for (const path of [
    '/api/export',
    '/contacts',
    '/_next/image?url=' + encodeURIComponent('/icons/192') + '&w=64&q=75',
  ]) {
    await refused(
      await request.get(path, {
        headers: { Host: 'attacker.example:3000', 'X-Forwarded-Host': new URL(BASE_URL).host },
      }),
      403,
      'Request host is not allowed.',
    )
    await refused(
      await request.get(path, { headers: { Host: '127.0.0.1:3000' } }),
      403,
      'Request host is not allowed.',
    )
  }
  for (const Host of ['localhost:43123', '127.0.0.1:43123']) {
    const contact = await json<{ id: string }>(
      await request.post('/api/contacts', {
        headers: {
          Host,
          Origin: 'http://' + Host,
          'Content-Type': 'application/json; charset=utf-8',
        },
        data: { displayName: 'Allowed custom port ' + Host },
      }),
    )
    cleanup.record('contact', contact.id)
    expect((await request.get('/api/export', { headers: { Host } })).status()).toBe(200)
  }
  expect((await request.get('/api/health', { headers: { Host: '127.0.0.1:3000' } })).status()).toBe(
    200,
  )
  await refused(
    await request.post('/api/health', { headers: { Host: '127.0.0.1:3000' }, data: {} }),
    403,
    'Request host is not allowed.',
  )
})

test('same-origin saves and CLI work while contradictory provenance fails', async ({
  request,
  cleanup,
}) => {
  const allowedHeaders: Record<string, string>[] = [
    {},
    { Origin: new URL(BASE_URL).origin, 'Sec-Fetch-Site': 'same-origin' },
    { Referer: BASE_URL + '/contacts' },
  ]
  for (const headers of allowedHeaders) {
    const contact = await json<{ id: string }>(
      await request.post('/api/contacts', {
        headers,
        data: { displayName: 'Allowed request' },
      }),
    )
    cleanup.record('contact', contact.id)
  }
  const deniedHeaders: Record<string, string>[] = [
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
    { 'Sec-Fetch-Mode': 'navigate' },
    { Referer: 'https://attacker.example/' },
  ]
  for (const headers of deniedHeaders) {
    await refused(
      await request.patch('/api/settings', {
        headers,
        data: { appTitle: 'Refused setting' },
      }),
      403,
      'Request origin is not allowed.',
    )
  }
})
