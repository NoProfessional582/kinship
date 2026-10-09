'use client'
import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { renderEntryHtml } from '@/lib/tiptap/render'
import { cn } from '@/lib/utils'

/**
 * Read-only entry content. Compact mode clamps the height and fades the cut
 * rather than dropping the formatting, so a list still looks like a list in the
 * activity feed — but the clamp is now a fold, not a wall: anything that
 * actually overflows gets a toggle that opens it in place. Reading the rest of
 * a note on a dossier should not cost you the dossier.
 */
export function EntryBody({ doc, compact }: { doc: any; compact?: boolean }) {
  const html = React.useMemo(() => renderEntryHtml(doc), [doc])
  const ref = React.useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)
  React.useEffect(() => {
    openRef.current = open
  }, [open])

  React.useEffect(() => {
    const el = ref.current
    if (!el || !compact) return
    // Only measure while folded. Open, scrollHeight equals clientHeight and we
    // would conclude there was never anything to show — taking the toggle away
    // mid-read.
    const measure = () => {
      if (!openRef.current) setClipped(el.scrollHeight - el.clientHeight > 4)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [compact, html])

  if (!html) return null

  return (
    <>
      <div
        ref={ref}
        className={cn('kb-prose text-sm', compact && !open && 'kb-prose-clamp')}
        data-clipped={compact && !open && clipped ? 'true' : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {compact && clipped && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {open ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Show more
            </>
          )}
        </button>
      )}
    </>
  )
}
