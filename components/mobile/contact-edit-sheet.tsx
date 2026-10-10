'use client'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ContactForm,
  contactFromRecord,
  contactToPayload,
  type ContactFormValue,
} from '@/components/entity-modal/contact-form'
import {
  MSheet,
  MSheetContent,
  MSheetTitle,
  MSheetBody,
  MSheetFooter,
  MSheetHeader,
} from '@/components/mobile/sheet'
import { api } from '@/lib/hooks/api'
import type { ContactRecord } from '@/lib/api-types'

/**
 * Editing a person on a phone. The form itself is the shared `ContactForm` —
 * channels, positions, attributes and the avatar upload all behave identically
 * on both GUIs, and re-describing those fields here is exactly the divergence
 * the split is meant to avoid. Only the container is different.
 */
export function MobileContactEditSheet({
  contact,
  open,
  onOpenChange,
}: {
  contact: ContactRecord
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = React.useState<ContactFormValue>(() => contactFromRecord(contact))
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    setSaving(true)
    try {
      // One call: the payload carries the attribute rows, so this does not have
      // to be paired with a PUT to /attributes the way it once did.
      await api.patch(`/api/contacts/${contact.id}`, contactToPayload(form, false))
      qc.invalidateQueries()
      onOpenChange(false)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <MSheet open={open} onOpenChange={onOpenChange}>
      <MSheetContent tall hideClose>
        <MSheetHeader>
          <MSheetTitle className="text-sm font-semibold">Edit {contact.displayName}</MSheetTitle>
        </MSheetHeader>
        <MSheetBody>
          <ContactForm value={form} onChange={setForm} />
        </MSheetBody>
        <MSheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <span className="flex-1" />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </MSheetFooter>
      </MSheetContent>
    </MSheet>
  )
}
