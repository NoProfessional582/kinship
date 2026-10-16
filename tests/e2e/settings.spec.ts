import { test, expect } from '../support/fixtures'
import { json } from '../support/api'

for (const phone of [false, true]) {
  test(
    `settings and theme persist after reload (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      const before = await json<{ timezone: string | null; calendarWeekStart: string }>(
        await request.get('/api/settings'),
      )
      cleanup.add('restore settings', () => request.patch('/api/settings', { data: before }))
      await page.goto(phone ? '/m/settings' : '/settings')
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
      // These visible captions do not associate labels with inputs yet.
      const week = page
        .locator('div')
        .filter({ has: page.getByText('Week starts on', { exact: true }) })
        .filter({ has: page.locator('select') })
        .last()
        .locator('select')
      const next = before.calendarWeekStart === 'monday' ? 'sunday' : 'monday'
      await week.selectOption(next)
      if (phone) await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      else {
        await page.getByPlaceholder('Search zones… e.g. Denver').fill('Pacific/Honolulu')
        await page.getByRole('button', { name: /^Pacific\/Honolulu/ }).click()
      }
      await expect
        .poll(
          async () =>
            (await json<{ calendarWeekStart: string }>(await request.get('/api/settings')))
              .calendarWeekStart,
        )
        .toBe(next)
      if (phone) await page.getByRole('button', { name: 'More', exact: true }).click()
      const theme = page.getByRole('button', { name: /Theme|Dark theme|Light theme/ })
      const oldTheme = await page.locator('html').getAttribute('class')
      await theme.click()
      await expect.poll(() => page.locator('html').getAttribute('class')).not.toBe(oldTheme)
      const newTheme = await page.locator('html').getAttribute('class')
      await page.reload()
      await expect(week).toHaveValue(next)
      await expect(page.locator('html')).toHaveAttribute('class', newTheme!)
      if (!phone)
        expect(
          (await json<{ timezone: string }>(await request.get('/api/settings'))).timezone,
        ).toBe('Pacific/Honolulu')
    },
  )
}

for (const phone of [false, true]) {
  test(
    `agent access switches to read only and back (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      cleanup.add('agents back to read and write', () =>
        request.patch('/api/settings', { data: { agentAccess: 'write' } }),
      )
      await json(await request.patch('/api/settings', { data: { agentAccess: 'write' } }))
      const stored = async () =>
        (await json<{ agentAccess: string }>(await request.get('/api/settings'))).agentAccess

      const choose = async (value: 'read' | 'write') => {
        if (phone) {
          await page.getByLabel('What AI agents may do').selectOption(value)
          await page.getByRole('button', { name: 'Save changes', exact: true }).click()
        } else {
          const name = value === 'read' ? /^Read only/ : /^Can read and write/
          await page.getByRole('radio', { name }).click()
        }
        await expect.poll(stored).toBe(value)
      }
      const shows = async (value: 'read' | 'write') => {
        if (phone) await expect(page.getByLabel('What AI agents may do')).toHaveValue(value)
        else {
          const name = value === 'read' ? /^Read only/ : /^Can read and write/
          await expect(page.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
        }
      }

      await page.goto(phone ? '/m/settings' : '/settings')
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
      await shows('write')
      await choose('read')
      await page.reload()
      await shows('read')
      await choose('write')
      await page.reload()
      await shows('write')
    },
  )
}
