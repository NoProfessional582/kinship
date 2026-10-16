/**
 * Builds docs/api/kinship.openapi.json from the route table (lib/openapi/routes.ts),
 * the zod schemas it names, and docs/api/graph.openapi.json for /api/graph.
 *
 *   scripts/node.sh npm run api:spec        writes the file (then Prettier formats it)
 *   scripts/node.sh npx tsx scripts/api-spec.ts   prints it, for scripts/check.sh to compare
 *
 * Deterministic: the same code always gives the same file, byte for byte.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import * as responses from '../lib/openapi/responses'
import { requestSchemas, routes, type ApiRoute, type ErrorStatus } from '../lib/openapi/routes'

type Json = Record<string, unknown>

const root = path.resolve(__dirname, '..')
const OUT = 'docs/api/kinship.openapi.json'
const graphSpec = JSON.parse(readFileSync(path.join(root, 'docs/api/graph.openapi.json'), 'utf8'))
const version: string = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

/** Every named schema, by the zod instance, so a use anywhere becomes a `$ref`. */
const names = new Map<z.ZodType, string>()
for (const [name, schema] of [...Object.entries(responses), ...Object.entries(requestSchemas)]) {
  if (schema instanceof z.ZodType && !names.has(schema)) names.set(schema, name)
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

/** Whether a request may leave this key out. */
const omittable = (schema: z.ZodType) => schema.safeParse(undefined).success

/**
 * zod's JSON Schema, in input mode, made fit for a spec: dates as `date-time`
 * strings, no default that is "now at generation time", no regex that only
 * restates `format`, and named schemas as references.
 */
function jsonSchema(schema: z.ZodType, request: boolean): Json {
  const out = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema: js, path: at }) => {
      const s = js as Json
      const zs = zodSchema as unknown as z.ZodType
      const def = (zodSchema as unknown as { _zod: { def: Json } })._zod.def

      const name = names.get(zs)
      if (name && at.length > 0) {
        for (const key of Object.keys(s)) delete s[key]
        Object.assign(s, ref(name))
        return
      }

      // A date, or a union that accepts one (a string, a number or a Date), is an instant on the wire.
      const options = def.type === 'union' ? (def.options as { _zod: { def: Json } }[]) : []
      if (def.type === 'date' || options.some((o) => o._zod.def.type === 'date')) {
        delete s.anyOf
        delete s.minLength
        Object.assign(s, { type: 'string', format: 'date-time' })
      }
      if (def.type === 'default' && (def.defaultValue as unknown) instanceof Date) {
        delete s.default
        s.description = [s.description, 'Defaults to now.'].filter(Boolean).join(' ')
      }
      if (s.format === 'date-time') delete s.pattern
      // zod's own names for string checks; `pattern` already says it.
      if (['starts_with', 'ends_with', 'includes'].includes(s.format as string)) delete s.format
      if (s.maximum === Number.MAX_SAFE_INTEGER) delete s.maximum
      if (s.minimum === Number.MIN_SAFE_INTEGER) delete s.minimum

      // zod lists `z.any()` keys as required; a request may leave them out.
      if (request && def.type === 'object' && Array.isArray(s.required)) {
        const shape = def.shape as Record<string, z.ZodType>
        s.required = (s.required as string[]).filter((k) => !omittable(shape[k]))
        if ((s.required as string[]).length === 0) delete s.required
      }
    },
  }) as Json
  delete out.$schema
  return out
}

/** A named schema by reference, anything else written out. */
const schemaFor = (schema: z.ZodType, request: boolean): Json => {
  const name = names.get(schema)
  return name ? ref(name) : jsonSchema(schema, request)
}

const jsonContent = (schema: Json) => ({ 'application/json': { schema } })
const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ref('ErrorBody')),
})

const ALWAYS: Partial<Record<ErrorStatus | 403, string>> = {
  403: 'The Host, Origin or Referer is not allowed. Call from this machine, at an allowed address, without browser headers.',
  500: 'A server fault, or the server is missing a setting (`KINSHIP_OWNER`).',
}

