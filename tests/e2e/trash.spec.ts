import { test, expect } from '../support/fixtures'
import { newEntry, json, type TrashList } from '../support/api'

for (const phone of [false, true]) {
  test(
    `delete and restore a note, then empty trash (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      const { entry } = await newEntry(request, cleanup)
      const prefix = phone ? '/m' : ''
      await page.goto(`${prefix}/notes/${entry.id}`)
      const remove = phone
        ? page.getByRole('button', { name: 'Delete entry', exact: true })
        : page.getByTitle('Delete entry', { exact: true })
      await remove.click()
      await page.goto(`${prefix}/trash`)
      if (phone)
        await page.getByRole('button', { name: `Restore ${entry.title}`, exact: true }).click()
      else {
        const row = page
          .locator('div')
          .filter({ has: page.getByText(entry.title!, { exact: true }) })
          .filter({ has: page.getByRole('button', { name: 'Restore', exact: true }) })
          .last()
        await row.getByRole('button', { name: 'Restore', exact: true }).click()
      }
      await expect(page.getByText(entry.title!, { exact: true })).toHaveCount(0)
      await page.goto(`${prefix}/notes/${entry.id}`)
      await expect(page.getByText(entry.title!, { exact: true }).first()).toBeVisible()
      await remove.click()
      await page.goto(`${prefix}/trash`)
      // Shared database: every earlier test purges what it made. Never erase another test's data.
      const trash = await json<TrashList>(await request.get('/api/trash'))
      expect(trash.total).toBe(1)
      expect(trash.entries.map((e) => e.id)).toEqual([entry.id])
      await page.getByRole('button', { name: /^Empty trash/ }).click()
      await page
        .getByRole('button', { name: phone ? 'Empty for good' : /^Permanently delete/ })
        .click()
      await expect
        .poll(async () => (await json<TrashList>(await request.get('/api/trash'))).total)
        .toBe(0)
    },
  )
}
