import { test, expect } from '../support/fixtures'

test('board stays idle after closing New task', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/board')
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForLoadState('networkidle')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const duration = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const metric = metrics.find((m) => m.name === 'TaskDuration')
    expect(metric, 'Chromium exposes TaskDuration').toBeDefined()
    return metric!.value
  }
  const requests: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url())
  })
  const before = await duration()
  await page.waitForTimeout(5000)
  const spent = (await duration()) - before
  await cdp.detach()
  expect(requests, 'idle board makes no API requests').toEqual([])
  expect(spent, 'less than 5% main-thread CPU while idle').toBeLessThan(0.25)
})
