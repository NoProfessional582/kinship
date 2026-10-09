/**
 * Every link inside the mobile GUI goes through here.
 *
 * The two GUIs are separate route trees — `app/(desktop)` serves `/board`, and
 * `app/m` serves `/m/board` — so a bare `/board` in a mobile page would drop
 * the reader out of the mobile tree and into the desktop layout, on a phone.
 * Writing mobile pages against this from the first line is free; retrofitting
 * it later would not be.
 */
export function m(path: string): string {
  if (!path.startsWith('/')) return `/m/${path}`
  return path === '/' ? '/m' : `/m${path}`
}
