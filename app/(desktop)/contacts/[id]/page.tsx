'use client'
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Trash2,
  Cake,
  MapPin,
  Plus,
  X,
  Phone,
  Mail,
  Hash,
  Users2,
  Building2,
  MessageSquare,
  Star,
  Video,
  Flag,
  Link2,
  ExternalLink,
  Briefcase,
  SquareCheck,
  FolderKanban,
  MessagesSquare,
  HeartHandshake,
  Layers,
  Sprout,
  Home,
  CalendarClock,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import { differenceInCalendarDays, format, formatDistanceToNowStrict, isBefore } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, Avatar, Badge, EmptyState } from '@/components/ui/misc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { EntryCard } from '@/components/shared/entry-card'
import { TaskDialog } from '@/components/shared/task-dialog'
import {
  ContactForm,
  contactFromRecord,
  contactToPayload,
  type ContactFormValue,
} from '@/components/entity-modal/contact-form'
import { NotFound } from '@/components/shared/not-found'
import { api, refreshAfterDelete, useContacts } from '@/lib/hooks/api'
import { CADENCE_LABEL, TIER_LABEL, cadenceHealth } from '@/lib/cadence'
import { CATEGORY_META, type EventCategory } from '@/lib/calendar-categories'
import { relationLabel } from '@/lib/relations'
import { useTimezone, useZonedToday } from '@/lib/hooks/settings'
import { nextAnniversary } from '@/lib/format'
import { calendarDate, cn } from '@/lib/utils'
import type { ContactDossier, Edge, ProjectSummary } from '@/lib/api-types'

type Dossier = NonNullable<ContactDossier>

const CHANNEL_ICON: Record<string, LucideIcon> = {
  PHONE: Phone,
  EMAIL: Mail,
  SLACK: Hash,
  TEAMS: Video,
  LINKEDIN: Building2,
  OTHER: MessageSquare,
}
const CHANNEL_HREF = (type: string, value: string) =>
  type === 'EMAIL'
    ? `mailto:${value}`
    : type === 'PHONE'
      ? `tel:${value.replace(/\s+/g, '')}`
      : type === 'LINKEDIN'
        ? `https://linkedin.com/in/${value.replace(/^@/, '')}`
        : undefined

