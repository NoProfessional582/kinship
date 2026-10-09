'use client'
import * as React from 'react'
import { useInitialNow } from '@/lib/hooks/platform'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  PenLine,
  Users,
  SquareCheck,
  FolderKanban,
  ArrowRight,
  Loader2,
  CloudSun,
} from 'lucide-react'
import { UnifiedComposer } from '@/components/composer/unified-composer'
import { EntryCard } from '@/components/shared/entry-card'
import { TaskDialog } from '@/components/shared/task-dialog'
import { TodayPanel, Inset, useToday, useUpcoming } from '@/components/dashboard/today-panel'
import { CATEGORY_META } from '@/lib/calendar-categories'
import { PeopleOrbit } from '@/components/dashboard/people-orbit'
import { EmptyState } from '@/components/ui/misc'
import { api, useDrafts } from '@/lib/hooks/api'
import { useSettings, useTimezone, useWeather, weatherLabel } from '@/lib/hooks/settings'
import { format } from 'date-fns'
import { calendarDate } from '@/lib/utils'

export default function Dashboard() {
  const router = useRouter()
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const settings = useSettings()
  const { fmt } = useTimezone()
  const { data: weather } = useWeather()
  const now = useInitialNow()

  const { events, counts } = useToday()

  const weekLabel = React.useMemo(() => {
    if (!now) return ''
    return `${fmt(now, 'EEEE')} · Week ${fmt(now, 'I')}`
  }, [now, fmt])

  const greeting = React.useMemo(() => {
    if (!now) return 'Hello'
    const h = Number(fmt(now, 'H'))
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  }, [now, fmt])

  // Recent means happened. Scheduled entries belong to Today and Next up on
  // the right, not to the top of a history feed.
  const { data: entries } = useQuery({
    queryKey: ['entries', 'recent'],
    queryFn: () => api.get<any[]>('/api/entries?take=8&past=1'),
  })
  const { data: drafts } = useDrafts()

  const draftItems = React.useMemo(
    () => [
      ...(drafts?.contacts ?? []).map((c: any) => ({
        id: c.id,
        label: c.displayName,
        icon: Users,
        href: `/contacts/${c.slug}`,
      })),
      ...(drafts?.projects ?? []).map((p: any) => ({
        id: p.id,
        label: p.name,
        icon: FolderKanban,
        href: `/projects/${p.slug}`,
      })),
      ...(drafts?.tasks ?? []).map((t: any) => ({
        id: t.id,
        label: t.title,
        icon: SquareCheck,
        task: t.id,
      })),
    ],
    [drafts],
  )

  // Deadlines, follow-ups and anything scheduled past today. Today's own items
  // already show above, so repeating them here would be the same list twice.
  const nextUp = useUpcoming()

  const openEvent = (source: string, id: string) => {
    if (source === 'task') setOpenTask(id)
    else if (source === 'entry') router.push(`/notes/${id}`)
    else if (source === 'project') router.push(`/projects/${id}`)
    else router.push(`/contacts/${id}`)
  }

  const scheduleLine = now
    ? `${counts.comms} communication${counts.comms === 1 ? '' : 's'} and ${counts.tasks} task${counts.tasks === 1 ? '' : 's'} scheduled for today.`
    : 'Capture anything below — the people and tasks you mention get created as you write.'

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-8 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--primary)]">
            {weekLabel || ' '}
          </p>
          <h1 className="mt-1 text-[2.6rem] leading-[1.08]">
            {greeting}, {settings.userName}.
          </h1>
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{scheduleLine}</p>
        </div>
        <div className="pt-6 text-right">
          <p className="display text-[1.4rem] leading-none">
            {now ? fmt(now, 'MMMM d, yyyy') : ''}
          </p>
          {weather?.enabled && (
            <p className="mt-2 flex items-center justify-end gap-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <CloudSun className="h-3 w-3" />
              {weather.error
                ? weather.error
                : `${weather.location} · ${weather.temperature}°${weather.unit} · ${weatherLabel(weather.code)}`}
            </p>
          )}
        </div>
      </header>

      {/* Spans both columns on purpose. Half-created entities are a queue you
          work off, not a panel you live with, so they get a rail of their own
          above the page rather than a permanent tile beside it. */}
      {draftItems.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-dashed border-[color-mix(in_oklch,var(--warning)_45%,transparent)] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3.5 py-2.5">
          <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--warning)]">
            <PenLine className="h-3 w-3" /> Needs details
          </span>
          {draftItems.slice(0, 6).map((d) => {
            const inner = (
              <>
                <d.icon className="h-3 w-3 opacity-70" />
                <span className="max-w-[12rem] truncate">{d.label}</span>
              </>
            )
            const cls =
              'inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs transition-colors hover:border-[var(--warning)]'
            return d.task ? (
              <button key={d.id} onClick={() => setOpenTask(d.task!)} className={cls}>
                {inner}
              </button>
            ) : (
              <Link key={d.id} href={d.href!} className={cls}>
                {inner}
              </Link>
            )
          })}
          {draftItems.length > 6 && (
            <span className="text-xs text-[var(--muted-foreground)]">
              +{draftItems.length - 6} more
            </span>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <UnifiedComposer />

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[1.35rem]">Recent activity</h2>
              <Link
                href="/notes"
                className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              {!entries && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
              {entries?.length === 0 && (
                <EmptyState
                  title="Nothing captured yet"
                  hint="Your first note will show up here."
                />
              )}
              {entries?.map((e) => (
                <EntryCard key={e.id} entry={e} compact />
              ))}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-8">
          <TodayPanel events={events} onOpen={openEvent}>
            {nextUp.length > 0 && (
              <Inset label="Next up" meta="what's ahead">
                <div className="flex flex-col gap-1.5">
                  {nextUp.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => openEvent(e.source, e.entityId)}
                      className="flex items-center gap-2 text-left text-[13px] transition-opacity hover:opacity-70"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: e.color }}
                        title={CATEGORY_META[e.category].short}
                      />
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                        {/* A due date is a calendar day; shifting it into a
                            zone is what turned an Oct 5 target into Oct 4. */}
                        {e.allDay ? format(calendarDate(e.start)!, 'MMM d') : fmt(e.start, 'MMM d')}
                      </span>
                    </button>
                  ))}
                </div>
              </Inset>
            )}
          </TodayPanel>

          <PeopleOrbit />
        </aside>
      </div>

      <TaskDialog taskId={openTask} onClose={() => setOpenTask(null)} />
    </div>
  )
}
