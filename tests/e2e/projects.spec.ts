import { test, expect } from '../support/fixtures'
import { newProject, unique, json, type Entry, type Project, type Task } from '../support/api'

for (const phone of [false, true]) {
  test(
    `project holds a new task and a note (${phone ? 'phone' : 'desktop'})`,
    { tag: phone ? '@phone' : '@desktop' },
    async ({ page, request, cleanup }) => {
      let project: Project
      if (phone) project = await newProject(request, cleanup)
      else {
        await page.goto('/projects')
        await page.getByRole('button', { name: 'Add project', exact: true }).click()
        await page.getByPlaceholder('Project name').fill(unique('Gardenplan'))
        const saved = page.waitForResponse(
          (r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST',
        )
        await page.getByRole('button', { name: 'Create project', exact: true }).click()
        project = (await (await saved).json()) as Project
        cleanup.record('project', project.id)
      }
      await page.goto(`${phone ? '/m' : ''}/projects/${project.id}`)
      await page.getByRole('button', { name: 'New task', exact: true }).click()
      const title = unique('Plant seedlings')
      await page.getByPlaceholder('What needs doing?').fill(title)
      const saved = page.waitForResponse(
        (r) => r.url().endsWith('/api/tasks') && r.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Create task', exact: true }).click()
      const task = (await (await saved).json()) as Task
      cleanup.record('task', task.id)
      expect(task.projectId).toBe(project.id)
      await page.reload()
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
      await page.goto(`${phone ? '/m' : ''}/notes`)
      await page.getByRole('button', { name: phone ? /Write$/ : /Start writing/ }).click()
      const noteTitle = unique('Projectjournal')
      await page
        .getByPlaceholder(phone ? 'Title (optional)' : 'Give this entry a title…')
        .fill(noteTitle)
      await page.locator('[contenteditable=true]').fill('A fictional project note.')
      if (phone) await page.getByRole('button', { name: 'Details', exact: true }).click()
      await page
        .locator('select')
        .filter({ has: page.locator(`option[value="${project.id}"]`) })
        .selectOption(project.id)
      const noteSaved = page.waitForResponse(
        (r) => r.url().endsWith('/api/entries') && r.request().method() === 'POST',
      )
      await page.getByRole('button', { name: phone ? 'Save' : /^Save entry/ }).click()
      const { entry } = (await (await noteSaved).json()) as { entry: Entry }
      cleanup.record('entry', entry.id)
      const stored = await json<{ projectId: string }>(
        await request.get(`/api/entries/${entry.id}`),
      )
      expect(stored.projectId).toBe(project.id)
      await page.reload()
      await expect(page.getByText(noteTitle, { exact: true }).first()).toBeVisible()
    },
  )
}
