/**
 * Checks real answers against the API spec (docs/api/kinship.openapi.json): the status is
 * one the operation documents, the media type is the documented one, and a JSON body
 * validates against the documented schema (ajv, JSON Schema 2020-12, which OpenAPI 3.1
 * uses). Each checked answer is counted, so a test can ask which operations were never
 * seen answering 200.
 *
 * Imports nothing from the app (support/stack.ts says why); the spec is read from the repo.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { expect } from '@playwright/test'

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

interface Operation {
  operationId: string
  requestBody?: { content: Record<string, unknown> }
  responses: Record<string, { content?: Record<string, { schema: unknown }> }>
}

export interface Spec {
  info: { version: string }
  paths: Record<string, Partial<Record<Method, Operation>>>
}

export const SPEC_FILE = path.resolve(__dirname, '../../docs/api/kinship.openapi.json')
export const spec = JSON.parse(readFileSync(SPEC_FILE, 'utf8')) as Spec

const SPEC_ID = 'https://kinship.local/openapi.json'
// strict off: the document holds OpenAPI keywords (paths, info, ...) that are not JSON Schema.
const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema(spec, SPEC_ID)

/** A JSON Pointer token: `/api/contacts/{id}` → `~1api~1contacts~1{id}`. */
const token = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1')

const validators = new Map<string, ValidateFunction>()
function validator(pointer: string): ValidateFunction {
  let validate = validators.get(pointer)
  if (!validate) {
    validate = ajv.compile({ $ref: `${SPEC_ID}#${pointer}` })
    validators.set(pointer, validate)
  }
  return validate
}

/** Every operation in the spec, as `METHOD /path`. */
export const operations = Object.entries(spec.paths).flatMap(([p, ops]) =>
  Object.entries(ops).map(([m, op]) => ({ method: m as Method, path: p, op: op as Operation })),
)

/** `METHOD /path status` for every answer checked so far in this worker. */
export const seen = new Set<string>()

/** What the checks need of an answer: Playwright's APIResponse and a page's Response both fit. */
export interface Answer {
  status(): number
  headers(): Record<string, string>
  url(): string
  body(): Promise<Buffer>
}

/**
 * Checks an answer against the spec's operation `method path` (the spec's own path, with
 * `{id}`), and gives the parsed body (the raw bytes when it is not JSON).
 */
export async function conforms<T = unknown>(
  answer: Answer,
  method: Method,
  specPath: string,
): Promise<T> {
  const op = spec.paths[specPath]?.[method]
  expect(op, `${method.toUpperCase()} ${specPath} is in the spec`).toBeTruthy()
  const status = String(answer.status())
  const raw = await answer.body()
  const where = `${method.toUpperCase()} ${answer.url()} answered ${status}`
  const documented = op!.responses[status]
  expect(
    documented,
    `${where}, which the spec does not list: ${raw.toString().slice(0, 300)}`,
  ).toBeTruthy()

  const type = (answer.headers()['content-type'] ?? '').split(';')[0].trim()
  const content = documented!.content ?? {}
  expect(Object.keys(content), `${where} as ${type}`).toContain(type)
  seen.add(`${method.toUpperCase()} ${specPath} ${status}`)
  if (type !== 'application/json') return raw as T

  const body = JSON.parse(raw.toString()) as T
  const pointer = ['', 'paths', specPath, method, 'responses', status, 'content', type, 'schema']
    .map(token)
    .join('/')
  const validate = validator(pointer)
  const ok = validate(body)
  expect(
    ok ? [] : validate.errors!.map((e) => `${e.instancePath || '(body)'} ${e.message}`),
    `${where}: the body against the spec`,
  ).toEqual([])
  return body
}
