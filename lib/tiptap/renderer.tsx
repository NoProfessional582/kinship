'use client'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { computePosition, flip, shift, offset, type VirtualElement } from '@floating-ui/dom'
import type { SuggestionOptions } from '@tiptap/suggestion'
import {
  SuggestionList,
  type SuggestionItem,
  type SuggestionListHandle,
} from '@/components/editor/suggestion-list'

/**
 * Mounts the shared dropdown for a TipTap suggestion plugin and keeps it pinned
 * to the caret with floating-ui. Used by both the `@` and `[[` extensions.
 *
 * An editor inside a dialog or sheet gets its dropdown inside that dialog. A
 * modal Radix dialog turns pointer events off everywhere else on the page and
 * closes on a press outside itself, so a dropdown on `document.body` showed
 * over the phone's capture sheet but could not be tapped. Inside the dialog,
 * flip and shift keep it within the dialog's visible area.
 */
export function createSuggestionRenderer(): SuggestionOptions<SuggestionItem>['render'] {
  return () => {
    let container: HTMLDivElement | null = null
    let root: Root | null = null
    const handleRef = React.createRef<SuggestionListHandle>()
    let latestItems: SuggestionItem[] = []

    const position = (clientRect: (() => DOMRect | null) | null | undefined) => {
      if (!container || !clientRect) return
      const virtual: VirtualElement = {
        getBoundingClientRect: () => clientRect() ?? new DOMRect(0, 0, 0, 0),
      }
      computePosition(virtual, container, {
        placement: 'bottom-start',
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (!container) return
        Object.assign(container.style, { left: `${x}px`, top: `${y}px` })
      })
    }

    const render = (props: {
      items: SuggestionItem[]
      command: (item: SuggestionItem) => void
    }) => {
      latestItems = props.items
      root?.render(
        <SuggestionList
          ref={handleRef}
          items={props.items}
          loading={false}
          command={props.command}
        />,
      )
    }

    return {
      onStart: (props) => {
        container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.zIndex = '60'
        container.style.top = '0'
        container.style.left = '0'
        const host = props.editor.view.dom.closest('[role="dialog"]') ?? document.body
        host.appendChild(container)
        root = createRoot(container)
        render(props)
        position(props.clientRect)
      },
      onUpdate: (props) => {
        render(props)
        position(props.clientRect)
      },
      onKeyDown: (props) => {
        if (props.event.key === 'Escape') return false
        if (latestItems.length === 0) return false
        return handleRef.current?.onKeyDown(props.event) ?? false
      },
      onExit: () => {
        // Defer unmount: React refuses to unmount a root synchronously from
        // inside a render/commit, which is where ProseMirror calls onExit.
        const r = root
        const c = container
        root = null
        container = null
        queueMicrotask(() => {
          r?.unmount()
          c?.remove()
        })
      },
    }
  }
}
