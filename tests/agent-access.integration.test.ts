import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { agentAccess } from '@/lib/agent-access'

/** The stored agent access setting, against a real database. */
const OWNER = `__agentaccess_${Date.now()}__owner`

afterAll(async () => {
  await prisma.settings.deleteMany({ where: { owner: OWNER } })
})

describe('agentAccess', () => {
  it('is write when the owner has no settings row yet', async () => {
    expect(await agentAccess(OWNER)).toBe('write')
  })

  it('defaults a new settings row to write', async () => {
    const row = await prisma.settings.create({ data: { owner: OWNER } })
    expect(row.agentAccess).toBe('write')
    expect(await agentAccess(OWNER)).toBe('write')
  })

  it('follows the stored choice both ways', async () => {
    await prisma.settings.update({ where: { owner: OWNER }, data: { agentAccess: 'read' } })
    expect(await agentAccess(OWNER)).toBe('read')
    await prisma.settings.update({ where: { owner: OWNER }, data: { agentAccess: 'write' } })
    expect(await agentAccess(OWNER)).toBe('write')
  })

  it('treats an unexpected stored value as write', async () => {
    await prisma.settings.update({ where: { owner: OWNER }, data: { agentAccess: 'bogus' } })
    expect(await agentAccess(OWNER)).toBe('write')
  })
})
