import { test, expect } from '../support/fixtures'
import { newContact, newEntry, unique } from '../support/api'

for (const phone of [false, true]) {
  for (const kind of ['contact', 'note'] as const) {
    test(
      `search opens a ${kind} (${phone ? 'phone' : 'desktop'})`,
      { tag: phone ? '@phone' : '@desktop' },
      async ({ page, request, cleanup }) => {
        let title: string
        let path: string
        if (kind === 'contact') {
          const contact = await newContact(request, cleanup, { displayName: unique('Quillford') })
          title = contact.displayName
          path = `/contacts/${contact.slug}`
        } else {
          const { entry } = await newEntry(request, cleanup, { title: unique('Starlingmemo') })
          title = entry.title!
          path = `/notes/${entry.id}`
        }
        await page.goto(phone ? '/m' : '/')
        await page.waitForLoadState('networkidle')
        if (phone) await page.getByRole('button', { name: 'Search', exact: true }).click()
        else await page.keyboard.press('Control+k')
        await page.getByPlaceholder('Search people, notes, tasks and projects…').fill(title)
        await page.getByRole('option').filter({ hasText: title }).click()
        await expect(page).toHaveURL(new RegExp(`${path}$`))
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
        await page.waitForLoadState('networkidle')
      },
    )
  }
}
