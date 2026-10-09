'use client'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/core'
import { entryKind } from '@/components/entity-modal/entry-form'
import { api, useProjects } from '@/lib/hooks/api'
import { useEnrichmentQueue } from '@/lib/store'
import { useTimezone } from '@/lib/hooks/settings'
import { collectDocRefs } from '@/lib/tiptap/doc'
import { fromLocalInputValue, toLocalInputValue } from '@/lib/format'

/**
 * A `datetime-local` carries no zone. Seeded from `getTimezoneOffset` and read
 * back with `new Date(value)` it silently means *browser* time — so a user who
 * pins a zone in settings types 2:30pm, sees "2:30pm" everywhere it is rendered
 * back in that zone, and has actually stored something else. Both directions go
 * through the app's zone instead.
 */

interface Draft {
  kind: string
  title: string
  occurredAt: string
  direction: '' | 'INBOUND' | 'OUTBOUND'
  durationMin: string
  location: string
  followUpAt: string
  projectId: string
  tags: string[]
  body: unknown
}

/**
 * The composer's own draft store. Capture is the one thing in the app you can
 * lose by closing a card, so what is half-written survives a reload — and the
 * footer says so, rather than leaving you to guess.
 *
 * One key, deliberately: capture is one surface wherever it appears, so a note
 * started on the dashboard is waiting on the notes page and the other way
 * round — and now, on the phone as well. The key keeps the name it had when the
 * dark card was a "hero" variant, so drafts written before then still restore.
 */
const store = (() => {
  const k = 'kb.composer.hero'
  return {
    read(): Draft | null {
      if (typeof window === 'undefined') return null
      try { return JSON.parse(window.localStorage.getItem(k) ?? 'null') } catch { return null }
    },
    write(d: Draft) {
      try { window.localStorage.setItem(k, JSON.stringify(d)) } catch { /* private mode */ }
    },
    clear() {
      try { window.localStorage.removeItem(k) } catch { /* private mode */ }
    },
  }
})()

const isEmptyDoc = (doc: any) =>
  !doc?.content?.length ||
  (doc.content.length === 1 && !doc.content[0].content?.length)

/**
 * Capture, without a surface. The desktop card and the mobile sheet lay these
 * fields out very differently but agree about all of the behaviour: the draft
 * that survives a reload, the zone-aware date, which fields a given kind even
 * has, and what a save posts.
 *
 * Keeping the ENTRY_KINDS `comms`/`slot` reading in one place matters more here
 * than anywhere else in the app — those two flags already have two independent
 * readers in `EntryForm` and this composer, and a third would make the next
 * kind added a three-way bug that typechecks clean.
 */
