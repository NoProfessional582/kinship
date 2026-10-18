/**
 * Request-body ceilings, enforced before anything buffers the payload.
 *
 * ⚠️ THE BOUND THAT EXISTS TODAY IS ACCIDENTAL, SILENT, AND NOT OURS.
 * Measured on the dev stack (Next 16.3.3): a 200MB archive POSTed to
 * /api/import comes back "That file is not JSON." — because Next TRUNCATES the
 * body at 10MB and logs `Request body exceeded 10MB for /api/import. Only the
 * first 10MB will be available unless configured.` That is `proxyClientMaxBodySize` (formerly
 * `middlewareClientMaxBodySize`), which applies because this app has a proxy.ts
 * (formerly middleware.ts). So the app was never actually
 * exposed to a 2GB body — but it was relying on a framework default it never
 * asked for, that reports a truncated body as malformed input, and that
 * disappears the moment someone raises that setting or deletes proxy.ts.
 *
 * So the limits here are deliberate, explicit, and stated in the error the
 * caller receives (413, not a confusing 400 about JSON).
 *
 * Sized from the real data rather than guessed: a full export of this database
 * — 205 contacts, 1,275 rows across 19 tables — is 0.45 MiB. Ten megabytes is
 * twenty-two times that.
 */

import { PayloadTooLargeError } from './errors'

/**
 * A whole archive. ~20x the real one (0.45 MiB for 205 contacts, 1,275 rows).
 *
 * ⚠️ THIS MUST STAY STRICTLY BELOW NEXT'S OWN TRUNCATION POINT — that is why it
 * is 9 MiB and not 10. Next truncates the body at 10MB before this route runs.
 * With the cap AT 10MB, a chunked 50MB import arrived already trimmed to
 * exactly 10MB, never exceeded the cap, and came back "That file is not JSON."
 * — the original confusing symptom, reintroduced by the fix for it. Caught by
 * measuring, not by reading the diff. 9 MiB is under either reading of "10MB"
 * (decimal or binary) while giving up as little headroom as possible.
 *
 * ⚠️ KNOWN LIMITATION, PRE-EXISTING AND NOW EXPLICIT: an archive carrying more
 * than this cannot be imported. That was ALREADY true — Next truncated it and
 * the app called it corrupt JSON — so this does not narrow what works, it makes
 * the refusal honest.
 */
export const MAX_ARCHIVE_BYTES = 9 * 1024 * 1024

/**
 * Read a request body with a hard ceiling, streaming.
 *
 * Two gates, because either alone leaves a hole:
 *   1. a declared Content-Length over the cap is refused without reading a
 *      byte — cheap, and an honest oversized client is turned away early;
 *   2. bytes are counted as they actually arrive, which is the ONLY thing that
 *      bounds a chunked request: it declares no length, so gate 1 never fires.
 *
 * Never holds more than `maxBytes` plus one chunk.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declared = req.headers.get('content-length')
  if (declared !== null) {
    const n = Number(declared)
    // A malformed header falls through to the counting gate rather than being
    // trusted or rejected on its own.
    if (Number.isFinite(n) && n > maxBytes) throw new PayloadTooLargeError(maxBytes)
  }

  if (!req.body) return new ArrayBuffer(0)

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) throw new PayloadTooLargeError(maxBytes)
      chunks.push(value)
    }
  } finally {
    // Let go of the socket whether we finished or bailed out early.
    reader.cancel().catch(() => {})
  }

  const out = new ArrayBuffer(total)
  const view = new Uint8Array(out)
  let at = 0
  for (const c of chunks) {
    view.set(c, at)
    at += c.byteLength
  }
  return out
}

/** `readBodyCapped`, decoded as UTF-8. */
export async function readTextCapped(req: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBodyCapped(req, maxBytes))
}
