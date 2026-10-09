'use client'
import * as React from 'react'
import { toast } from 'sonner'
import { Upload, Star, Plus, X, Briefcase, Link2, Flag, MessageSquare, HeartHandshake, Layers } from 'lucide-react'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ChipsInput } from '@/components/ui/chips'
import { Avatar } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CADENCE_LABEL, TIER_LABEL } from '@/lib/cadence'

export const CHANNEL_TYPES = [
  { value: 'PHONE', label: 'Phone', placeholder: '+1 555 0100' },
  { value: 'EMAIL', label: 'Email', placeholder: 'name@example.com' },
  { value: 'SLACK', label: 'Slack', placeholder: '@handle' },
  { value: 'TEAMS', label: 'Teams', placeholder: 'name@org.com' },
  { value: 'LINKEDIN', label: 'LinkedIn', placeholder: 'profile-handle' },
  { value: 'OTHER', label: 'Other', placeholder: 'handle or address' },
] as const

export interface Channel { type: string; value: string; label: string; isPreferred: boolean }
export interface Position {
  role: string; organization: string; team: string
  startDate: string; endDate: string; isCurrent: boolean
}
export interface Milestone { title: string; date: string; note: string }
export interface KeyLink { label: string; url: string }
export interface Attribute { category: string; key: string; value: string }

export interface ContactFormValue {
  displayName: string
  firstName: string; lastName: string; nickname: string; pronouns: string
  headline: string
  location: string; birthday: string
  howWeMet: string; bio: string; personalContext: string; notes: string
  avatarUrl: string
  tier: string; cadence: string
  interests: string[]; tags: string[]
  attributes: Attribute[]
  channels: Channel[]
  positions: Position[]
  milestones: Milestone[]
  links: KeyLink[]
}

const toDate = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '')

export function blankContact(displayName = ''): ContactFormValue {
  const parts = displayName.trim().split(/\s+/)
  return {
    displayName,
    firstName: parts[0] ?? '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
    nickname: '', pronouns: '', headline: '',
    location: '', birthday: '',
    howWeMet: '', bio: '', personalContext: '', notes: '',
    avatarUrl: '',
    tier: 'TIER_3', cadence: 'NONE',
    interests: [], tags: [],
    attributes: [],
    channels: [], positions: [], milestones: [], links: [],
  }
}

export function contactFromRecord(c: any): ContactFormValue {
  return {
    displayName: c.displayName ?? '',
    firstName: c.firstName ?? '', lastName: c.lastName ?? '',
    nickname: c.nickname ?? '', pronouns: c.pronouns ?? '',
    headline: c.headline ?? '',
    location: c.location ?? '', birthday: toDate(c.birthday),
    howWeMet: c.howWeMet ?? '', bio: c.bio ?? '',
    personalContext: c.personalContext ?? '', notes: c.notes ?? '',
    avatarUrl: c.avatarUrl ?? '',
    tier: c.tier ?? 'TIER_3', cadence: c.cadence ?? 'NONE',
    interests: c.interests ?? [],
    attributes: (c.attributes ?? []).map((a: any) => ({
      category: a.category ?? '', key: a.key ?? '', value: a.value ?? '',
    })),
    tags: (c.tags ?? []).map((t: any) => t.tag?.name ?? t),
    channels: (c.channels ?? []).map((ch: any) => ({
      type: ch.type, value: ch.value, label: ch.label ?? '', isPreferred: ch.isPreferred,
    })),
    positions: (c.positions ?? []).map((p: any) => ({
      role: p.role, organization: p.organization ?? '', team: p.team ?? '',
      startDate: toDate(p.startDate), endDate: toDate(p.endDate), isCurrent: p.isCurrent,
    })),
    milestones: (c.milestones ?? []).map((m: any) => ({
      title: m.title, date: toDate(m.date), note: m.note ?? '',
    })),
    links: (c.links ?? []).map((l: any) => ({ label: l.label, url: l.url })),
  }
}

