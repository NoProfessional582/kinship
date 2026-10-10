'use client'
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowLeft,
  Loader2,
  Pencil,
  MapPin,
  Phone,
  Mail,
  Hash,
  Video,
  Building2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, Badge } from '@/components/ui/misc'
import { Section, MEmpty, MList, MRow } from '@/components/mobile/bits'
import { MobileTaskSheet } from '@/components/mobile/task-sheet'
import { MobileContactEditSheet } from '@/components/mobile/contact-edit-sheet'
import { KIND_ICON, KIND_COLOR } from '@/components/shared/entry-card'
import { api } from '@/lib/hooks/api'
import { CADENCE_LABEL, TIER_LABEL } from '@/lib/cadence'
import { useTimezone } from '@/lib/hooks/settings'
import { calendarDate, entryTitle, cn } from '@/lib/utils'
import { m } from '@/lib/mobile/href'
import type { ContactDossier } from '@/lib/api-types'

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

/**
 * The dossier on a phone.
 *
 * The desktop version is a 21rem sticky sidebar beside a main column. Stacked,
 * that sidebar becomes ~700px of cards you scroll past every single time to
 * reach the timeline, which is the thing you actually opened the person for.
 * So the header carries the few facts worth seeing always — how to reach them,
 * cadence, tier — and everything else is a collapsed Details block above a
 * timeline that starts immediately.
 *
 * Channels are tap-to-act here in a way they are not on a desktop: a phone
 * number on a phone should dial.
 */
export default function MobileDossier() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { fmt } = useTimezone()
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [details, setDetails] = React.useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api.get<ContactDossier>(`/api/contacts/${id}`),
  })
  const c = data?.contact

  if (isLoading || !c) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const facts: Array<[string, React.ReactNode]> = [
    c.pronouns && ['Pronouns', c.pronouns],
    c.nickname && ['Nickname', c.nickname],
    c.location && ['Location', c.location],
    // `calendarDate`, not `new Date` (K13). A birthday is a calendar day, and
    // the API serialises it as UTC midnight — so `new Date` resolves it to that
    // instant and `format` then renders it in the VIEWER's zone, showing the
    // day before anywhere west of UTC. The desktop dossier, the mobile home
    // list and the board cards all use this helper already; this page was the
    // one that did not.
    c.birthday && ['Birthday', format(calendarDate(c.birthday)!, 'MMMM d')],
    c.tier && ['Tier', TIER_LABEL[c.tier as keyof typeof TIER_LABEL]],
    c.cadence &&
      c.cadence !== 'NONE' && ['Cadence', CADENCE_LABEL[c.cadence as keyof typeof CADENCE_LABEL]],
    c.howWeMet && ['How we met', c.howWeMet],
    c.lastContactAt && ['Last contact', fmt(c.lastContactAt, 'MMM d, yyyy')],
  ].filter(Boolean) as Array<[string, React.ReactNode]>

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => router.back()}
        className="kb-tap -ml-1 flex items-center gap-1.5 self-start text-xs text-[var(--muted-foreground)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar name={c.displayName} src={c.avatarUrl} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.4rem] leading-tight">{c.displayName}</h1>
            {(c.jobTitle || c.company) && (
              <p className="mt-0.5 text-[13px] text-[var(--muted-foreground)]">
                {[c.jobTitle, c.company].filter(Boolean).join(' · ')}
              </p>
            )}
            {c.location && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                <MapPin className="h-3 w-3" /> {c.location}
              </p>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit contact"
            className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted-foreground)]"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>

        {c.isDraft && <Badge className="self-start">Needs details</Badge>}

        {/* Reachable, and actually reachable: on a phone these dial and compose
            rather than being text to copy. */}
        {(c.channels?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {c.channels.map((ch) => {
              const Icon = CHANNEL_ICON[ch.type] ?? MessageSquare
              const href = CHANNEL_HREF(ch.type, ch.value)
              const inner = (
                <>
                  <Icon className="h-3.5 w-3.5" />
                  <span className="max-w-[11rem] truncate">{ch.value}</span>
                </>
              )
              const cls =
                'kb-tap flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 text-xs'
              return href ? (
                <a key={ch.id} href={href} className={cls}>
                  {inner}
                </a>
              ) : (
                <span key={ch.id} className={cls}>
                  {inner}
                </span>
              )
            })}
          </div>
        )}
      </header>

      {facts.length > 0 && (
        <div>
          <button
            onClick={() => setDetails((v) => !v)}
            className="kb-tap flex w-full items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]"
          >
            {details ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Details
          </button>
          {details && (
            <dl className="mt-2 flex flex-col gap-2">
              {facts.map(([k, v]) => (
                <div key={k} className="flex gap-3 text-[13px]">
                  <dt className="w-28 shrink-0 text-[var(--muted-foreground)]">{k}</dt>
                  <dd className="min-w-0 flex-1 break-words">{v}</dd>
                </div>
              ))}
              {(c.attributes?.length ?? 0) > 0 &&
                c.attributes.map((a) => (
                  <div key={a.id} className="flex gap-3 text-[13px]">
                    <dt className="w-28 shrink-0 text-[var(--muted-foreground)]">{a.key}</dt>
                    <dd className="min-w-0 flex-1 break-words">{a.value}</dd>
                  </div>
                ))}
              {c.bio && <p className="mt-1 text-[13px] leading-relaxed">{c.bio}</p>}
            </dl>
          )}
        </div>
      )}

      {(data.upcoming?.length ?? 0) > 0 && (
        <Section title="Planned">
          <MList>
            {data.upcoming.map((e) => {
              const Icon = KIND_ICON[e.kind] ?? KIND_ICON.NOTE
              return (
                <MRow
                  key={e.id}
                  href={m(`/notes/${e.id}`)}
                  lead={<Icon className="h-4 w-4" style={{ color: KIND_COLOR[e.kind] }} />}
                  title={entryTitle(e)}
                  meta={fmt(e.occurredAt, 'MMM d')}
                />
              )
            })}
          </MList>
        </Section>
      )}

      {(data.tasks?.length ?? 0) > 0 && (
        <Section title="Tasks">
          <MList>
            {data.tasks.map((t) => (
              <MRow
                key={t.id}
                onClick={() => setOpenTask(t.id)}
                title={
                  <span className={cn(t.status === 'DONE' && 'line-through opacity-60')}>
                    {t.title}
                  </span>
                }
                meta={t.status?.toLowerCase().replace(/_/g, ' ')}
              />
            ))}
          </MList>
        </Section>
      )}

      {(data.projects?.length ?? 0) > 0 && (
        <Section title="Projects">
          <MList>
            {data.projects.map((p) => (
              <MRow key={p.id} href={m(`/projects/${p.slug}`)} title={p.name} chevron />
            ))}
          </MList>
        </Section>
      )}

      <Section title="Timeline">
        {(data.entries?.length ?? 0) === 0 ? (
          <MEmpty>Nothing recorded with {c.displayName} yet.</MEmpty>
        ) : (
          <MList>
            {data.entries.map((e) => {
              const Icon = KIND_ICON[e.kind] ?? KIND_ICON.NOTE
              return (
                <MRow
                  key={e.id}
                  href={m(`/notes/${e.id}`)}
                  lead={<Icon className="h-4 w-4" style={{ color: KIND_COLOR[e.kind] }} />}
                  title={entryTitle(e)}
                  meta={fmt(e.occurredAt, 'MMM d')}
                />
              )
            })}
          </MList>
        )}
      </Section>

      <MobileTaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      {editing && <MobileContactEditSheet contact={c} open={editing} onOpenChange={setEditing} />}
    </div>
  )
}
