import { test, expect } from '../support/fixtures'
import { newTask, unique, type Entry } from '../support/api'

for (const phone of [false, true]) {
  test(
    `calendar shows an all-day task and event and changes months (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      const today = new Date().toISOString().slice(0, 10)
      const task = await newTask(request, cleanup, {
        dueDate: `${today}T00:00:00.000Z`,
        allDay: true,
      })
      await page.goto(phone ? '/m/calendar' : '/calendar')
      await page.getByRole('button', { name: 'New event', exact: true }).click()
      await page.getByPlaceholder('What is it? e.g. Dentist, 3pm').fill(unique('Greenhousevisit'))
      await page
        .getByRole('dialog')
        .locator('input[type=datetime-local]')
        .first()
        .fill(`${today}T09:00`)
      const created = page.waitForResponse(
        (r) => r.url().endsWith('/api/entries') && r.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Add event', exact: true }).click()
      const { entry } = (await (await created).json()) as { entry: Entry }
      cleanup.record('entry', entry.id)
      expect(entry.kind).toBe('EVENT')
      expect(entry.occurredAt.slice(0, 10)).toBe(today)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(entry.title!, { exact: true }).first()).toBeVisible()
      if (phone) await page.getByRole('button', { name: 'month', exact: true }).click()
      const next = page.getByRole('button', { name: phone ? 'Next month' : 'Next', exact: true })
      const previous = page.getByRole('button', {
        name: phone ? 'Previous month' : 'Previous',
        exact: true,
      })
      const label = phone
        ? page.locator('main p').filter({ hasText: /^[A-Z][a-z]+ \d{4}$/ })
        : page.getByRole('heading', { level: 1 })
      const before = await label.textContent()
      await next.click()
      await expect.poll(() => label.textContent()).not.toBe(before)
      await previous.click()
      await expect.poll(() => label.textContent()).toBe(before)
      await expect(page.getByText(entry.title!, { exact: true }).first()).toBeVisible()
    },
  )
}

for (const phone of [false, true]) {
  test(
    `calendar shows a task throughout an interior month (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      const now = new Date()
      const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
        .toISOString()
        .slice(0, 10)
      const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1))
        .toISOString()
        .slice(0, 10)
      const task = await newTask(request, cleanup, { startDate, dueDate, allDay: true })
      await page.goto(phone ? '/m/calendar' : '/calendar')
      if (phone) await page.getByRole('button', { name: 'month', exact: true }).click()
      await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible()
    },
  )
}
