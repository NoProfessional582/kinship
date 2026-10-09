'use client'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { EntryForm } from '@/components/entity-modal/entry-form'
import { useEntryEdit } from '@/lib/hooks/entry-edit'
import { MSheet, MSheetContent, MSheetTitle, MSheetBody, MSheetFooter, MSheetHeader } from '@/components/mobile/sheet'
import { entryTitle } from '@/lib/utils'

/**
 * Editing an entry on a phone. Same `useEntryEdit` hook as the desktop dialog,
 * including the enrichment hand-off when an edit introduces a new person.
 *
 * Mount it only while it is open: the rich editor takes its content once, at
 * creation, so a sheet kept mounted across opens would show whatever the entry
 * said the first time it was edited.
 */
export function MobileEntryEditSheet({
  entry, open, onOpenChange,
}: {
  entry: any
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { form, setForm, saving, onReady, save } = useEntryEdit(entry, () => onOpenChange(false))

  return (
    <MSheet open={open} onOpenChange={onOpenChange}>
      <MSheetContent tall hideClose>
        <MSheetHeader>
          <MSheetTitle className="truncate text-sm font-semibold">Edit — {entryTitle(entry)}</MSheetTitle>
        </MSheetHeader>
        <MSheetBody className="flex flex-col">
          <EntryForm
            value={form}
            onChange={setForm}
            body={entry.bodyJson}
            onEditorReady={onReady}
            onSubmit={save}
          />
        </MSheetBody>
        <MSheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <span className="flex-1" />
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </MSheetFooter>
      </MSheetContent>
    </MSheet>
  )
}
