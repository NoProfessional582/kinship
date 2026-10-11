'use client'
/**
 * The selected record's details, in a glass drawer: on the right on a wide screen, a sheet
 * along the bottom on a phone. Each connected record is a button that selects it (the map's
 * orbit moves there); records with a page get an "Open record" link, tags do not.
 *
 * Focus moves to the heading when the drawer opens and when another record is chosen from
 * it, and goes back to what had it before when the drawer closes. Escape closes it (the
 * page listens for that) as does the close button.
 *
 * It tells the page how much of the map it covers (`onCover`), so the map can keep the
 * selected record in the part still showing.
 *
 * Like the rest of the map, it follows the app's theme (graph-overlay.tsx).
 */
import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, X } from 'lucide-react'
import { TYPE_NAMES, type GraphNode } from '@/lib/graph/constants'
import { linkSpeech, linkText, type ConnectionRow } from '@/lib/graph/inspector'

export interface GraphInspectorProps {
  node: GraphNode
  rows: readonly ConnectionRow[]
  /** A connection was chosen: select that record. */
  onSelect: (nodeId: string) => void
  onClose: () => void
  /** CSS pixels of the map it covers on the right and along the bottom; zeros once closed. */
  onCover?: (inset: { right: number; bottom: number }) => void
}

/** The app sets its headings in the display serif; the map's glass panels use the body
 * sans, as the prototype did. A class would lose to that unlayered rule. */
export const BODY_FONT = { fontFamily: 'var(--font-body)' } as const

export function GraphInspector({ node, rows, onSelect, onClose, onCover }: GraphInspectorProps) {
  const heading = React.useRef<HTMLHeadingElement>(null)
  const drawer = React.useRef<HTMLElement>(null)
  const cover = React.useRef(onCover)
  React.useEffect(() => {
    cover.current = onCover
  })

  // A drawer on the right covers its width; a sheet along the bottom, its height.
  React.useLayoutEffect(() => {
    const element = drawer.current
    const map = element?.parentElement
    if (!element || !map) return
    const measure = () => {
      const box = element.getBoundingClientRect()
      const area = map.getBoundingClientRect()
      const sheet = box.left - area.left < 1
      cover.current?.({
        right: sheet ? 0 : Math.max(0, Math.round(area.right - box.left)),
        bottom: sheet ? Math.max(0, Math.round(area.bottom - box.top)) : 0,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(map)
    return () => {
      observer.disconnect()
      cover.current?.({ right: 0, bottom: 0 })
    }
  }, [])
  const headingId = React.useId()

  // Whatever had focus when the drawer opened gets it back when it closes, if it is still
  // on the page (a click on the map leaves it on the body, which needs nothing back).
  React.useEffect(() => {
    const before = document.activeElement
    return () => {
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) {
        before.focus()
      }
    }
  }, [])

  React.useEffect(() => {
    heading.current?.focus()
  }, [node.id])

  return (
    <section
      ref={drawer}
      aria-labelledby={headingId}
      data-testid="map-inspector"
      data-map-chrome
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col gap-4 rounded-t-xl border border-(--line) dark:border-white/10 bg-(--panel)/95 dark:bg-slate-900/80 p-4 text-(--ink-raw) dark:text-slate-200 shadow-2xl backdrop-blur-md sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:max-h-none sm:w-[350px] sm:rounded-xl sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            // By day the type's colour is only the tint: amber or green letters on paper
            // would be too faint to read.
            className="mb-1.5 inline-block rounded px-2 py-0.5 text-[10px] font-bold tracking-wider text-(--ink-raw) uppercase dark:text-(--chip)"
            style={{ '--chip': node.color, background: `${node.color}22` } as React.CSSProperties}
          >
            {TYPE_NAMES[node.type]}
          </span>
          <h2
            id={headingId}
            ref={heading}
            tabIndex={-1}
            style={BODY_FONT}
            className="text-xl leading-tight font-bold break-words text-(--ink-raw) dark:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--terracotta) dark:focus-visible:outline-sky-400"
          >
            {node.name}
          </h2>
          {node.subtitle && (
            <p className="mt-0.5 text-sm text-(--muted-raw) dark:text-slate-400">{node.subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          title="Close (Esc)"
          className="shrink-0 rounded-md p-1.5 text-(--muted-raw) dark:text-slate-400 hover:bg-(--ink-raw)/[0.07] dark:hover:bg-white/10 hover:text-(--ink-raw) dark:hover:text-white focus-visible:ring-2 focus-visible:ring-(--terracotta) dark:focus-visible:ring-sky-400 focus-visible:outline-none"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {node.description && (
        <p className="rounded-lg border border-(--line)/60 dark:border-white/5 bg-(--ink-raw)/[0.03] dark:bg-white/[0.03] p-3 text-sm leading-normal text-(--ink-raw)/85 dark:text-slate-300">
          {node.description}
        </p>
      )}

      {node.url !== null && (
        <Link
          href={node.url}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-(--line) dark:border-white/15 px-2.5 py-1.5 text-xs font-medium text-(--terracotta-dark) dark:text-sky-200 hover:bg-(--ink-raw)/[0.07] dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--terracotta) dark:focus-visible:ring-sky-400 focus-visible:outline-none"
        >
          Open record
          <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h3
          style={BODY_FONT}
          className="text-[11px] font-bold tracking-wide text-(--muted-raw) dark:text-slate-400 uppercase"
        >
          Connections ({rows.length})
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-(--muted-raw) dark:text-slate-400">No direct connections.</p>
        ) : (
          <ul className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 pb-1">
            {rows.map(({ node: other, links }) => (
              <li key={other.id}>
                <button
                  type="button"
                  onClick={() => onSelect(other.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-(--line)/60 dark:border-white/5 bg-(--ink-raw)/[0.04] dark:bg-white/[0.04] px-3 py-2 text-left hover:bg-(--ink-raw)/[0.07] dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--terracotta) dark:focus-visible:ring-sky-400 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: other.color, boxShadow: `0 0 8px ${other.color}` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-(--ink-raw) dark:text-white">
                      {other.name}
                      <span className="sr-only">, {TYPE_NAMES[other.type]}</span>
                    </span>
                    {links.map((link) => (
                      <span
                        key={link.id}
                        className="block truncate text-[11px] text-(--muted-raw) dark:text-slate-400"
                      >
                        <span aria-hidden>{linkText(link)}</span>
                        <span className="sr-only">: {linkSpeech(link)}</span>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
