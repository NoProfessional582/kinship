/**
 * jsdom implements no layout, so getClientRects/getBoundingClientRect are absent.
 * ProseMirror calls them when a command focuses the editor and tries to scroll
 * the selection into view. These stubs keep that path quiet; nothing under test
 * depends on real geometry.
 *
 * This file is loaded for every spec, including the node-environment ones, so it
 * must no-op when there is no DOM rather than throw on `Element`.
 */
if (typeof globalThis.document !== 'undefined' && typeof globalThis.Element !== 'undefined') {
  const emptyRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect

  const emptyRectList = () => {
    const list: any = [emptyRect()]
    list.item = (i: number) => list[i] ?? null
    return list as DOMRectList
  }

  const protos: any[] = [globalThis.Element.prototype]
  if (typeof globalThis.Range !== 'undefined') protos.push(globalThis.Range.prototype)

  for (const proto of protos) {
    if (typeof proto.getClientRects !== 'function') proto.getClientRects = emptyRectList
    if (typeof proto.getBoundingClientRect !== 'function') proto.getBoundingClientRect = emptyRect
  }

  if (typeof (globalThis as any).DOMRect === 'undefined') {
    ;(globalThis as any).DOMRect = class {
      constructor() {
        return emptyRect()
      }
    }
  }
}
