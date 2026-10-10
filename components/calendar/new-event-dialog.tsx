'use client'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  EntryForm,
  blankEntry,
  entryToPayload,
  type EntryFormValue,
} from '@/components/entity-modal/entry-form'
import { isoFromDay, toTimed } from '@/components/ui/datetime-field'
import { useTimezone } from '@/lib/hooks/settings'
import { api } from '@/lib/hooks/api'
import { useEnrichmentQueue } from '@/lib/store'
import type { EntrySaved } from '@/lib/api-types'

/**
 * Putting something on the calendar that is not tied to a note.
 *
 * It writes an ordinary `Entry` of kind EVENT — the calendar has no table of
 * its own, it is a merged read over tasks, entries, projects and birthdays, so
 * a new row here would be a new source for the feed, the drag handler, search
 * and the trash to learn. The kind is what separates an appointment from a
 * note, and EntryForm already asks for everything an event needs: a title, a
 * time, a duration, a place, and @mentions for whoever is coming.
 *
 * Mount it only while it is open — the rich editor takes its content once, at
 * creation, so a dialog kept mounted would reopen holding the last event's body.
 */
export function NewEventDialog({
  open,
  onOpenChange,
  day,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The day clicked on the grid, at browser-local midnight. Null means today. */
  day: Date | null
  /** Fired after a successful save, so the grid can pull the feed again. */
  onCreated?: () => void
}) {
  const { timezone } = useTimezone()
  const editorRef = React.useRef<Editor | null>(null)
  const enqueue = useEnrichmentQueue((s) => s.enqueue)
  const qc = useQueryClient()
  const [saving, setSaving] = React.useState(false)

  // 9am on the chosen day, in the *pinned* zone. The day is read off local
  // date parts rather than `toISOString()`: local midnight is the previous
  // day in UTC anywhere east of Greenwich, and slicing that would open the
  // dialog on the wrong date for half the world.
  const [form, setForm] = React.useState<EntryFormValue>(() => {
    const d = day ?? new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return {
      ...blankEntry(),
      kind: 'EVENT',
      occurredAt: toTimed(isoFromDay(ymd), timezone, 9),
    }
  })

  const onReady = React.useCallback((e: Editor) => {
    editorRef.current = e
  }, [])

  const save = async () => {
    if (saving) return
    // An event is named, not written: the body is optional here in a way it is
    // not for a note, so the title alone is enough to save.
    if (!form.title.trim()) {
      toast.error('Give the event a name')
      return
    }
    setSaving(true)
    try {
      const res = await api.post<EntrySaved>(
        '/api/entries',
        entryToPayload(form, editorRef.current?.getJSON() ?? { type: 'doc', content: [] }),
      )
      qc.invalidateQueries()
      onCreated?.()
      onOpenChange(false)
      // An event can introduce a person the same way a note can — "lunch with
      // @Someone new" — so the same enrichment queue picks the drafts up.
      if (res.createdEntities?.length) enqueue(res.createdEntities)
      else toast.success('Event added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Something on the calendar in its own right. Switch the kind above if it turns out to be
            a conversation you want to log instead.
          </DialogDescription>
        </DialogHeader>
        <EntryForm value={form} onChange={setForm} onEditorReady={onReady} onSubmit={save} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
