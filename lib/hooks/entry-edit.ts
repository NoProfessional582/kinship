'use client'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/core'
import {
  entryFromRecord, entryToPayload, type EntryFormValue,
} from '@/components/entity-modal/entry-form'
import { api } from '@/lib/hooks/api'
import { useEnrichmentQueue } from '@/lib/store'

/**
 * Editing an existing entry: the form value, the editor handle and the save
 * path, without the container around them.
 *
 * The caller still has to mount its container only while it is open — the rich
 * editor takes its content once, at creation, so a dialog or sheet kept mounted
 * across opens would show whatever the entry said the first time it was edited.
 * That constraint belongs to the container, which is why it is not enforced
 * here.
 */
export function useEntryEdit(entry: any, onDone: () => void) {
  const [form, setForm] = React.useState<EntryFormValue>(() => entryFromRecord(entry))
  const [saving, setSaving] = React.useState(false)
  const editorRef = React.useRef<Editor | null>(null)
  const enqueue = useEnrichmentQueue((s) => s.enqueue)
  const qc = useQueryClient()

  const onReady = React.useCallback((e: Editor) => { editorRef.current = e }, [])

  const save = async () => {
    const editor = editorRef.current
    if (!editor || saving) return

    if (editor.getText().trim().length === 0 && !form.title.trim()) {
      toast.error('An entry needs a title or a body')
      return
    }

    setSaving(true)
    try {
      const res = await api.patch<{ entry: any; createdEntities: any[] }>(
        `/api/entries/${entry.id}`,
        entryToPayload(form, editor.getJSON()),
      )
      qc.invalidateQueries()
      onDone()
      // An edit can introduce a person or task the same way capture can, so the
      // same queue picks the new drafts up rather than leaving them bare.
      if (res.createdEntities?.length) enqueue(res.createdEntities)
      else toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return { form, setForm, saving, onReady, save }
}
