import { ImageResponse } from 'next/og'

/**
 * The PWA's home-screen icons, drawn rather than shipped as files.
 *
 * `app/icon.svg` already carries the monogram for the browser tab, but a web
 * app manifest wants raster icons at known sizes, and a maskable one has to
 * keep its content inside the middle 80% — Android crops the rest to whatever
 * shape the launcher uses. Generating them here keeps one definition of the
 * mark instead of a checked-in PNG that silently drifts from the SVG.
 *
 * Literal colours, not CSS variables: this renders outside the page, so it
 * cannot see them. They are the light theme's hue-1 and hue-6.
 */
export const dynamic = 'force-static'

export function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }, { size: '512-maskable' }]
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params
  const maskable = size.endsWith('-maskable')
  const n = Number.parseInt(size, 10)
  if (!Number.isFinite(n) || n <= 0 || n > 1024) {
    return new Response('Bad size', { status: 400 })
  }

  // A maskable icon paints to the edges and keeps the glyph in the safe zone;
  // a plain one is the rounded square the rest of the app draws.
  const inset = maskable ? n * 0.22 : n * 0.12
  const glyph = n - inset * 2

  return new ImageResponse(
    <div
      style={{
        width: n,
        height: n,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #bd5b3f, #7a6a86)',
        borderRadius: maskable ? 0 : n * 0.25,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 64 64">
        <path
          d="M21 16 V48 M21 32 L40 16 M21 32 L43 48"
          fill="none"
          stroke="#fff"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    { width: n, height: n },
  )
}
