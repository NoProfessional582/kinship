import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ownerUploadDir, uploadUrl } from '@/lib/uploads'
import { requireIdentity } from '@/lib/identity'
import {
  ALLOWED_IMAGE_TYPES,
  allowedImageLabel,
  extensionFor,
  sniffImageType,
} from '@/lib/image-types'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_REQUEST_BYTES, readBodyCapped } from '@/lib/body-limit'
import { PayloadTooLargeError } from '@/lib/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED = new Set<string>(ALLOWED_IMAGE_TYPES)
const MAX_BYTES = MAX_UPLOAD_BYTES

/** Contact avatars. Writes into the `uploads` volume mounted by compose. */
export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  // Everything below can throw on a malformed body or a full disk, and an
  // unhandled rejection here reaches the browser as an opaque failure the
  // uploader cannot report.
  //
  // ⚠️ `req.formData()` parses and buffers the WHOLE body before `file.size`
  // below can say anything about it, so that check never bounded allocation —
  // it only decided what to keep. Read the body under a ceiling first and hand
  // formData a body that is already known to be small enough.
  //
  // Reading it ourselves is also what covers a CHUNKED upload, which declares
  // no Content-Length, so a declared-size check alone would never see it.
  let body: ArrayBuffer
  try {
    body = await readBodyCapped(req, MAX_UPLOAD_REQUEST_BYTES)
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    return NextResponse.json({ error: 'Could not read the upload' }, { status: 400 })
  }

  let form: FormData
  try {
    form = await new Response(body, {
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    }).formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the upload' }, { status: 400 })
  }
  const file = form.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 415 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 5 MB' }, { status: 413 })
  }

  // `file.type` is whatever the client said it was. Decide on the bytes instead,
  // and take the extension from them too — the same rule archive import applies,
  // out of the same module, so the two entry points cannot drift apart again
  // (K08). A .png full of HTML is rejected here rather than served back from
  // this app's own origin.
  const bytes = Buffer.from(await file.arrayBuffer())
  const sniffed = sniffImageType(bytes)
  if (!sniffed) {
    return NextResponse.json(
      { error: `That file is not one of: ${allowedImageLabel()}` },
      { status: 415 },
    )
  }
  const name = `${randomUUID()}.${extensionFor(sniffed)}`

  try {
    const directory = ownerUploadDir(owner)
    await mkdir(directory, { recursive: true })
    // The comment keeps the build from following a path it can only know at run
    // time; without it, the build copies the whole project into the image.
    await writeFile(path.join(/*turbopackIgnore: true*/ directory, name), bytes)
  } catch (err) {
    console.error('[upload]', err)
    return NextResponse.json({ error: 'Could not save the file' }, { status: 500 })
  }

  return NextResponse.json({ url: uploadUrl(name) })
}
