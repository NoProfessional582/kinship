import { describe, expect, it } from 'vitest'
import { found, handle } from '@/lib/api'
import { NotFoundError } from '@/lib/errors'
import { ApiError, isNotFound, isRetryable } from '@/lib/hooks/api'
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
