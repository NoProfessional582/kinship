import { test, expect } from '../support/fixtures'
import { json, unique, newContact, type Contact } from '../support/api'

// A one-pixel PNG, made-up test asset shared by both forms.
const avatar = {
  name: 'avatar.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6YxkAAAAASUVORK5CYII=',
    'base64',
  ),
}

for (const phone of [false, true]) {
  test(
    `contact dossier saves details and avatar (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      const name = unique('Dossier')
      let contact: Contact
      if (phone) {
        contact = await newContact(request, cleanup, { displayName: name })
        await page.goto(`/m/contacts/${contact.id}`)
        await page.getByRole('button', { name: 'Edit contact', exact: true }).click()
      } else {
        await page.goto('/contacts')
        await page.getByRole('button', { name: 'New contact', exact: true }).click()
        await page.getByPlaceholder('How they appear everywhere').fill(name)
        const saved = page.waitForResponse(
          (r) => r.url().endsWith('/api/contacts') && r.request().method() === 'POST',
        )
        await page.getByRole('button', { name: 'Create contact', exact: true }).click()
        contact = (await (await saved).json()) as Contact
        cleanup.record('contact', contact.id)
        await page.goto(`/contacts/${contact.id}`)
        await page.getByRole('button', { name: 'Edit dossier', exact: true }).click()
      }
      const form = page.getByRole('dialog')
      await form
        .getByPlaceholder('One line that captures who they are')
        .fill('A fictional botanist')
      await form.getByRole('button', { name: 'Add detail', exact: true }).click()
      await form.getByPlaceholder('Category', { exact: true }).fill('Preferences')
      await form.getByPlaceholder('Label', { exact: true }).fill('Tea')
      await form.getByPlaceholder('Value', { exact: true }).fill('Mint')
      await form.locator('input[type=file]').setInputFiles(avatar)
      const saved = page.waitForResponse(
        (r) => r.url().endsWith(`/api/contacts/${contact.id}`) && r.request().method() === 'PATCH',
      )
      await form.getByRole('button', { name: phone ? 'Save' : 'Save changes', exact: true }).click()
      expect((await saved).status()).toBe(200)
      await expect(form).toHaveCount(0)
      await page.reload()
      if (phone) {
        // The detail's own label, not a blank one: the phone dossier once read
        // a field attributes do not have.
        await page.getByRole('button', { name: 'Details', exact: true }).click()
        await expect(page.getByRole('term').filter({ hasText: /^Tea$/ })).toBeVisible()
        await page.getByRole('button', { name: 'Edit contact', exact: true }).click()
        await expect(page.getByPlaceholder('One line that captures who they are')).toHaveValue(
          'A fictional botanist',
        )
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      } else
        await expect(page.getByText('A fictional botanist', { exact: true }).first()).toBeVisible()
      const result = await json<{ contact: Contact }>(
        await request.get(`/api/contacts/${contact.id}`),
      )
      expect(result.contact.attributes).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'Tea', value: 'Mint' })]),
      )
      expect(result.contact.avatarUrl).toMatch(/^\/uploads\//)
      const image = await request.get(result.contact.avatarUrl!)
      expect(image.status()).toBe(200)
      expect(await image.body()).toEqual(avatar.buffer)
    },
  )
}

test(
  'delete a contact and restore it from trash',
  { tag: '@desktop' },
  async ({ page, request, cleanup }) => {
    const contact = await newContact(request, cleanup)
    await page.goto(`/contacts/${contact.id}`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByTitle('Delete contact', { exact: true }).click()
    await page.goto('/trash')
    const row = page
      .locator('div')
      .filter({ has: page.getByText(contact.displayName, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Restore', exact: true }) })
      .last()
    await row.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByText(contact.displayName, { exact: true })).toHaveCount(0)
    await page.goto(`/contacts/${contact.id}`)
    await expect(page.getByRole('heading', { level: 1, name: contact.displayName })).toBeVisible()
  },
)
