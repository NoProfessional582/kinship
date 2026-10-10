import { test, expect } from '../support/fixtures'
import { newContact, newEntry, newTask, unique } from '../support/api'
import { BASE_URL } from '../support/stack'

for (const phone of [false, true]) {
  for (const kind of ['contact', 'note', 'task'] as const) {
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
        } else if (kind === 'task') {
          const task = await newTask(request, cleanup, { title: unique('Wrenstask') })
          title = task.title
          path = `/board?task=${task.id}`
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
        // A phone stays in the phone pages.
        await expect(page).toHaveURL(`${BASE_URL}${phone ? '/m' : ''}${path}`)
        if (kind === 'task') {
          // The board opens the task in its dialog (desktop) or sheet (phone).
          await expect(page.getByRole('dialog').getByText(title).first()).toBeVisible()
        } else {
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
        }
        await page.waitForLoadState('networkidle')
      },
    )
  }
}
