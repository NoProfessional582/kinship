import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { handle } from '../api'

/**
 * Tool answers for the MCP endpoint. A tool runs its service call through `handle`, the
 * same funnel every REST route uses, so a service error reads the same over MCP as over
 * HTTP: a 4xx becomes a tool error with the message, never a crash of the request. The
 * answer then makes the same trip through JSON a REST answer makes (dates become ISO
 * strings) before it is trimmed.
 */

/** A tool's answer: compact JSON text. */
export function toolResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

/** A refusal the agent can read and act on. */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

interface ErrorBody {
  error?: string
  issues?: { path?: (string | number)[]; message?: string }[]
}

/** `handle`'s error body as one line: the message, then each Zod issue as `path: message`. */
export function errorText(body: ErrorBody): string {
  const message = body.error || 'Unexpected error'
  const issues = (body.issues ?? []).map((i) =>
    i.path?.length ? `${i.path.join('.')}: ${i.message}` : String(i.message),
  )
  return issues.length ? `${message}: ${issues.join('; ')}` : message
}

/**
 * Runs a service call the way a REST route does and trims what it answers. `T` is the
 * answer after JSON (lib/openapi/responses.ts describes each one).
 */
export async function runTool<T>(
  call: () => Promise<unknown>,
  trim: (answer: T) => unknown,
): Promise<CallToolResult> {
  const response = await handle(call)
  const body: unknown = await response.json()
  if (!response.ok) return toolError(errorText(body as ErrorBody))
  return toolResult(trim(body as T))
}
