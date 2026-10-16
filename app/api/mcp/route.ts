import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { NextResponse } from 'next/server'
import { agentEndpointEnabled } from '@/lib/agent-access'
import { handle } from '@/lib/api'
import { readTextCapped } from '@/lib/body-limit'
import { ValidationError } from '@/lib/errors'
import { requireIdentity } from '@/lib/identity'
import { connectMcpServer } from '@/lib/mcp/server'

export const dynamic = 'force-dynamic'

/**
 * The MCP endpoint (Streamable HTTP, stateless, JSON answers) for AI agents on this
 * computer. It sits behind the same request gate as every route (proxy.ts): MCP clients
 * send no Origin and POST JSON. `KINSHIP_AGENT_ACCESS=off` turns it off.
 */

/** Far above any tool call: a note body is at most 100,000 characters. */
const MAX_MCP_BYTES = 1024 * 1024

const turnedOff = () =>
  NextResponse.json(
    { error: 'The agent endpoint is turned off (KINSHIP_AGENT_ACCESS=off).' },
    { status: 404 },
  )

/** Stateless: there is no stream to open (GET) and no session to end (DELETE). */
const notAllowed = () =>
  agentEndpointEnabled()
    ? NextResponse.json(
        { error: 'Method not allowed: this endpoint is stateless; send MCP requests by POST.' },
        { status: 405, headers: { Allow: 'POST' } },
      )
    : turnedOff()

/**
 * The JSON-RPC message, read here rather than by the transport so a body that is too big
 * or not JSON is refused as every other route refuses it (413, 400).
 */
async function readMessage(req: Request): Promise<unknown> {
  const raw = await readTextCapped(req, MAX_MCP_BYTES)
  try {
    return JSON.parse(raw)
  } catch {
    throw new ValidationError('The body is not valid JSON.')
  }
}

export async function POST(req: Request) {
  if (!agentEndpointEnabled()) return turnedOff()
  let parsedBody: unknown
  try {
    parsedBody = await readMessage(req)
  } catch (err) {
    return handle(() => Promise.reject(err))
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = await connectMcpServer(requireIdentity(req).subject, transport)
  try {
    const response = await transport.handleRequest(req, { parsedBody })
    // One owner's records: no shared cache may keep them.
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } finally {
    await server.close()
  }
}

export const GET = notAllowed
export const DELETE = notAllowed
