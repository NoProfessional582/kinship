import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { found, handle, readJson } from '@/lib/api'
import { NotFoundError } from '@/lib/errors'
import { ApiError, isNotFound, isRetryable, refreshAfterDelete } from '@/lib/hooks/api'
import { edgeListSchema } from '@/lib/validation'

describe('a missing record', () => {
  it('passes a found record through, and turns null or undefined into NotFoundError', () => {
    const row = { id: 'a' }
    expect(found(row)).toBe(row)
    expect(() => found(null)).toThrow(NotFoundError)
    expect(() => found(undefined)).toThrow(NotFoundError)
  })

  it('answers 404 with the usual error shape', async () => {
    const response = await handle(async () => found(null))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('still answers a found record with 200', async () => {
    const response = await handle(async () => found({ id: 'a' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'a' })
  })
})

describe('a body that is not JSON', () => {
  const post = (body: string) => new Request('http://x/api', { method: 'POST', body })

  it('reads a JSON body', async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 })
  })

  it('answers 400, not a server fault, for broken or empty JSON', async () => {
    for (const body of ['{"a":', 'not json', '']) {
      const response = await handle(async () => readJson(post(body)))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'The body is not valid JSON.' })
    }
  })
})

describe('the pages’ reading of a refusal', () => {
  it('knows a 404 as not found, and nothing else', () => {
    expect(isNotFound(new ApiError('Not found', 404))).toBe(true)
    expect(isNotFound(new ApiError('Validation failed', 400))).toBe(false)
    expect(isNotFound(new ApiError('Boom', 500))).toBe(false)
    expect(isNotFound(new Error('Not found'))).toBe(false)
  })

  it('asks again after a fault, never after a refusal', () => {
    expect(isRetryable(new ApiError('Not found', 404))).toBe(false)
    expect(isRetryable(new ApiError('Validation failed', 400))).toBe(false)
    expect(isRetryable(new ApiError('Boom', 500))).toBe(true)
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('edgeListSchema', () => {
  it('defaults the type to contact and needs an id', () => {
    expect(edgeListSchema.parse({ id: 'x' })).toEqual({ type: 'contact', id: 'x' })
    expect(() => edgeListSchema.parse({ type: 'contact', id: '' })).toThrow()
  })

  it('refuses a type that names no kind of record', () => {
    expect(() => edgeListSchema.parse({ type: 'bogus', id: 'x' })).toThrow()
    expect(() => edgeListSchema.parse({ type: '', id: 'x' })).toThrow()
  })
})

describe('refreshAfterDelete', () => {
  it('refetches every other open query, never the deleted record', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const asked: Record<string, number> = {}
    const open = (key: string[]) =>
      new QueryObserver(qc, {
        queryKey: key,
        queryFn: async () => {
          asked[key.join('/')] = (asked[key.join('/')] ?? 0) + 1
          return key
        },
      }).subscribe(() => {})
    const close = [open(['entry', 'gone']), open(['entry', 'other']), open(['board', 'all'])]
    await vi.waitFor(() =>
      expect(
        qc
          .getQueryCache()
          .getAll()
          .map((q) => q.state.status),
      ).toEqual(['success', 'success', 'success']),
    )

    await refreshAfterDelete(qc, ['entry', 'gone'])
    expect(asked).toEqual({ 'entry/gone': 1, 'entry/other': 2, 'board/all': 2 })
    expect(qc.getQueryState(['entry', 'gone'])?.isInvalidated).toBe(true)
    close.forEach((unsubscribe) => unsubscribe())
  })

  it('leaves every query about the record alone, such as its mini-map', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const asked: Record<string, number> = {}
    const open = (key: string[]) =>
      new QueryObserver(qc, {
        queryKey: key,
        queryFn: async () => {
          asked[key.join(' ')] = (asked[key.join(' ')] ?? 0) + 1
          return key
        },
      }).subscribe(() => {})
    const mini = ['graph', '/api/graph?focusId=contact%3Agone&depth=2']
    const close = [open(['contact', 'gone']), open(mini), open(['graph', '/api/graph'])]
    await vi.waitFor(() =>
      expect(
        qc
          .getQueryCache()
          .getAll()
          .map((q) => q.state.status),
      ).toEqual(['success', 'success', 'success']),
    )

    await refreshAfterDelete(qc, ['contact', 'gone'], mini)
    expect(asked).toEqual({ 'contact gone': 1, [mini.join(' ')]: 1, 'graph /api/graph': 2 })
    expect(qc.getQueryState(mini)?.isInvalidated).toBe(true)
    close.forEach((unsubscribe) => unsubscribe())
  })
})
