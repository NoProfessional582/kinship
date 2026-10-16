import { prisma } from './db'
import type { AgentAccess } from './validation'

/**
 * Agent access, for the MCP endpoint (`/api/mcp`).
 *
 * Two switches, on purpose in two places:
 *  - `KINSHIP_AGENT_ACCESS=off` in `.env` turns the endpoint off entirely. It is
 *    environment only, so nothing an agent can call is able to turn it back on.
 *  - `Settings.agentAccess` (`write` or `read`) is the everyday choice, changed
 *    from Settings in the app. No MCP tool can change it.
 *
 * Both are read on every call, so a change applies to the next request.
 */

/** False only when `KINSHIP_AGENT_ACCESS` is `off` (any case, spaces ignored). */
export function agentEndpointEnabled(): boolean {
  return process.env.KINSHIP_AGENT_ACCESS?.trim().toLowerCase() !== 'off'
}

/** The owner's agent access; `write` until they choose otherwise. */
export async function agentAccess(owner: string): Promise<AgentAccess> {
  const row = await prisma.settings.findUnique({
    where: { owner },
    select: { agentAccess: true },
  })
  return row?.agentAccess === 'read' ? 'read' : 'write'
}
