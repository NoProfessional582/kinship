/** Small files the tests upload. */

/** A real 1×1 PNG (one opaque pixel). */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** A PNG's width and height, from its header. */
export function pngSize(bytes: Buffer) {
  expectPng(bytes)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function expectPng(bytes: Buffer) {
  if (bytes.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') {
    throw new Error('not a PNG')
  }
}
