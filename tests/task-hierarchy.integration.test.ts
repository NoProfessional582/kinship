import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { createTask, updateTask, taskHierarchyReport } from '@/lib/services/tasks'
import { upsertTaskSchema } from '@/lib/validation'
import { contend } from './support/owner-contention'

const owner = `__hierarchy_${Date.now()}`
const input = (title: string, parentTaskId: string | null = null) =>
  upsertTaskSchema.parse({ title, parentTaskId })
afterAll(async () => {
  await prisma.task.deleteMany({ where: { owner: { startsWith: owner } } })
  await prisma.boardColumn.deleteMany({ where: { owner: { startsWith: owner } } })
  await prisma.$disconnect()
})

describe('task hierarchy writes', () => {
  it('rejects self and ancestor cycles without changing the task', async () => {
    const a = await createTask(owner, input('root'))
    const b = await createTask(owner, input('child', a.id))
    const c = await createTask(owner, input('grandchild', b.id))
    for (const parent of [a.id, c.id]) {
      await expect(updateTask(owner, a.id, input('changed', parent))).rejects.toThrow(/cycle/)
      expect(await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
        title: 'root',
        parentTaskId: null,
      })
    }
    await updateTask(owner, b.id, input('detached'))
    await updateTask(owner, a.id, input('new child', c.id))
    expect((await taskHierarchyReport(owner)).cycles).toEqual([])
  })

  it('includes trashed ancestors and rejects foreign parents', async () => {
    const a = await createTask(owner, input('live'))
    const b = await createTask(owner, input('trash', a.id))
    await prisma.task.update({ where: { id: b.id }, data: { deletedAt: new Date() } })
    await expect(updateTask(owner, a.id, input('cycle', b.id))).rejects.toThrow(/cycle/)
    const foreign = await createTask(owner + '-foreign', input('foreign'))
    await expect(updateTask(owner, a.id, input('foreign link', foreign.id))).rejects.toThrow()
  })

  it('reports existing cycles read-only and allows explicit detachment', async () => {
    const a = await createTask(owner, input('legacy a'))
    const b = await createTask(owner, input('legacy b', a.id))
    await prisma.task.update({ where: { id: a.id }, data: { parentTaskId: b.id } })
    const before = await prisma.task.findMany({ where: { id: { in: [a.id, b.id] } } })
    const report = await taskHierarchyReport(owner)
    expect(report.cycles.flat().sort()).toEqual([a.id, b.id].sort())
    expect(await prisma.task.findMany({ where: { id: { in: [a.id, b.id] } } })).toEqual(before)
    await expect(createTask(owner, input('into legacy cycle', a.id))).rejects.toThrow(/cycle/)
    await updateTask(owner, a.id, input('explicit detach'))
    expect((await taskHierarchyReport(owner)).cycles).toEqual([])
  })

  it('serializes opposing reparent writes: one succeeds and one is refused', async () => {
    const a = await createTask(owner, input('race a'))
    const b = await createTask(owner, input('race b'))
    const results = await contend(owner, [
      () => updateTask(owner, a.id, input('race a', b.id)),
      () => updateTask(owner, b.id, input('race b', a.id)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.message).toMatch(/cycle/)
    expect((await taskHierarchyReport(owner)).cycles).toEqual([])
  })

  it('preserves valid concurrent detach operations', async () => {
    const a = await createTask(owner, input('detach a'))
    const b = await createTask(owner, input('detach b', a.id))
    const results = await contend(owner, [
      () => updateTask(owner, a.id, input('detach a')),
      () => updateTask(owner, b.id, input('detach b')),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
  })
})
