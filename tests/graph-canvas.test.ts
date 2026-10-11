/** The map canvas's WebGL probe, which decides between the 3D map and the record list. */
import { describe, expect, it, vi } from 'vitest'
import { webglAvailable } from '@/components/graph/graph-canvas'

/** A document whose canvases answer getContext with `answer`. */
const documentWith = (answer: (kind: string) => unknown) =>
  ({ createElement: () => ({ getContext: answer }) }) as unknown as Document

describe('webglAvailable', () => {
  it('is true when WebGL 2 starts, and frees the probe context', () => {
    const loseContext = vi.fn()
    const gl = { getExtension: () => ({ loseContext }) }
    expect(webglAvailable(documentWith((kind) => (kind === 'webgl2' ? gl : null)))).toBe(true)
    expect(loseContext).toHaveBeenCalledOnce()
  })

  it('falls back to WebGL 1', () => {
    const gl = { getExtension: () => null }
    expect(webglAvailable(documentWith((kind) => (kind === 'webgl' ? gl : null)))).toBe(true)
  })

  it('is false when no WebGL context can be made', () => {
    expect(webglAvailable(documentWith(() => null))).toBe(false)
  })

  it('is false when asking throws', () => {
    expect(
      webglAvailable(
        documentWith(() => {
          throw new Error('blocked')
        }),
      ),
    ).toBe(false)
  })
})
