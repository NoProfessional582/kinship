'use client'
import * as React from 'react'
import type { Editor } from '@tiptap/core'
import {
  NotebookPen,
  Phone,
  Mail,
  MessageSquare,
  Users,
  Handshake,
  AtSign,
  CalendarDays,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react'
import { RichEditor } from '@/components/editor/editor'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { ChipsInput } from '@/components/ui/chips'
import { DateTimeField } from '@/components/ui/datetime-field'
import { Field } from './contact-form'
import { useProjects } from '@/lib/hooks/api'
import { collectDocRefs } from '@/lib/tiptap/doc'
import { cn } from '@/lib/utils'

/**
 * The one list of entry kinds, shared by capture and editing. Two copies would
 * be two answers to "is this kind a communication?", and those flags are what
 * decide which fields are even askable.
 *
 * Two flags, not one. `comms` asks "was this an exchange with someone?" and
 * governs direction — inbound/outbound only means something when there is
 * another party. `slot` asks "did this occupy time and a place?" and governs
 * duration and location. They coincided for every kind until EVENT, which
 * takes up an afternoon and happens somewhere but has nobody on the other end
 * of it: a dentist appointment is not inbound or outbound.
 */
export const ENTRY_KINDS = [
  { value: 'NOTE', label: 'Note', icon: NotebookPen, comms: false, slot: false },
  { value: 'IN_PERSON', label: 'In person', icon: Handshake, comms: true, slot: true },
  { value: 'MEETING', label: 'Meeting', icon: Users, comms: true, slot: true },
  { value: 'CALL', label: 'Call', icon: Phone, comms: true, slot: true },
  { value: 'EMAIL', label: 'Email', icon: Mail, comms: true, slot: true },
  { value: 'TEXT', label: 'Text', icon: MessageSquare, comms: true, slot: true },
  { value: 'SOCIAL', label: 'Social media', icon: AtSign, comms: true, slot: true },
  { value: 'EVENT', label: 'Event', icon: CalendarDays, comms: false, slot: true },
] as const

export const entryKind = (value: string) =>
  ENTRY_KINDS.find((k) => k.value === value) ?? ENTRY_KINDS[0]

export interface EntryFormValue {
  kind: string
  title: string
  /** Canonical ISO instants; `DateTimeField` converts for display. */
  occurredAt: string
  /**
   * The date of the *linked* follow-up note, not a column on this entry.
   * Setting it creates that note, moving it reschedules it, and clearing it
   * withdraws the promise — but only while nothing has been written into it.
   */
  followUpAt: string
  direction: '' | 'INBOUND' | 'OUTBOUND'
  durationMin: string
  location: string
  projectId: string
  tags: string[]
}

export function blankEntry(): EntryFormValue {
  return {
    kind: 'NOTE',
    title: '',
    occurredAt: new Date().toISOString(),
    followUpAt: '',
    direction: '',
    durationMin: '',
    location: '',
    projectId: '',
    tags: [],
  }
}

export function entryFromRecord(e: any): EntryFormValue {
  return {
    kind: e.kind ?? 'NOTE',
    title: e.title ?? '',
    occurredAt: e.occurredAt ? new Date(e.occurredAt).toISOString() : new Date().toISOString(),
    // Seeded from the linked note, which is where the date now lives.
    followUpAt: e.followUp?.occurredAt ? new Date(e.followUp.occurredAt).toISOString() : '',
    direction: e.direction ?? '',
    durationMin: e.durationMin == null ? '' : String(e.durationMin),
    location: e.location ?? '',
    projectId: e.projectId ?? e.project?.id ?? '',
    tags: (e.tags ?? []).map((t: any) => t.tag?.name ?? t),
  }
}

/**
 * Serializes to the shape `updateEntrySchema` expects.
 *
 * `pendingEntities` is read back off the document rather than tracked
 * alongside it: an edit can introduce an inline @person exactly the way a first
 * save can, and the server needs the label to create the row.
 */
export function entryToPayload(v: EntryFormValue, doc: unknown) {
  const { comms, slot } = entryKind(v.kind)
  return {
    kind: v.kind,
    title: v.title.trim() || null,
    bodyJson: doc,
    occurredAt: v.occurredAt || new Date().toISOString(),
    direction: comms && v.direction ? v.direction : null,
    durationMin: slot && v.durationMin ? Number(v.durationMin) : null,
    location: v.location.trim() || null,
    followUpAt: v.followUpAt || null,
    projectId: v.projectId || null,
    tags: v.tags,
    pendingEntities: doc ? collectDocRefs(doc as any).pending : [],
  }
}

/**
 * Every field of an entry except the body's own state: the editor is
 * uncontrolled, so `body` seeds it once and `onEditorReady` hands the instance
 * back for the caller to read at save time.
 */
export function EntryForm({
  value,
  onChange,
  body,
  onEditorReady,
  onSubmit,
}: {
  value: EntryFormValue
  onChange: (v: EntryFormValue) => void
  body?: unknown
  onEditorReady?: (editor: Editor) => void
  onSubmit?: () => void
}) {
  const set = (patch: Partial<EntryFormValue>) => onChange({ ...value, ...patch })
  const { data: projects } = useProjects()
  const active = entryKind(value.kind)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1">
        {ENTRY_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => set({ kind: k.value })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              value.kind === k.value
                ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
            )}
          >
            <k.icon className="h-3.5 w-3.5" />
            {k.label}
          </button>
        ))}
      </div>

      <Field label="Title">
        <Input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={
            active.value === 'EVENT' ? 'What is it? e.g. Dentist, 3pm' : 'Give this entry a title…'
          }
          className="text-base font-medium"
        />
      </Field>

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
        <RichEditor
          className="kb-editor-framed"
          content={body}
          mentionShortcuts
          onReady={onEditorReady}
          onSubmit={onSubmit}
          placeholder={
            active.value === 'EVENT'
              ? 'Anything worth knowing before it — Type @ for people or [[ for tasks and projects…'
              : 'What happened? Type @ for people or [[ for tasks and projects…'
          }
        />
      </div>

      {(active.comms || active.slot) && (
        <div
          className={cn(
            'grid grid-cols-2 gap-3 rounded-[var(--radius-md)] bg-[var(--muted)] p-3',
            active.comms ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
          )}
        >
          {active.comms && (
            <div className="flex flex-col gap-1">
              <Label>Direction</Label>
              <div className="flex gap-1">
                {(
                  [
                    ['INBOUND', ArrowDownLeft],
                    ['OUTBOUND', ArrowUpRight],
                  ] as const
                ).map(([d, Icon]) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set({ direction: value.direction === d ? '' : d })}
                    title={d.toLowerCase()}
                    className={cn(
                      'inline-flex h-8 flex-1 items-center justify-center rounded-md border text-xs transition-colors',
                      value.direction === d
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'border-[var(--border)] hover:bg-[var(--accent)]',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label>Duration (min)</Label>
            <Input
              type="number"
              min={0}
              placeholder="25"
              value={value.durationMin}
              onChange={(e) => set({ durationMin: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label>Location</Label>
            <Input
              value={value.location}
              onChange={(e) => set({ location: e.target.value })}
              className="h-8 text-xs"
              placeholder="Zoom, office…"
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date & time">
          {/* An entry is something that happened at a moment, so never all-day. */}
          <DateTimeField
            value={value.occurredAt}
            allDay={false}
            onChange={(iso) => set({ occurredAt: iso })}
          />
        </Field>
        <Field label="Follow-up">
          <DateTimeField
            value={value.followUpAt}
            allDay={false}
            onChange={(iso) => set({ followUpAt: iso })}
          />
        </Field>
        <Field label="Project">
          <Select value={value.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">No project</option>
            {(projects ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Tags">
        <ChipsInput
          value={value.tags}
          onChange={(tags) => set({ tags })}
          placeholder="Add a tag…"
        />
      </Field>
    </div>
  )
}
