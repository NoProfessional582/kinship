/**
 * One raster-image policy, shared by the upload route and by archive import.
 *
 * The two used to disagree, and that was K08. `/api/upload` accepted four
 * raster types; archive import accepted **any** bare filename carrying any
 * base64 payload and wrote it into the uploads directory, which this app serves
 * from its own origin. An imported `.html` or `.svg` was therefore live
 * same-origin content — a stored-XSS primitive delivered through a restore.
 *
 * Two rules, and both matter:
 *
 *  1. **Sniff the bytes, never trust the label.** An upload's `file.type` comes
 *     from the client and an archive entry has no type at all, only a filename.
 *     Magic numbers are the only statement about a file that the file itself
 *     makes.
 *  2. **Derive the extension from what the bytes say**, not from the name the
 *     caller supplied. A file called `avatar.png` holding HTML must not be
 *     saved under `.png`, and must not be saved at all.
 *
 * Deliberately not re-encoding. Re-encoding would need an image library in the
 * request path — `sharp` is present here only transitively, through Next, and
 * depending on a transitive dependency is how it disappears under you at the
 * next bump. Sniffing rejects every non-raster payload, which is the property
 * K08 is actually about: nothing reaches the uploads directory that the browser
 * would treat as anything but an image.
 */

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  Buffer.from(bytes.subarray(from, to)).toString('latin1')

export const IMAGE_TYPES = {
  'image/png': {
    ext: 'png',
    matches: (b: Uint8Array) =>
      b.length > 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n',
  },
  'image/jpeg': {
    ext: 'jpg',
    matches: (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/gif': {
    ext: 'gif',
    matches: (b: Uint8Array) =>
      b.length > 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a'),
  },
  'image/webp': {
    ext: 'webp',
    // RIFF....WEBP — the four size bytes in between are not part of the marker.
    matches: (b: Uint8Array) =>
      b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
} as const

export type ImageMime = keyof typeof IMAGE_TYPES

export const ALLOWED_IMAGE_TYPES = Object.keys(IMAGE_TYPES) as ImageMime[]

/** What the bytes actually are, or null for anything not on the list. */
export function sniffImageType(bytes: Uint8Array): ImageMime | null {
  for (const [mime, spec] of Object.entries(IMAGE_TYPES) as [ImageMime, { matches: (b: Uint8Array) => boolean }][]) {
    if (spec.matches(bytes)) return mime
  }
  return null
}

/** The extension this app stores a given image type under. */
export const extensionFor = (mime: ImageMime) => IMAGE_TYPES[mime].ext

/** Human-readable list for error messages. */
export const allowedImageLabel = () => ALLOWED_IMAGE_TYPES.join(', ')