export default function ContactPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState<ContactFormValue | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [openTask, setOpenTask] = React.useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api.get<ContactDossier>(`/api/contacts/${id}`),
  })
  const contact = data?.contact

  const save = async () => {
    if (!form || !contact) return
    setSaving(true)
    try {
      // One call: the payload carries the attribute rows now, so this no longer
      // has to be paired with a PUT to /attributes that other callers forgot.
      await api.patch(`/api/contacts/${contact.id}`, contactToPayload(form, false))
      qc.invalidateQueries()
      setEditing(false)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!contact) return
    try {
      await api.del(`/api/contacts/${contact.id}`)
      refreshAfterDelete(qc, ['contact', id])
      toast.success('Contact deleted')
      router.push('/contacts')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading dossier…
      </div>
    )
  }
  if (!contact) {
    return <NotFound error={error} what="Contact" href="/contacts" back="Contacts" />
  }

  const openEditor = () => {
    setForm(contactFromRecord(contact))
    setEditing(true)
  }

  const positions = contact.positions ?? []
  const current = positions.find((p) => p.isCurrent)
  const preferred = (contact.channels ?? []).find((c) => c.isPreferred)
  const facts = [
    ['Location', contact.location],
    ['Birthday', contact.birthday ? format(calendarDate(contact.birthday)!, 'MMMM d, yyyy') : null],
    ['Nickname', contact.nickname],
    ['Pronouns', contact.pronouns],
  ].filter(([, v]) => v) as [string, string][]

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/contacts')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Contacts
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={openEditor}>
          <Pencil className="h-3.5 w-3.5" /> Edit dossier
        </Button>
        <Button variant="ghost" size="icon" onClick={remove} title="Delete contact">
          <Trash2 className="h-4 w-4 text-[var(--destructive)]" />
        </Button>
      </div>

      {/* Identity band — the things you glance at before every conversation. */}
      <Card className="mb-6 overflow-hidden">
        <div
          className="h-1.5"
          style={{ background: 'linear-gradient(90deg, var(--hue-1), var(--hue-6))' }}
        />
        <div className="flex flex-wrap items-start gap-4 p-5">
          <Avatar src={contact.avatarUrl} name={contact.displayName} size={84} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{contact.displayName}</h1>
              {contact.pronouns && (
                <span className="text-xs text-[var(--muted-foreground)]">({contact.pronouns})</span>
              )}
              {contact.isDraft && (
                <Badge className="border-[var(--pending)] text-[var(--pending)]">
                  needs details
                </Badge>
              )}
            </div>
            {contact.headline && (
              <p className="mt-1 text-[15px] leading-snug">{contact.headline}</p>
            )}
            {current && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                <Briefcase className="h-3.5 w-3.5" />
                {current.role}
                {current.organization ? ` · ${current.organization}` : ''}
                {current.team ? ` · ${current.team}` : ''}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Badge>{contact._count.mentions} interactions</Badge>
              {contact.lastContactAt && (
                <Badge>
                  last spoke {formatDistanceToNowStrict(new Date(contact.lastContactAt))} ago
                </Badge>
              )}
              {contact.location && (
                <Badge>
                  <MapPin className="h-3 w-3" />
                  {contact.location}
                </Badge>
              )}
              {contact.birthday && (
                <Badge>
                  <Cake className="h-3 w-3" />
                  {format(calendarDate(contact.birthday)!, 'MMM d')}
                </Badge>
              )}
              <Badge style={{ borderColor: 'var(--hue-6)', color: 'var(--hue-6)' }}>
                {TIER_LABEL[contact.tier as keyof typeof TIER_LABEL] ?? 'Active'}
              </Badge>
              {contact.cadence !== 'NONE' &&
                (() => {
                  const h = cadenceHealth(contact.cadence, contact.lastContactAt)
                  const tone =
                    h.state === 'overdue' || h.state === 'never'
                      ? 'var(--destructive)'
                      : h.state === 'due'
                        ? 'var(--warning)'
                        : 'var(--success)'
                  return (
                    <Badge style={{ borderColor: tone, color: tone }}>
                      <HeartHandshake className="h-3 w-3" />
                      {CADENCE_LABEL[contact.cadence as keyof typeof CADENCE_LABEL]}
                      {h.state === 'never'
                        ? ' · never'
                        : h.state === 'overdue'
                          ? ` · ${Math.abs(h.dueInDays!)}d over`
                          : ` · due in ${h.dueInDays}d`}
                    </Badge>
                  )
                })()}
            </div>
          </div>

          {preferred && (
            <a
              href={CHANNEL_HREF(preferred.type, preferred.value)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--border)] px-3.5 py-2.5 transition-colors hover:bg-[var(--muted)]"
              style={{ background: 'color-mix(in oklch, var(--hue-4) 10%, transparent)' }}
            >
              <Star className="h-4 w-4 shrink-0 fill-current text-[var(--pending)]" />
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  Reach them on
                </span>
                <span className="block truncate text-sm font-medium">{preferred.value}</span>
              </span>
            </a>
          )}
        </div>
      </Card>

      {/* One continuous page: reference material on the left, the narrative and
          the activity on the right. No tabs to hide anything behind. */}
      <div className="grid gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <Block title="Channels" icon={MessagesSquare} hue="var(--hue-2)">
            {(contact.channels ?? []).length === 0 && <Muted>No channels recorded.</Muted>}
            <ul className="flex flex-col gap-2.5">
              {(contact.channels ?? []).map((ch) => {
                const Icon = CHANNEL_ICON[ch.type] ?? MessageSquare
                const href = CHANNEL_HREF(ch.type, ch.value)
                return (
                  <li key={ch.id} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{ background: 'color-mix(in oklch, var(--hue-2) 14%, transparent)' }}
                    >
                      <Icon className="h-3 w-3" style={{ color: 'var(--hue-2)' }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="break-words text-sm hover:underline"
                        >
                          {ch.value}
                        </a>
                      ) : (
                        <span className="break-words text-sm">{ch.value}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                        <span className="capitalize">{ch.type.toLowerCase()}</span>
                        {ch.label && <span>· {ch.label}</span>}
                        {ch.isPreferred && (
                          <span className="inline-flex items-center gap-0.5 font-medium text-[var(--pending)]">
                            <Star className="h-2.5 w-2.5 fill-current" /> preferred
                          </span>
                        )}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </Block>

          {(facts.length > 0 || (contact.interests ?? []).length > 0) && (
            <Block title="At a glance" icon={MapPin} hue="var(--hue-3)">
              <dl className="flex flex-col gap-2">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <dt className="text-[11px] text-[var(--muted-foreground)]">{k}</dt>
                    <dd className="break-words text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
              {(contact.interests ?? []).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {contact.interests.map((i: string) => (
                    <span
                      key={i}
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background: 'color-mix(in oklch, var(--hue-3) 14%, transparent)',
                        color: 'var(--hue-3)',
                      }}
                    >
                      {i}
                    </span>
                  ))}
                </div>
              )}
            </Block>
          )}

          {(contact.links ?? []).length > 0 && (
            <Block title="Key links" icon={Link2} hue="var(--hue-1)">
              <ul className="flex flex-col gap-1.5">
                {contact.links.map((l) => (
                  <li key={l.id}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1.5 text-sm hover:underline"
                    >
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                      <span className="break-words">{l.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <EdgesBlock contactId={contact.id} />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Where the relationship came from, and the standing facts about
              their life. Both were buried — one in a key/value list, one under
              a generic "About" — and both are the things you actually want to
              have read before you speak to someone. */}
          <div className="grid gap-4 md:grid-cols-2">
            <Origin
              icon={Sprout}
              hue="var(--hue-4)"
              eyebrow="Context of origin"
              title="How we met"
              text={contact.howWeMet}
              empty="Record where this relationship started — the introduction, the event, the thread."
              onAdd={openEditor}
            />
            <Origin
              icon={Home}
              hue="var(--hue-6)"
              eyebrow="Personal context"
              title="Family & household"
              text={contact.personalContext}
              empty="Partner, kids, pets, where they live — the details worth remembering."
              onAdd={openEditor}
            />
          </div>

          <UpcomingBlock contact={contact} entries={data.upcoming ?? []} tasks={data.tasks ?? []} />

          {(contact.bio || contact.notes) && (
            <Block title="About" icon={Users2} hue="var(--hue-6)">
              <div className="flex flex-col gap-4">
                {contact.bio && <Prose label="Bio" text={contact.bio} />}
                {contact.notes && <Prose label="Notes" text={contact.notes} />}
              </div>
            </Block>
          )}

          {positions.length > 0 && (
            <Block title="Career" icon={Briefcase} hue="var(--hue-1)">
              <ol className="flex flex-col gap-4">
                {[...(current ? [current] : []), ...positions.filter((p) => !p.isCurrent)].map(
                  (p) => (
                    <li key={p.id} className="relative pl-5">
                      <span
                        className="absolute left-0 top-1.5 h-2 w-2 rounded-full"
                        style={{ background: p.isCurrent ? 'var(--hue-1)' : 'var(--border)' }}
                      />
                      <span className="absolute left-[3px] top-4 h-[calc(100%+0.5rem)] w-px bg-[var(--border)] last:hidden" />
                      <p className="text-sm font-medium">{p.role}</p>
                      {p.organization && (
                        <p className="text-sm text-[var(--muted-foreground)]">{p.organization}</p>
                      )}
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                        {p.team && <span>{p.team} ·</span>}
                        <span>{dateRange(p.startDate, p.endDate, p.isCurrent)}</span>
                        {p.isCurrent && (
                          <span
                            className="rounded-full px-1.5 font-medium"
                            style={{
                              background: 'color-mix(in oklch, var(--hue-1) 16%, transparent)',
                              color: 'var(--hue-1)',
                            }}
                          >
                            current
                          </span>
                        )}
                      </p>
                    </li>
                  ),
                )}
              </ol>
            </Block>
          )}

          {(contact.attributes ?? []).length > 0 && (
            <Block title="Other details" icon={Layers} hue="var(--hue-2)">
              <div className="flex flex-col gap-4">
                {Object.entries(
                  contact.attributes.reduce<Record<string, Dossier['contact']['attributes']>>(
                    (acc, a) => {
                      ;(acc[a.category] ??= []).push(a)
                      return acc
                    },
                    {},
                  ),
                ).map(([category, rows]) => (
                  <div key={category}>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      {category}
                    </p>
                    <dl className="flex flex-col gap-1.5">
                      {rows.map((a) => (
                        <div key={a.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                          <dt className="shrink-0 text-sm text-[var(--muted-foreground)] sm:w-40">
                            {a.key}
                          </dt>
                          <dd className="min-w-0 flex-1 break-words text-sm">{a.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </Block>
          )}

          {(contact.milestones ?? []).length > 0 && (
            <Block title="Milestones" icon={Flag} hue="var(--hue-4)">
              <ul className="flex flex-col gap-2.5">
                {contact.milestones.map((m) => (
                  <li key={m.id}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="break-words text-sm font-medium">{m.title}</span>
                      {m.date && (
                        <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                          {format(calendarDate(m.date)!, 'MMM yyyy')}
                        </span>
                      )}
                    </div>
                    {m.note && (
                      <p className="break-words text-xs text-[var(--muted-foreground)]">{m.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {data.tasks.length > 0 && (
            <Block title={`Tasks (${data.tasks.length})`} icon={SquareCheck} hue="var(--hue-3)">
              <div className="flex flex-col gap-1.5">
                {data.tasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setOpenTask(t.id)}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--muted)]"
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        t.status === 'DONE' ? 'bg-[var(--success)]' : 'bg-[var(--primary)]',
                      )}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        t.status === 'DONE' && 'line-through opacity-60',
                      )}
                    >
                      {t.title}
                    </span>
                    {t.dueDate && (
                      <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                        {format(calendarDate(t.dueDate)!, 'MMM d')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </Block>
          )}

          {data.projects.length > 0 && (
            <Block title="Projects" icon={FolderKanban} hue="var(--hue-5)">
              <div className="flex flex-wrap gap-2">
                {data.projects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.slug}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs transition-colors hover:bg-[var(--muted)]"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: p.color ?? 'var(--primary)' }}
                    />
                    {p.name}
                  </Link>
                ))}
              </div>
            </Block>
          )}

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <MessagesSquare className="h-4 w-4 text-[var(--primary)]" />
              History ({data.entries.length})
            </h2>
            <div className="flex flex-col gap-3">
              {data.entries.length === 0 && (
                <EmptyState
                  title="No interactions logged"
                  hint={`Write a note tagging @${contact.displayName} to start the history.`}
                />
              )}
              {data.entries.map((e) => (
                <EntryCard key={e.id} entry={e} compact />
              ))}
            </div>
          </section>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit dossier — {contact.displayName}</DialogTitle>
          </DialogHeader>
          {form && <ContactForm value={form} onChange={setForm} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDialog taskId={openTask} onClose={() => setOpenTask(null)} />
    </div>
  )
}

function dateRange(start: string | null, end: string | null, isCurrent: boolean) {
  const f = (d: string | null) => {
    const c = calendarDate(d)
    return c ? format(c, 'MMM yyyy') : null
  }
  const s = f(start)
  const e = isCurrent ? 'present' : f(end)
  if (!s && !e) return 'dates not recorded'
  return `${s ?? '?'} – ${e ?? '?'}`
}

function Block({
  title,
  icon: Icon,
  hue,
  children,
}: {
  title: string
  icon: LucideIcon
  hue: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: `color-mix(in oklch, ${hue} 10%, transparent)` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: hue }} />
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: hue }}>
          {title}
        </h3>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}

function Prose({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
    </div>
  )
}

/**
 * A single origin-story panel. It renders even when empty, because a blank
 * "How we met" is a prompt to fill it in — hiding the section means nobody
 * ever discovers the field exists.
 */
function Origin({
  icon: Icon,
  hue,
  eyebrow,
  title,
  text,
  empty,
  onAdd,
}: {
  icon: LucideIcon
  hue: string
  eyebrow: string
  title: string
  text?: string | null
  empty: string
  onAdd: () => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)]"
          style={{ background: `color-mix(in oklch, ${hue} 14%, transparent)` }}
        >
          <Icon className="h-4 w-4" style={{ color: hue }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: hue }}>
            {eyebrow}
          </p>
          <p className="text-sm font-semibold">{title}</p>
          {text ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
          ) : (
            <button
              onClick={onAdd}
              className="mt-1.5 inline-flex items-start gap-1 text-left text-xs leading-relaxed text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <Plus className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{empty}</span>
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

interface Upcoming {
  key: string
  category: EventCategory
  label: string
  date: Date
  meta?: string | null
  href?: string
  overdue?: boolean
  /** A wall-calendar day rather than an instant — rendered without a zone. */
  allDay?: boolean
}

/**
 * Everything still open with this person, in one list: entries dated forward,
 * promised follow-ups that never got written up, their open deadlines, dated
 * milestones and the next birthday. Same six categories — and the same colours
 * — the calendar uses.
 */
function UpcomingBlock({
  contact,
  entries,
  tasks,
}: {
  contact: Dossier['contact']
  entries: Dossier['upcoming']
  tasks: Dossier['tasks']
}) {
  const { fmt } = useTimezone()
  // Instants compare against the instant; calendar dates compare against the
  // calendar day it is in the user's zone. Conflating the two is what makes a
  // deadline read "overdue" from 5pm onwards.
  const today = useZonedToday()

  const items = React.useMemo<Upcoming[]>(() => {
    if (!today) return []
    const now = new Date()
    const out: Upcoming[] = []

    // The server has already picked these two apart: what is still ahead, and
    // what was planned, came and went with nothing written into it. A promised
    // conversation is ochre either way, so a missed one does not quietly read
    // as an ordinary appointment.
    for (const e of entries) {
      out.push({
        key: `s:${e.id}`,
        category: e.isFollowUp ? 'followup' : 'scheduled',
        label: e.title?.trim() || 'Untitled entry',
        date: new Date(e.occurredAt),
        meta: e.project?.name,
        href: `/notes/${e.id}`,
        overdue: e.openLoop,
      })
    }

    for (const t of tasks) {
      if (t.status === 'DONE' || !t.dueDate) continue
      const allDay = t.allDay ?? true
      // A timed deadline keeps its instant so the row can print the time and
      // judge "overdue" against the clock rather than the calendar.
      const due = allDay ? calendarDate(t.dueDate) : new Date(t.dueDate)
      if (!due) continue
      out.push({
        key: `t:${t.id}`,
        category: 'deadline',
        label: t.title,
        allDay,
        date: due,
        meta: t.project?.name,
        href: `/board?task=${t.id}`,
        overdue: allDay ? differenceInCalendarDays(due, today) < 0 : isBefore(due, now),
      })
    }

    for (const m of contact.milestones ?? []) {
      const on = calendarDate(m.date)
      if (!on || differenceInCalendarDays(on, today) < 0) continue
      out.push({
        key: `m:${m.id}`,
        category: 'milestone',
        label: m.title,
        date: on,
        meta: m.note,
        allDay: true,
      })
    }

    if (contact.birthday) {
      // Stored as a UTC calendar date; read it in UTC or half of them shift.
      const next = nextAnniversary(contact.birthday, today)
      if (differenceInCalendarDays(next, today) <= 120) {
        out.push({
          key: 'b',
          category: 'milestone',
          allDay: true,
          label: `${contact.nickname || contact.displayName}'s birthday`,
          date: next,
        })
      }
    }

    return out.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 12)
  }, [contact, entries, tasks, today])

  return (
    <Block title="Upcoming follow-ups & reminders" icon={CalendarClock} hue="var(--hue-4)">
      {items.length === 0 && (
        <Muted>
          Nothing open with {contact.displayName}. Set a follow-up date on a note to see it here.
        </Muted>
      )}
      <ul className="flex flex-col">
        {items.map((it) => {
          const meta = CATEGORY_META[it.category]
          const days = today ? differenceInCalendarDays(it.date, today) : 0
          const row = (
            <>
              <span
                className="w-[4.75rem] shrink-0 whitespace-nowrap text-[11px] font-medium uppercase tracking-wide"
                style={{ color: meta.tint }}
              >
                {meta.short}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{it.label}</span>
                {it.meta && (
                  <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                    {it.meta}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs">
                  {it.allDay ? format(it.date, 'MMM d') : fmt(it.date, 'MMM d, h:mm a')}
                </span>
                <span
                  className={cn(
                    'block text-[11px]',
                    it.overdue
                      ? 'font-medium text-[var(--destructive)]'
                      : 'text-[var(--muted-foreground)]',
                  )}
                >
                  {days === 0
                    ? 'today'
                    : days === 1
                      ? 'tomorrow'
                      : days < 0
                        ? `${Math.abs(days)}d overdue`
                        : `in ${days}d`}
                </span>
              </span>
              {it.href && (
                <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              )}
            </>
          )
          const cls =
            'group flex items-center gap-3 border-l-2 py-2 pl-2.5 pr-1 transition-colors hover:bg-[var(--muted)]'
          return (
            <li key={it.key}>
              {it.href ? (
                <Link href={it.href} className={cls} style={{ borderColor: meta.tint }}>
                  {row}
                </Link>
              ) : (
                <div className={cls} style={{ borderColor: meta.tint }}>
                  {row}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--muted-foreground)] opacity-75">{children}</p>
}

/**
 * Generalised relationships. An edge can point at a person, a project, a task
 * or an entry, so "introduced me to Northwind" is the same kind of record as
 * "reports to Tobias".
 */
function EdgesBlock({ contactId }: { contactId: string }) {
  const qc = useQueryClient()
  const { data: everyone } = useContacts()
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects'),
  })
  const { data: edges } = useQuery({
    queryKey: ['edges', contactId],
    queryFn: () => api.get<Edge[]>(`/api/edges?type=contact&id=${contactId}`),
  })

  const [adding, setAdding] = React.useState(false)
  const [targetType, setTargetType] = React.useState<'contact' | 'project'>('contact')
  const [targetId, setTargetId] = React.useState('')
  const [relation, setRelation] = React.useState('')

  const options =
    targetType === 'contact'
      ? (everyone ?? [])
          .filter((c) => c.id !== contactId)
          .map((c) => ({ id: c.id, label: c.displayName }))
      : (projects ?? []).map((p) => ({ id: p.id, label: p.name }))

  const add = async () => {
    if (!targetId || !relation.trim()) {
      toast.error('Pick something and describe the link')
      return
    }
    try {
      await api.post('/api/edges', {
        sourceType: 'contact',
        sourceId: contactId,
        targetType,
        targetId,
        relation: relation.trim(),
      })
      qc.invalidateQueries()
      setAdding(false)
      setTargetId('')
      setRelation('')
      toast.success('Relationship added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add')
    }
  }

  const remove = async (id: string) => {
    try {
      await api.del(`/api/edges/${id}`)
      qc.invalidateQueries()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove')
    }
  }

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: 'color-mix(in oklch, var(--hue-5) 10%, transparent)' }}
      >
        <Users2 className="h-3.5 w-3.5" style={{ color: 'var(--hue-5)' }} />
        <h3
          className="flex-1 text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--hue-5)' }}
        >
          Relationships
        </h3>
        <button
          onClick={() => setAdding((v) => !v)}
          aria-label="Add relationship"
          className="rounded p-0.5 transition hover:opacity-70"
          style={{ color: 'var(--hue-5)' }}
        >
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {adding && (
          <div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] bg-[var(--muted)] p-2">
            <Select
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value === 'project' ? 'project' : 'contact')
                setTargetId('')
              }}
              className="h-8 text-xs"
            >
              <option value="contact">A person</option>
              <option value="project">A project</option>
            </Select>
            <Select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="h-8 text-xs"
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Input
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              placeholder="reports to, introduced me to, sponsors…"
              className="h-8 text-xs"
            />
            <Button size="sm" onClick={add}>
              Add
            </Button>
          </div>
        )}
        {(edges ?? []).length === 0 && !adding && (
          <Muted>None yet. Link this person to someone else, or to a project.</Muted>
        )}
        {(edges ?? []).map((e) => (
          <div key={e.id} className="group flex items-center gap-2 text-sm">
            {e.otherType === 'contact' ? (
              <Avatar src={e.avatarUrl} name={e.label} size={22} />
            ) : (
              <FolderKanban className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            )}
            <Link href={e.href} className="min-w-0 flex-1 break-words hover:underline">
              {e.label}
            </Link>
            <span className="shrink-0 text-[11px]" style={{ color: 'var(--hue-5)' }}>
              {relationLabel(e.relation, e.direction)}
            </span>
            <button
              onClick={() => remove(e.id)}
              aria-label="Remove relationship"
              className="shrink-0 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}