/** Serializes to the shape `upsertContactSchema` expects. */
export function contactToPayload(v: ContactFormValue, isDraft = false) {
  return {
    displayName: v.displayName.trim(),
    firstName: v.firstName || null, lastName: v.lastName || null,
    nickname: v.nickname || null, pronouns: v.pronouns || null,
    headline: v.headline || null,
    location: v.location || null, birthday: v.birthday || null,
    howWeMet: v.howWeMet || null, bio: v.bio || null,
    personalContext: v.personalContext || null, notes: v.notes || null,
    avatarUrl: v.avatarUrl || null,
    tier: v.tier, cadence: v.cadence,
    interests: v.interests, tags: v.tags, customFields: {},
    attributes: attributeRows(v),
    channels: v.channels
      .filter((c) => c.value.trim())
      .map((c) => ({ type: c.type, value: c.value.trim(), label: c.label || null, isPreferred: c.isPreferred })),
    positions: v.positions
      .filter((p) => p.role.trim())
      .map((p) => ({
        role: p.role.trim(), organization: p.organization || null, team: p.team || null,
        startDate: p.startDate || null, endDate: p.endDate || null, isCurrent: p.isCurrent,
      })),
    milestones: v.milestones
      .filter((m) => m.title.trim())
      .map((m) => ({ title: m.title.trim(), date: m.date || null, note: m.note || null })),
    links: v.links
      .filter((l) => l.url.trim())
      .map((l) => ({ label: l.label.trim() || 'Link', url: l.url.trim() })),
    isDraft,
  }
}

