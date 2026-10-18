import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import {
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from './errors'

/** Every route handler funnels through this so error shapes stay uniform. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn())
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof ConfigurationError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : 'Unexpected error'
    const code = (err as { code?: string })?.code
    if (code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('[api] Unhandled API error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * A request's JSON body. A body that is not JSON (or is empty) is the caller's mistake, so
 * it answers 400 through `handle` instead of the 500 `req.json()`'s SyntaxError became.
 */
export async function readJson(req: Request): Promise<unknown> {
  const raw = await req.text()
  try {
    return JSON.parse(raw)
  } catch {
    throw new ValidationError('The body is not valid JSON.')
  }
}

/** A looked-up record, or a 404 when the lookup found nothing. */
export function found<T>(row: T | null | undefined): T {
  if (row === null || row === undefined) throw new NotFoundError()
  return row
}

/** Next 15+ delivers dynamic route params as a promise. */
export type RouteCtx = { params: Promise<{ id: string }> }
