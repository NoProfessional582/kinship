import { NextResponse } from 'next/server'
import spec from '@/docs/api/kinship.openapi.json'

/**
 * This API's description (OpenAPI 3.1), for agents and tools: the committed
 * docs/api/kinship.openapi.json, built into the server. `npm run api:spec` makes
 * it from lib/openapi/routes.ts; docs/api/agents.md says how to use the API.
 */
export function GET() {
  return NextResponse.json(spec)
}
