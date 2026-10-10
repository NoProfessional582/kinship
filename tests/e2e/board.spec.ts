import { test, expect } from '../support/fixtures'
import { newColumn, newTask, json, unique, type Task, type Column } from '../support/api'

test(
  'create and reorder a column, create and drag a task',
  { tag: '@desktop' },
  async ({ page, request, cleanup }) => {
    const original = await json<Column[]>(await request.get('/api/columns'))
    const name = unique('Reviewcolumn')
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Add column', exact: true }).click()
    await page.getByPlaceholder('Waiting on', { exact: true }).fill(name)
    const adding = page.waitForResponse(
      (r) => r.url().endsWith('/api/columns') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const column = (await (await adding).json()) as Column
    cleanup.column(column.id)
    // Restore the pre-test order before removing the new column.
    cleanup.add('restore column order', async () =>
      json(
        await request.patch('/api/columns/reorder', {
          data: { columnIds: [...original.map((c) => c.id), column.id] },
        }),
      ),
    )
    const row = page
      .locator('div')
      .filter({ has: page.locator(`input[value="${name}"]`) })
      .filter({ has: page.getByRole('button', { name: 'Move up', exact: true }) })
      .last()
    // Put it second so both source and target remain visible during the drag.
    for (let i = 0; i < original.length - 1; i++) {
      const moved = page.waitForResponse(
        (r) => r.url().endsWith('/api/columns/reorder') && r.request().method() === 'PATCH',
      )
      await row.getByRole('button', { name: 'Move up', exact: true }).click()
      expect((await moved).status()).toBe(200)
      await expect
        .poll(async () =>
          (await json<Column[]>(await request.get('/api/columns'))).findIndex(
            (c) => c.id === column.id,
          ),
        )
        .toBe(original.length - i - 1)
      await page.waitForLoadState('networkidle')
    }
    await page.reload()
    expect((await json<Column[]>(await request.get('/api/columns')))[1].id).toBe(column.id)
    await page.goto('/board')
    await page.getByRole('button', { name: 'New task', exact: true }).click()
    const title = unique('Review seedling')
    await page.getByPlaceholder('What needs doing?').fill(title)
    const creating = page.waitForResponse(
      (r) => r.url().endsWith('/api/tasks') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Create task', exact: true }).click()
    const task = (await (await creating).json()) as Task
    cleanup.record('task', task.id)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const source = page.getByText(title, { exact: true })
    const target = page.locator(`[data-zone="${column.id}::__all__"]`)
    await expect(source).toBeVisible()
    await target.scrollIntoViewIfNeeded()
    const a = await source.boundingBox()
    const b = await target.boundingBox()
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2)
    await page.mouse.down()
    await page.mouse.move(a!.x + a!.width / 2 + 12, a!.y + a!.height / 2, { steps: 3 })
    await page.mouse.move(b!.x + b!.width / 2, b!.y + 90, { steps: 20 })
    await page.mouse.up()
    await expect
      .poll(async () => (await json<Task>(await request.get(`/api/tasks/${task.id}`))).columnId)
      .toBe(column.id)
    await page.waitForLoadState('networkidle')
    await page.reload()
    await expect(target.getByText(title, { exact: true })).toBeVisible()
    const columns = await json<Column[]>(await request.get('/api/columns'))
    expect(columns[1].id).toBe(column.id)
  },
)

test(
  'phone moves a card and keeps it after reload',
  { tag: '@phone' },
  async ({ page, request, cleanup }) => {
    const from = await newColumn(request, cleanup)
    const to = await newColumn(request, cleanup)
    const task = await newTask(request, cleanup, { columnId: from.id })
    await page.goto('/m/board')
    await page.getByRole('button', { name: `Move ${task.title}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: to.name, exact: true }).click()
    await expect
      .poll(async () => (await json<Task>(await request.get(`/api/tasks/${task.id}`))).columnId)
      .toBe(to.id)
    await page.reload()
    const column = page
      .locator('div')
      .filter({ has: page.getByRole('button', { name: new RegExp(to.name) }) })
      .filter({ has: page.getByText(task.title, { exact: true }) })
      .last()
    await expect(column.getByText(task.title, { exact: true })).toBeVisible()
  },
)