function errorResponses(route: ApiRoute): Record<string, Json> {
  const statuses: Partial<Record<ErrorStatus | 403, string>> = { ...ALWAYS }
  Object.assign(statuses, route.errors)
  if (route.body) {
    const bad = statuses[400]
    if (!bad?.includes('not JSON')) {
      statuses[400] = [bad, 'the body is not valid JSON.'].filter(Boolean).join(' Or: ')
    }
    statuses[415] = 'Content-Type is not `application/json`.'
  }
  return Object.fromEntries(
    Object.entries(statuses)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([status, description]) => [status, errorResponse(description!)]),
  )
}

function parameters(route: ApiRoute): Json[] {
  const inPath = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    description: route.params?.[name],
    schema: { type: 'string' },
  }))
  const inQuery = Object.entries(route.query?.shape ?? {}).map(([name, schema]) => {
    const s = jsonSchema(schema as z.ZodType, true)
    const description = s.description
    delete s.description
    return {
      name,
      in: 'query',
      required: !omittable(schema as z.ZodType),
      ...(description ? { description } : {}),
      schema: s,
    }
  })
  return [...inPath, ...inQuery]
}

function operation(route: ApiRoute): Json {
  if (route.external === 'graph') {
    const op = graphSpec.paths[route.path][route.method]
    return {
      ...op,
      tags: [route.tag],
      responses: {
        ...op.responses,
        ...Object.fromEntries(
          Object.entries(ALWAYS)
            .filter(([status]) => !(status in op.responses))
            .map(([status, description]) => [status, errorResponse(description!)]),
        ),
      },
    }
  }

  const params = parameters(route)
  const body = route.body
    ? { required: true, content: jsonContent(schemaFor(route.body, true)) }
    : route.bodyContent
      ? { required: true, content: route.bodyContent }
      : undefined
  const answers = route.response !== undefined || route.responseContent !== undefined
  const ok: Json = {
    description: 'OK',
    content:
      route.responseContent ?? (answers ? jsonContent(schemaFor(route.response!, false)) : {}),
  }
  if (route.responseHeaders) {
    ok.headers = Object.fromEntries(
      Object.entries(route.responseHeaders).map(([name, description]) => [
        name,
        { description, schema: { type: 'string' } },
      ]),
    )
  }

  return {
    operationId: route.operationId,
    tags: [route.tag],
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: { ...(answers ? { 200: ok } : {}), ...errorResponses(route) },
  }
}

function buildSpec(): Json {
  const paths: Record<string, Record<string, Json>> = {}
  for (const route of routes) {
    paths[route.path] ??= {}
    paths[route.path][route.method] = operation(route)
  }

  const schemas: Record<string, Json> = { ...graphSpec.components.schemas }
  for (const [schema, name] of names) {
    if (name in schemas) throw new Error(`Two schemas are named ${name}`)
    schemas[name] = jsonSchema(schema, name in requestSchemas)
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Kinship API',
      version,
      description:
        'Every route of Kinship, the single-owner relationship notebook. No sign-in: every call acts as the configured owner, and the app answers only on the machine it runs on. Send JSON with `Content-Type: application/json` (photo uploads are multipart). Errors answer `{ error }`, plus `issues` on validation failures. Deletes move records to the trash (`/api/trash` restores them). Generated by `npm run api:spec` from lib/openapi/routes.ts; never edit it by hand.',
    },
    servers: [{ url: 'http://127.0.0.1:3000', description: 'The default local address' }],
    tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({ name })),
    paths,
    components: { schemas },
  }
}

const text = JSON.stringify(buildSpec(), null, 2) + '\n'
if (process.argv.includes('--write')) {
  writeFileSync(path.join(root, OUT), text)
  console.log(`wrote ${OUT}`)
} else {
  process.stdout.write(text)
}
