'use client'
import * as React from 'react'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'

/**
 * A themed hover tooltip anchored to an arbitrary element.
 *
 * Not the native `title` attribute: that cannot be styled, waits about a second
 * before appearing, and renders in the OS chrome rather than the app's palette.
 * Not a Radix popper either — the anchors here are elements FullCalendar owns
 * and re-renders, so the tooltip has to attach to a DOM node handed to it at
 * hover time rather than wrap a child.
 *
 * `strategy: 'fixed'` matters: the time grid and the month popover are both
 * scroll containers with their own clipping, and an absolutely positioned tip
 * would be cut off at their edges.
 */
export function useHoverTip() {
  const [tip, setTip] = React.useState<{ el: HTMLElement; content: React.ReactNode } | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const node = ref.current
    if (!tip || !node) return
    let alive = true
    computePosition(tip.el, node, {
      strategy: 'fixed',
      placement: 'top',
      middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (!alive || !ref.current) return
      ref.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      ref.current.style.opacity = '1'
    })
    return () => {
      alive = false
    }
  }, [tip])

  // Anything that scrolls the anchor out from under the pointer should dismiss
  // it, or the tip hangs in place over unrelated content.
  React.useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('wheel', hide, { passive: true })
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('wheel', hide)
    }
  }, [tip])

  const node = tip ? (
    <div ref={ref} className="kb-tip" role="tooltip">
      {tip.content}
    </div>
  ) : null

  return {
    show: (el: HTMLElement, content: React.ReactNode) => setTip({ el, content }),
    hide: () => setTip(null),
    node,
  }
}
