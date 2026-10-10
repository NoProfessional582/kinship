import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { found, handle } from '@/lib/api'
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
})