export function ContactForm({
  value, onChange,
}: { value: ContactFormValue; onChange: (v: ContactFormValue) => void }) {
  const set = (patch: Partial<ContactFormValue>) => onChange({ ...value, ...patch })
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not upload that image')
        return
      }
      set({ avatarUrl: body.url })
    } catch {
      toast.error('Could not upload that image')
    } finally {
      setUploading(false)
    }
  }

  const patchAt = <T,>(key: keyof ContactFormValue, i: number, patch: Partial<T>) =>
    set({ [key]: (value[key] as unknown as T[]).map((r, j) => (j === i ? { ...r, ...patch } : r)) } as any)
  const removeAt = (key: keyof ContactFormValue, i: number) =>
    set({ [key]: (value[key] as unknown as any[]).filter((_, j) => j !== i) } as any)
  const append = (key: keyof ContactFormValue, row: any) =>
    set({ [key]: [...(value[key] as unknown as any[]), row] } as any)

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------ identity */}
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1.5">
          <Avatar src={value.avatarUrl} name={value.displayName || '?'} size={64} />
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]"
            onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-3 w-3" /> {uploading ? '…' : 'Photo'}
          </Button>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-3">
          <Field label="First name">
            <Input value={value.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          </Field>
          <Field label="Last name">
            <Input value={value.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </Field>
          <Field label="Display name">
            <Input value={value.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder="How they appear everywhere" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nickname">
              <Input value={value.nickname} onChange={(e) => set({ nickname: e.target.value })} />
            </Field>
            <Field label="Pronouns">
              <Input value={value.pronouns} onChange={(e) => set({ pronouns: e.target.value })} placeholder="they/them" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Headline">
              <Input value={value.headline} onChange={(e) => set({ headline: e.target.value })}
                placeholder="One line that captures who they are" />
            </Field>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Relationship tier">
          <Select value={value.tier} onChange={(e) => set({ tier: e.target.value })}>
            {Object.entries(TIER_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Check in">
          <Select value={value.cadence} onChange={(e) => set({ cadence: e.target.value })}>
            {Object.entries(CADENCE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Select>
        </Field>
      </div>

      {/* ------------------------------------------------------ channels */}
      <Section icon={MessageSquare} title="Communication channels"
        hint="Star the one they actually respond on.">
        {value.channels.map((ch, i) => {
          const meta = CHANNEL_TYPES.find((t) => t.value === ch.type)
          return (
            <div key={i} className="flex items-center gap-1.5">
              <button type="button" title="Preferred channel"
                onClick={() => set({ channels: value.channels.map((c, j) => ({ ...c, isPreferred: j === i && !c.isPreferred })) })}
                className={cn('shrink-0 rounded p-1 transition-colors',
                  ch.isPreferred ? 'text-[var(--pending)]' : 'text-[var(--muted-foreground)] opacity-40 hover:opacity-100')}>
                <Star className={cn('h-3.5 w-3.5', ch.isPreferred && 'fill-current')} />
              </button>
              <Select value={ch.type} onChange={(e) => patchAt<Channel>('channels', i, { type: e.target.value })}
                className="h-8 w-28 shrink-0 text-xs">
                {CHANNEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <Input className="h-8 flex-[2] text-xs" placeholder={meta?.placeholder}
                value={ch.value} onChange={(e) => patchAt<Channel>('channels', i, { value: e.target.value })} />
              <Input className="h-8 flex-1 text-xs" placeholder="label"
                value={ch.label} onChange={(e) => patchAt<Channel>('channels', i, { label: e.target.value })} />
              <RemoveButton onClick={() => removeAt('channels', i)} />
            </div>
          )
        })}
        <AddButton label="Add channel"
          onClick={() => append('channels', { type: 'EMAIL', value: '', label: '', isPreferred: value.channels.length === 0 })} />
      </Section>

      {/* ------------------------------------------------------ positions */}
      <Section icon={Briefcase} title="Positions"
        hint="Current and past roles. The one marked current drives their title everywhere else.">
        {value.positions.map((p, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center gap-1.5">
              <Input className="h-8 flex-[2] text-xs" placeholder="Role"
                value={p.role} onChange={(e) => patchAt<Position>('positions', i, { role: e.target.value })} />
              <Input className="h-8 flex-[2] text-xs" placeholder="Organization"
                value={p.organization} onChange={(e) => patchAt<Position>('positions', i, { organization: e.target.value })} />
              <Input className="h-8 flex-1 text-xs" placeholder="Team"
                value={p.team} onChange={(e) => patchAt<Position>('positions', i, { team: e.target.value })} />
              <RemoveButton onClick={() => removeAt('positions', i)} />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input type="date" className="h-8 flex-1 text-xs" value={p.startDate}
                onChange={(e) => patchAt<Position>('positions', i, { startDate: e.target.value })} />
              <span className="text-xs text-[var(--muted-foreground)]">→</span>
              <Input type="date" className="h-8 flex-1 text-xs" value={p.endDate} disabled={p.isCurrent}
                onChange={(e) => patchAt<Position>('positions', i, { endDate: e.target.value })} />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pl-1 text-xs">
                <input type="checkbox" checked={p.isCurrent}
                  onChange={(e) => set({
                    positions: value.positions.map((q, j) =>
                      j === i ? { ...q, isCurrent: e.target.checked, endDate: e.target.checked ? '' : q.endDate }
                              : { ...q, isCurrent: e.target.checked ? false : q.isCurrent }),
                  })} />
                Current
              </label>
            </div>
          </div>
        ))}
        <AddButton label="Add position"
          onClick={() => append('positions', { role: '', organization: '', team: '', startDate: '', endDate: '', isCurrent: value.positions.length === 0 })} />
      </Section>

      {/* ------------------------------------------------------ context */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Location">
          <Input value={value.location} onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <Field label="Birthday">
          <Input type="date" value={value.birthday} onChange={(e) => set({ birthday: e.target.value })} />
        </Field>
      </div>

      <Field label="How we met — context of origin">
        <Textarea rows={3} value={value.howWeMet} onChange={(e) => set({ howWeMet: e.target.value })}
          placeholder="Where this started: the introduction, the conference, the thread — and who connected you." />
      </Field>

      <Field label="Personal & family context">
        <Textarea rows={3} value={value.personalContext} onChange={(e) => set({ personalContext: e.target.value })}
          placeholder="Partner, children, pets, hometown — the things worth remembering." />
      </Field>

      {/* ------------------------------------------------------ milestones */}
      <Section icon={Flag} title="Personal milestones">
        {value.milestones.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input className="h-8 flex-[2] text-xs" placeholder="Milestone"
              value={m.title} onChange={(e) => patchAt<Milestone>('milestones', i, { title: e.target.value })} />
            <Input type="date" className="h-8 w-36 shrink-0 text-xs"
              value={m.date} onChange={(e) => patchAt<Milestone>('milestones', i, { date: e.target.value })} />
            <Input className="h-8 flex-[2] text-xs" placeholder="note"
              value={m.note} onChange={(e) => patchAt<Milestone>('milestones', i, { note: e.target.value })} />
            <RemoveButton onClick={() => removeAt('milestones', i)} />
          </div>
        ))}
        <AddButton label="Add milestone" onClick={() => append('milestones', { title: '', date: '', note: '' })} />
      </Section>

      {/* ------------------------------------------------------ links */}
      <Section icon={Link2} title="Key links">
        {value.links.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input className="h-8 flex-1 text-xs" placeholder="Label"
              value={l.label} onChange={(e) => patchAt<KeyLink>('links', i, { label: e.target.value })} />
            <Input className="h-8 flex-[3] text-xs" placeholder="https://…"
              value={l.url} onChange={(e) => patchAt<KeyLink>('links', i, { url: e.target.value })} />
            <RemoveButton onClick={() => removeAt('links', i)} />
          </div>
        ))}
        <AddButton label="Add link" onClick={() => append('links', { label: '', url: '' })} />
      </Section>

      <Field label="Interests & hobbies">
        <ChipsInput value={value.interests} onChange={(interests) => set({ interests })}
          placeholder="Sailing, jazz, woodworking…" />
      </Field>

      <Section icon={Layers} title="Other details"
        hint="Anything else worth keeping. Grouped by the category you give it.">
        {value.attributes.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input className="h-8 flex-1 text-xs" placeholder="Category"
              value={a.category} onChange={(e) => patchAt<Attribute>('attributes', i, { category: e.target.value })} />
            <Input className="h-8 flex-1 text-xs" placeholder="Label"
              value={a.key} onChange={(e) => patchAt<Attribute>('attributes', i, { key: e.target.value })} />
            <Input className="h-8 flex-[2] text-xs" placeholder="Value"
              value={a.value} onChange={(e) => patchAt<Attribute>('attributes', i, { value: e.target.value })} />
            <RemoveButton onClick={() => removeAt('attributes', i)} />
          </div>
        ))}
        <AddButton label="Add detail"
          onClick={() => append('attributes', { category: 'Details', key: '', value: '' })} />
      </Section>

      <Field label="Bio">
        <Textarea rows={3} value={value.bio} onChange={(e) => set({ bio: e.target.value })}
          placeholder="A short summary of who they are professionally." />
      </Field>

      <Field label="Notes">
        <Textarea rows={4} value={value.notes} onChange={(e) => set({ notes: e.target.value })}
          placeholder="Running notes — working style, preferences, anything to remember." />
      </Field>

      <Field label="Tags">
        <ChipsInput value={value.tags} onChange={(tags) => set({ tags })} placeholder="colleague, climbing club…" />
      </Field>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Section({ icon: Icon, title, hint, children }: {
  icon: any; title: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <Label className="flex items-center gap-1.5"><Icon className="h-3 w-3" />{title}</Label>
        {hint && <span className="text-[11px] text-[var(--muted-foreground)] opacity-70">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove"
      className="shrink-0 rounded p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--destructive)]">
      <X className="h-3.5 w-3.5" />
    </button>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs text-[var(--muted-foreground)] transition hover:text-[var(--primary)]">
      <Plus className="h-3 w-3" /> {label}
    </button>
  )
}

/**
 * The attribute rows, cleaned up. `contactToPayload` embeds these so one save
 * carries them; the standalone endpoint takes the same shape.
 */
export function attributeRows(v: ContactFormValue) {
  return v.attributes
    .filter((a) => a.key.trim())
    .map((a) => ({ category: a.category.trim() || 'Details', key: a.key.trim(), value: a.value }))
}

/** Body for the standalone attributes endpoint. */
export function attributesPayload(v: ContactFormValue) {
  return { attributes: attributeRows(v) }
}
