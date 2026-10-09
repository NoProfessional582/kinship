'use client'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { EntryForm } from '@/components/entity-modal/entry-form'
import { useEntryEdit } from '@/lib/hooks/entry-edit'
import { entryTitle } from '@/lib/utils'

/**
 * Editing an entry after the fact.
 *
 * Mount it only while it is open: the rich editor takes its content once, at
 * creation, so a dialog kept mounted across opens would show whatever the entry
 * said the first time it was edited.
 *
 * The behaviour lives in `useEntryEdit`; this is the desktop container.
 */
export function EntryEditDialog({
  entry, open, onOpenChange,
}: {
  entry: any
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { form, setForm, saving, onReady, save } = useEntryEdit(entry, () => onOpenChange(false))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit entry — {entryTitle(entry)}</DialogTitle>
        </DialogHeader>
        <EntryForm
          value={form}
          onChange={setForm}
          body={entry.bodyJson}
          onEditorReady={onReady}
          onSubmit={save}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
