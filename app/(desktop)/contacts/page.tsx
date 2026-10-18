'use client'
import * as React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Users, Plus, Search, Loader2, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, Avatar, Badge, EmptyState } from '@/components/ui/misc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  ContactForm,
  blankContact,
  contactFromRecord,
  contactToPayload,
  type ContactFormValue,
} from '@/components/entity-modal/contact-form'
import { api, useContacts } from '@/lib/hooks/api'
import { formatDistanceToNowStrict } from 'date-fns'
import type { ContactDossier, ContactSummary } from '@/lib/api-types'

export default function ContactsPage() {
  const [q, setQ] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  /** `{ id: null }` is a new contact; an id is the one being edited. */
  const [editing, setEditing] = React.useState<{ id: string | null; name?: string } | null>(null)
  const [opening, setOpening] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<ContactFormValue>(blankContact())
  const [saving, setSaving] = React.useState(false)
  const qc = useQueryClient()

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200)
    return () => clearTimeout(t)
  }, [q])

  const { data: contacts, isLoading } = useContacts(debounced)

  /**
   * The list rows are a projection — no channels, positions, milestones or
   * links. Seeding the editor from one and saving it would send empty arrays
   * for all of them and delete the rows, so the full record is fetched first.
   */
  const openEditor = async (c: ContactSummary) => {
    setOpening(c.id)
    try {
      const data = await api.get<ContactDossier>(`/api/contacts/${c.id}`)
      setForm(contactFromRecord(data.contact))
      setEditing({ id: c.id, name: data.contact.displayName })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open this contact')
    } finally {
      setOpening(null)
    }
  }

  const submit = async () => {
    if (!form.displayName.trim()) {
      toast.error('A name is required')
      return
    }
    setSaving(true)
    try {
      const payload = contactToPayload(form, false)
      if (editing?.id) await api.patch(`/api/contacts/${editing.id}`, payload)
      else await api.post('/api/contacts', payload)
      qc.invalidateQueries()
      setEditing(null)
      setForm(blankContact())
      toast.success(editing?.id ? 'Contact updated' : 'Contact created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save contact')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-6 lg:px-8">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-4 w-4" /> Contacts
          </h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            {contacts?.length ?? 0} people in your network
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="w-56 pl-8"
          />
        </div>
        <Button
          onClick={() => {
            setForm(blankContact())
            setEditing({ id: null })
          }}
        >
          <Plus className="h-3.5 w-3.5" /> New contact
        </Button>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && (contacts ?? []).length === 0 && (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          hint="Add one here, or just write @Their Name in a note — the app creates them for you."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
        {(contacts ?? []).map((c) => (
          <Card
            key={c.id}
            className="relative h-full p-3.5 transition-colors hover:bg-[var(--muted)]"
          >
            <div className="flex items-start gap-3">
              <Avatar name={c.displayName} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {/* Stretched so the whole tile opens the dossier, while the
                      edit button above it stays independently clickable. */}
                  <Link
                    href={`/contacts/${c.slug}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium after:absolute after:inset-0 after:content-['']"
                  >
                    {c.displayName}
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEditor(c)}
                    disabled={opening === c.id}
                    aria-label={`Edit ${c.displayName}`}
                    title="Edit contact"
                    className="relative z-10 shrink-0 rounded-md p-1 text-[var(--muted-foreground)] opacity-70 transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] hover:opacity-100 focus-visible:opacity-100"
                  >
                    {opening === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <p className="line-clamp-2 text-xs text-[var(--muted-foreground)]">
                  {c.headline ||
                    [c.jobTitle, c.company].filter(Boolean).join(' · ') ||
                    'No details yet'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Badge>{c._count.mentions} interactions</Badge>
                  {c.lastContactAt && (
                    <Badge>{formatDistanceToNowStrict(new Date(c.lastContactAt))} ago</Badge>
                  )}
                  {/* Said in words, the way the dossier and the board say it. A
                      bare pencil here read as an edit button that only some
                      tiles had. */}
                  {c.isDraft && (
                    <Badge className="border-[var(--pending)] text-[var(--pending)]">
                      needs details
                    </Badge>
                  )}
                </div>
                {c.interests?.length > 0 && (
                  <p className="mt-1.5 truncate text-[11px] text-[var(--muted-foreground)] opacity-80">
                    {c.interests.slice(0, 4).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? `Edit contact — ${editing.name ?? ''}` : 'New contact'}
            </DialogTitle>
          </DialogHeader>
          <ContactForm value={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing?.id ? 'Save changes' : 'Create contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
