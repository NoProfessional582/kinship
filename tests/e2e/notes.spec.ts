import { test, expect } from '../support/fixtures'
import { newContact, unique, json, type Entry } from '../support/api'

for (const phone of [false, true]) {
  test(
    `write a tagged note mentioning a person (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      const contact = await newContact(request, cleanup, { displayName: unique('Asterlane') })
      const title = unique('Fieldjournal')
      const tag = unique('botany').replaceAll(' ', '-')
      await page.goto(phone ? '/m/notes' : '/notes')
      await page.getByRole('button', { name: phone ? /Write$/ : /Start writing/ }).click()
      await page
        .getByPlaceholder(phone ? 'Title (optional)' : 'Give this entry a title…')
        .fill(title)
      const editor = page.locator('[contenteditable=true]')
      await editor.click()
      await editor.pressSequentially(`A conversation with @${contact.displayName}`, { delay: 20 })
      const suggestion = page
        .locator('button[data-index]')
        .filter({ hasText: contact.displayName })
        .first()
      await expect(suggestion).toBeVisible()
      if (phone) await editor.press('Enter')
      else await suggestion.click()
      await editor.pressSequentially(' about fictional plants.')
      if (phone) await page.getByRole('button', { name: 'Details', exact: true }).click()
      await page.getByPlaceholder('Add a tag…').fill(tag)
      await page.getByPlaceholder('Add a tag…').press('Enter')
      const saved = page.waitForResponse(
        (r) => r.url().endsWith('/api/entries') && r.request().method() === 'POST',
      )
      await page.getByRole('button', { name: phone ? 'Save' : /^Save entry/ }).click()
      const { entry } = (await (await saved).json()) as { entry: Entry }
      cleanup.record('entry', entry.id)
      const stored = await json<Entry>(await request.get(`/api/entries/${entry.id}`))
      expect(stored.mentions.map((m) => m.contact.id)).toContain(contact.id)
      expect(stored.tags.map((t) => t.tag.name)).toContain(tag)
      await page.goto(`${phone ? '/m' : ''}/contacts/${contact.id}`)
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
      const hits = await json<{ id: string }[]>(
        await request.get(`/api/search?q=${encodeURIComponent(title)}`),
      )
      expect(hits.map((h) => h.id)).toContain(entry.id)
    },
  )
}

for (const phone of [false, true]) {
  test(
    `restores a saved draft and its chosen date (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page }) => {
      const title = unique('Restoredjournal')
      const occurredAt = '2026-04-03T14:25'
      await page.addInitScript(
        ({ title, occurredAt }) => {
          localStorage.setItem(
            'kb.composer.hero',
            JSON.stringify({
              kind: 'NOTE',
              title,
              occurredAt,
              direction: '',
              durationMin: '',
              location: '',
              followUpAt: '',
              projectId: '',
              tags: [],
              body: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'A fictional draft kept across a reload.' }],
                  },
                ],
              },
            }),
          )
        },
        { title, occurredAt },
      )
      await page.goto(phone ? '/m/notes' : '/notes')
      await expect(
        page.getByPlaceholder(phone ? 'Title (optional)' : 'Give this entry a title…'),
      ).toHaveValue(title)
      await expect(page.locator('[contenteditable=true]')).toContainText(
        'A fictional draft kept across a reload.',
      )
      if (phone) await page.getByRole('button', { name: 'Details', exact: true }).click()
      await expect(page.locator('input[type=datetime-local]').first()).toHaveValue(occurredAt)
    },
  )
}
