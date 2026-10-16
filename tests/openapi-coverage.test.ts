import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routes, type ApiRoute } from '@/lib/openapi/routes'

/**
 * The route table in lib/openapi/routes.ts is what the API spec is built from,
 * so a handler missing from it is a route no agent can find. Every exported
 * method of every `route.ts` under app/ must be in it, and nothing else.
 */

const APP = path.resolve(__dirname, '../app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const EXPORTED = new RegExp(
  `export\\s+(?:async\\s+function|function|const)\\s+(${METHODS.join('|')})\\b`,
  'g',
)

/** `app/api/contacts/[id]/route.ts` → `/api/contacts/{id}`. */
function urlPath(file: string): string {
  const dir = path.relative(APP, path.dirname(file)).split(path.sep)
  return '/' + dir.map((part) => part.replace(/^\[(\w+)\]$/, '{$1}')).join('/')
}

/** Every `METHOD /path` the app's route handlers answer. */
function handled(): string[] {
  const files = readdirSync(APP, { recursive: true, encoding: 'utf8' })
    .filter((f) => path.basename(f) === 'route.ts')
    .map((f) => path.join(APP, f))
  return files.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(EXPORTED)].map(([, m]) => `${m} ${urlPath(file)}`),
  )
}

const described = (table: ApiRoute[]) => table.map((r) => `${r.method.toUpperCase()} ${r.path}`)

/** What one side has that the other lacks. */
function compare(table: ApiRoute[]) {
  const inCode = new Set(handled())
  const inTable = new Set(described(table))
  return {
    missing: [...inCode].filter((r) => !inTable.has(r)).sort(),
    unknown: [...inTable].filter((r) => !inCode.has(r)).sort(),
  }
}

describe('API route table', () => {
  it('finds the route handlers', () => {
    expect(handled()).toContain('GET /api/contacts/{id}')
    expect(handled()).toContain('GET /uploads/{name}')
    expect(handled().length).toBeGreaterThanOrEqual(48)
  })

  it('names every route handler, and only those', () => {
    expect(compare(routes)).toEqual({ missing: [], unknown: [] })
  })

  it('reports a route left out of the table', () => {
    const left = routes.filter((r) => !(r.method === 'patch' && r.path === '/api/tasks/{id}/move'))
    expect(compare(left).missing).toEqual(['PATCH /api/tasks/{id}/move'])
  })

  it('reports a table entry with no handler', () => {
    const extra = [...routes, { ...routes[0], method: 'delete' as const }]
    expect(compare(extra).unknown).toEqual([`DELETE ${routes[0].path}`])
  })

  it('lists each route once, with its own operationId', () => {
    expect(new Set(described(routes)).size).toBe(routes.length)
    expect(new Set(routes.map((r) => r.operationId)).size).toBe(routes.length)
  })

  it('is what the committed spec holds', () => {
    const spec = JSON.parse(
      readFileSync(path.resolve(__dirname, '../docs/api/kinship.openapi.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> }
    const inSpec = Object.entries(spec.paths).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
    )
    expect(inSpec.sort()).toEqual(described(routes).sort())
  })
})
