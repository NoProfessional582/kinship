/**
 * Next.js startup hook. Checks `KINSHIP_OWNER` and constructs the database
 * client when the server starts, so a missing setting stops startup with a
 * clear message instead of failing on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ownerSubject } = await import('./lib/identity')
    ownerSubject()
    await import('./lib/db')
  }
}
