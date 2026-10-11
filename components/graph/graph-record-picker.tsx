'use client'
/**
 * The "Records" button and the list it opens: every record on the map, grouped by type and
 * filtered by name as you type. Choosing one selects it, so the map can be explored without
 * a pointer. Enter in the filter chooses the first match.
 *
 * The list is a native modal dialog: it holds focus while open, and Escape closes it
 * without reaching the page (which would clear the selection).
 */
import * as React from 'react'
import { ListTree, X } from 'lucide-react'
import { GRAPH_COLORS, type GraphNode } from '@/lib/graph/constants'
import { TYPE_HEADINGS, groupRecords } from './graph-states'

export interface GraphRecordPickerProps {
  nodes: readonly GraphNode[]
  onSelect: (nodeId: string) => void
  /** The trigger's classes, so it matches the overlay's buttons. */
  className: string
}

/** Case and accents don't matter. */
const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()

export function GraphRecordPicker({ nodes, onSelect, className }: GraphRecordPickerProps) {
  const dialog = React.useRef<HTMLDialogElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const titleId = React.useId()

  const groups = React.useMemo(() => {
    const wanted = fold(filter.trim())
    const shown = wanted ? nodes.filter((node) => fold(node.name).includes(wanted)) : nodes
    return groupRecords(shown)
  }, [nodes, filter])
  const matches = groups.reduce((sum, group) => sum + group.nodes.length, 0)

  const show = () => {
    setFilter('')
    setOpen(true)
    dialog.current?.showModal()
    input.current?.focus()
  }
  const close = () => {
    dialog.current?.close()
  }
  const choose = (id: string) => {
    close()
    // Back on the trigger first, so the inspector that opens next returns focus here.
    trigger.current?.focus()
    onSelect(id)
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
      >
        <ListTree aria-hidden className="h-3.5 w-3.5" />
        Records
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        data-testid="map-record-picker"
        onClose={() => {
          setOpen(false)
          // The close event comes a moment later: by then a chosen record's inspector may
          // have taken focus, which it keeps.
          const active = document.activeElement
          if (!active || active === document.body || dialog.current?.contains(active)) {
            trigger.current?.focus()
          }
        }}
        onKeyDown={(event) => {
          // The dialog closes itself; the page's Escape (clear the selection) must not run.
          if (event.key === 'Escape') event.stopPropagation()
        }}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog itself.
          if (event.target === event.currentTarget) close()
        }}
        className="m-auto max-h-[min(36rem,85vh)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900 p-0 text-slate-200 shadow-2xl backdrop:bg-black/60 open:flex"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-3">
          <h2 id={titleId} className="text-sm font-semibold text-white">
            Records
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close records"
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-white/10 p-3">
          <input
            ref={input}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              const first = groups[0]?.nodes[0]
              if (event.key === 'Enter' && first) {
                event.preventDefault()
                choose(first.id)
              }
            }}
            aria-label="Filter records by name"
            aria-describedby={`${titleId}-count`}
            placeholder="Filter by name"
            className="w-full rounded-md border border-white/15 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
          />
          <p id={`${titleId}-count`} aria-live="polite" className="mt-1.5 text-xs text-slate-400">
            {matches === 1 ? '1 record' : `${matches} records`}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {groups.map(({ type, nodes: group }) => (
            <section key={type} aria-labelledby={`${titleId}-${type}`} className="mb-4 last:mb-0">
              <h3
                id={`${titleId}-${type}`}
                className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-300"
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: GRAPH_COLORS[type] }}
                />
                {TYPE_HEADINGS[type]} <span className="text-slate-500">({group.length})</span>
              </h3>
              <ul className="space-y-0.5">
                {group.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => choose(node.id)}
                      className="w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
                    >
                      {node.name}
                      {node.subtitle && (
                        <span className="ml-2 text-xs text-slate-500">{node.subtitle}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
    </>
  )
}
