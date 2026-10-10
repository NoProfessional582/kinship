/**
 * /api/search (the command palette) and /api/search/mentions (the @ and [[ menus in the
 * editor). Every record here carries this run's id as a word nothing else has.
 */
import {
  test,
  expect,
  json,
  invalid,
  RUN,
  newContact,
  newEntry,
  newProject,
  newTask,
  doc,
  paragraph,
  text,
} from '../support/api'

interface Hit {
  id: string
  kind: string
  title: string
  snippet: string | null
  href: string
}

interface Suggestion {
  id: string
  label: string
  kind: string
  sublabel: string | null
}

// A made-up word, so full-text search has exactly one thing to find per record.
const WORD = `quillon${RUN}`

test('search finds contacts, notes, tasks and projects, each with its page', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup, {
    displayName: `Wren ${WORD}`,
    jobTitle: 'Cartographer',
  })
  const { entry } = await newEntry(request, cleanup, {
    title: 'Planning call',
    bodyJson: doc(paragraph(text(`We talked about the ${WORD} survey.`))),
  })
  const task = await newTask(request, cleanup, { title: `Order ${WORD} maps` })
  const project = await newProject(request, cleanup, { name: `Atlas ${WORD}` })

  const hits = await json<Hit[]>(await request.get(`/api/search?q=${WORD}`))
  const byId = new Map(hits.map((h) => [h.id, h]))
  expect(byId.get(contact.id)).toMatchObject({
    kind: 'contact',
    title: contact.displayName,
    snippet: 'Cartographer',
    href: `/contacts/${contact.slug}`,
  })
  expect(byId.get(entry.id)).toMatchObject({
    kind: 'entry',
    title: 'Planning call',
    href: `/notes/${entry.id}`,
  })
  expect(byId.get(entry.id)!.snippet).toContain(WORD)
  expect(byId.get(task.id)).toMatchObject({ kind: 'task', href: `/board?task=${task.id}` })
  expect(byId.get(project.id)).toMatchObject({
    kind: 'project',
    href: `/projects/${project.slug}`,
  })
  expect(hits).toHaveLength(4)
})

test('an empty query finds nothing', async ({ request }) => {
  expect(await json(await request.get('/api/search?q='))).toEqual([])
  expect(await json(await request.get('/api/search?q=%20%20'))).toEqual([])
  expect(await json(await request.get('/api/search'))).toEqual([])
})

test('@ suggests contacts by name, and marks drafts', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup, {
    displayName: `Juniper ${WORD}`,
    jobTitle: 'Editor',
    company: 'Lantern Press',
  })
  const draft = await newContact(request, cleanup, {
    displayName: `Juno ${WORD}`,
    isDraft: true,
  })
  const suggest = async (q: string) =>
    json<Suggestion[]>(await request.get(`/api/search/mentions?type=contact&q=${q}`))

  // The name typed so far comes first; close spellings follow.
  expect((await suggest(`Juniper ${WORD}`))[0]).toEqual({
    id: contact.id,
    label: contact.displayName,
    kind: 'contact',
    sublabel: 'Editor · Lantern Press',
    isDraft: false,
  })
  expect((await suggest(`Juno ${WORD}`))[0]).toEqual({
    id: draft.id,
    label: draft.displayName,
    kind: 'contact',
    sublabel: 'draft',
    isDraft: true,
  })
  // With nothing typed, the most recent people, at most eight.
  const recent = await json<Suggestion[]>(await request.get('/api/search/mentions'))
  expect(recent.length).toBeGreaterThan(0)
  expect(recent.length).toBeLessThanOrEqual(8)
  expect(recent.every((s) => s.kind === 'contact')).toBe(true)
})

test('[[ suggests tasks and projects together', async ({ request, cleanup }) => {
  const task = await newTask(request, cleanup, { title: `Survey ${WORD}` })
  const project = await newProject(request, cleanup, { name: `Survey ${WORD} project` })
  const suggestions = await json<Suggestion[]>(
    await request.get(`/api/search/mentions?type=entity&q=${WORD}`),
  )
  expect(suggestions).toEqual(
    expect.arrayContaining([
      { id: project.id, label: project.name, kind: 'project', sublabel: 'project' },
      { id: task.id, label: task.title, kind: 'task', sublabel: 'task' },
    ]),
  )
})

test('the mention menu refuses an unknown type', async ({ request }) => {
  await invalid(await request.get('/api/search/mentions?type=tag&q=x'), 'type')
})
