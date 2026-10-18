/**
 * Single-user gate. Kinship has no sign-in: everything acts as the owner named
 * by `KINSHIP_OWNER` (lib/identity.ts), and no request header can change that.
 *
 * ⚠️ WITH NO SIGN-IN, ANYONE WHO CAN REACH THE APP HAS FULL ACCESS. Publish its
 * port on 127.0.0.1 only; never expose it to a network.
 *
 * The request policy rejects foreign origins, unexpected hosts and unsafe
 * media types. It also refuses every page and API call, saying what
 * to fix, when `KINSHIP_OWNER` is missing.
 *
 * `proxy` is Next.js 16's name for middleware; it runs in the Node.js runtime.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ownerSubject } from './lib/identity'
import { requestRefusal } from './lib/request-security'

export function proxy(req: NextRequest) {
  try {
    ownerSubject()
    const refusal = requestRefusal(req)
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|favicon.ico|icon.svg|manifest.webmanifest|desktop.webmanifest).*)'],
}
