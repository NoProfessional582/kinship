import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Health check for compose (`web.healthcheck` in compose.yaml): healthy when the
 * server answers and so does the database. Returns no data.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[health] database unreachable:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
