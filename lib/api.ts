import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ConfigurationError, ConflictError, PayloadTooLargeError, ValidationError } from './errors'

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

/** Next 15+ delivers dynamic route params as a promise. */
export type RouteCtx = { params: Promise<{ id: string }> }
