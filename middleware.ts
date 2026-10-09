/**
 * Single-user gate. Kinship has no sign-in: everything acts as the owner named
 * by `KINSHIP_OWNER` (lib/identity.ts), and no request header can change that.
 *
 * ⚠️ WITH NO SIGN-IN, ANYONE WHO CAN REACH THE APP HAS FULL ACCESS. Publish its
 * port on 127.0.0.1 only; never expose it to a network.
 *
 * All this does is refuse every page and API call, with a message saying what
 * to fix, when `KINSHIP_OWNER` is missing. That covers `/uploads/*` too, which
 * is served by a route handler and returns real user data.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { ownerSubject } from './lib/identity'

export function middleware(_req: NextRequest) {
  try {
    ownerSubject()
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)'],
}
