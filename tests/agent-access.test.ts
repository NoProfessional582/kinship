import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The endpoint switch is environment only; the database is never reached here.
vi.mock('@/lib/db', () => ({ prisma: {} }))
const { agentEndpointEnabled } = await import('@/lib/agent-access')

let saved: string | undefined
beforeEach(() => {
  saved = process.env.KINSHIP_AGENT_ACCESS
})
afterEach(() => {
  if (saved === undefined) delete process.env.KINSHIP_AGENT_ACCESS
  else process.env.KINSHIP_AGENT_ACCESS = saved
})

describe('agentEndpointEnabled', () => {
  it('is on when KINSHIP_AGENT_ACCESS is unset or empty', () => {
    delete process.env.KINSHIP_AGENT_ACCESS
    expect(agentEndpointEnabled()).toBe(true)
    process.env.KINSHIP_AGENT_ACCESS = ''
    expect(agentEndpointEnabled()).toBe(true)
  })

  it('is off for "off", in any case and with spaces', () => {
    for (const value of ['off', 'OFF', ' Off ']) {
      process.env.KINSHIP_AGENT_ACCESS = value
      expect(agentEndpointEnabled()).toBe(false)
    }
  })

  it('stays on for any other value', () => {
    for (const value of ['on', 'read', 'write', 'false', '0']) {
      process.env.KINSHIP_AGENT_ACCESS = value
      expect(agentEndpointEnabled()).toBe(true)
    }
  })

  it('is read on every call, so a change applies without a restart', () => {
    process.env.KINSHIP_AGENT_ACCESS = 'off'
    expect(agentEndpointEnabled()).toBe(false)
    delete process.env.KINSHIP_AGENT_ACCESS
    expect(agentEndpointEnabled()).toBe(true)
  })
})