export function useComposer(onSaved?: () => void) {
  // The card opens as a question with a single line to click. Expanding is what
  // reveals the form, so the page is about what happened rather than about a
  // form.
  const [open, setOpen] = React.useState(false)
  const [restored, setRestored] = React.useState<Draft | null>(null)
  const [hasDraft, setHasDraft] = React.useState(false)

  const [kind, setKind] = React.useState<string>('NOTE')
  const [title, setTitle] = React.useState('')
  const [occurredAt, setOccurredAt] = React.useState('')
  const [direction, setDirection] = React.useState<'INBOUND' | 'OUTBOUND' | ''>('')
  const [durationMin, setDurationMin] = React.useState('')
  const [location, setLocation] = React.useState('')
  const [followUpAt, setFollowUpAt] = React.useState('')
  const [projectId, setProjectId] = React.useState('')
  const [tags, setTags] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  /** Bumped on every editor transaction, purely to re-arm the draft debounce. */
  const [bodyRev, setBodyRev] = React.useState(0)

  const { timezone } = useTimezone()
  const { data: projects } = useProjects()

  // Re-seeds whenever the zone changes, but never over a date someone chose.
  // "Fill it once if blank" is not enough: useTimezone answers 'UTC' until the
  // settings query lands, so the first render would stamp a UTC wall time into
  // the field and the real zone would arrive too late to correct it.
  const dateTouched = React.useRef(false)
  React.useEffect(() => {
    if (dateTouched.current) return
    setOccurredAt(toLocalInputValue(new Date(), timezone))
  }, [timezone])
  const editorRef = React.useRef<Editor | null>(null)
  const enqueue = useEnrichmentQueue((s) => s.enqueue)
  const qc = useQueryClient()

  const active = entryKind(kind)
  const onReady = React.useCallback((e: Editor) => { editorRef.current = e }, [])

  // Any stored draft is pulled in before the editor mounts, so its content can
  // be handed over as initial content rather than pushed in afterwards.
  React.useEffect(() => {
    const d = store.read()
    if (!d) return
    setRestored(d)
    setHasDraft(true)
    setKind(d.kind); setTitle(d.title)
    if (d.occurredAt) { dateTouched.current = true; setOccurredAt(d.occurredAt) }
    setDirection(d.direction); setDurationMin(d.durationMin)
    setLocation(d.location); setTags(d.tags)
    setFollowUpAt(d.followUpAt ?? ''); setProjectId(d.projectId ?? '')
    setOpen(true)
  }, [])

  const persist = React.useCallback(() => {
    const doc = editorRef.current?.getJSON()
    const empty = isEmptyDoc(doc) && !title.trim() && tags.length === 0
    if (empty) { store.clear(); setHasDraft(false); return }
    store.write({ kind, title, occurredAt, direction, durationMin, location, followUpAt, projectId, tags, body: doc })
    setHasDraft(true)
  }, [kind, title, occurredAt, direction, durationMin, location, followUpAt, projectId, tags])

  // Debounced so a fast typist is not writing to localStorage per keystroke.
  React.useEffect(() => {
    if (!open) return
    const t = setTimeout(persist, 500)
    return () => clearTimeout(t)
  }, [open, persist, bodyRev])

  const reset = () => {
    editorRef.current?.commands.clearContent()
    setKind('NOTE'); setTitle(''); setDurationMin(''); setLocation(''); setDirection('')
    setFollowUpAt(''); setProjectId('')
    setTags([]); dateTouched.current = false
    setOccurredAt(toLocalInputValue(new Date(), timezone))
    setRestored(null)
    store.clear()
    setHasDraft(false)
  }

  const save = async () => {
    const editor = editorRef.current
    if (!editor || saving) return

    const doc = editor.getJSON()
    const refs = collectDocRefs(doc as any)

    if (editor.getText().trim().length === 0 && !title.trim()) {
      toast.error('Write something first')
      return
    }

    setSaving(true)
    try {
      const res = await api.post<{ entry: any; createdEntities: any[] }>('/api/entries', {
        kind,
        title: title.trim() || null,
        bodyJson: doc,
        occurredAt: (fromLocalInputValue(occurredAt, timezone) ?? new Date()).toISOString(),
        direction: active.comms && direction ? direction : null,
        durationMin: active.slot && durationMin ? Number(durationMin) : null,
        location: location.trim() || null,
        followUpAt: fromLocalInputValue(followUpAt, timezone)?.toISOString() ?? null,
        projectId: projectId || null,
        tags,
        pendingEntities: refs.pending,
      })

      // Clear the composer before the modal opens so the queue is the only focus.
      reset()
      setOpen(false)

      qc.invalidateQueries()

      if (res.createdEntities.length > 0) {
        enqueue(res.createdEntities)
      } else {
        toast.success('Saved')
      }
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return {
    open, setOpen, restored, hasDraft, setHasDraft,
    kind, setKind, title, setTitle, occurredAt, setOccurredAt, dateTouched,
    direction, setDirection, durationMin, setDurationMin,
    location, setLocation, followUpAt, setFollowUpAt,
    projectId, setProjectId, tags, setTags,
    saving, setBodyRev, active, onReady, reset, save,
    projects, timezone,
  }
}
