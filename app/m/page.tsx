'use client'
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowRight, Loader2, CloudSun } from 'lucide-react'
import { MobileCapture } from '@/components/mobile/capture'
import { MobileTaskSheet } from '@/components/mobile/task-sheet'
import { Section, MEmpty, MList, MRow } from '@/components/mobile/bits'
import { useToday, useUpcoming } from '@/components/dashboard/today-panel'
import { CATEGORY_META } from '@/lib/calendar-categories'
import { KIND_ICON, KIND_COLOR } from '@/components/shared/entry-card'
import { api } from '@/lib/hooks/api'
import { useSettings, useTimezone, useWeather, weatherLabel } from '@/lib/hooks/settings'
import { calendarDate, entryTitle } from '@/lib/utils'
import { m } from '@/lib/mobile/href'

/**
 * Today, then capture, then what happened recently.
 *
 * The desktop dashboard puts the composer first and the day's schedule in a
 * right-hand rail. Stacked on a phone that order inverts what the screen is
 * for: you open it to see what is on, and capture should be one tap away
 * rather than the first thing you scroll past.
 */
export default function MobileToday() {
  const router = useRouter()
  const settings = useSettings()
  const { fmt } = useTimezone()
  const { data: weather } = useWeather()
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [now, setNow] = React.useState<Date | null>(null)
  // After mount only: the greeting depends on the clock and would otherwise
  // differ between the server and client renders.
  React.useEffect(() => setNow(new Date()), [])

  const { events, counts } = useToday()
  const nextUp = useUpcoming()

  const { data: entries } = useQuery({
    queryKey: ['entries', 'recent'],
    queryFn: () => api.get<any[]>('/api/entries?take=6&past=1'),
  })

  const greeting = React.useMemo(() => {
    if (!now) return 'Hello'
    const h = Number(fmt(now, 'H'))
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  }, [now, fmt])

  const open = (source: string, id: string) => {
    if (source === 'task') setOpenTask(id)
    else if (source === 'entry') router.push(m(`/notes/${id}`))
    else if (source === 'project') router.push(m(`/projects/${id}`))
    else router.push(m(`/contacts/${id}`))
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--primary)]">
          {now ? `${fmt(now, 'EEEE')} · ${fmt(now, 'MMM d')}` : ' '}
        </p>
        <h1 className="mt-1 text-[1.6rem] leading-[1.15]">{greeting}, {settings.userName}.</h1>
        <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
          {now
            ? `${counts.comms} communication${counts.comms === 1 ? '' : 's'} · ${counts.tasks} task${counts.tasks === 1 ? '' : 's'} today.`
            : 'Loading your day…'}
        </p>
        {weather?.enabled && !weather.error && (
          <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            <CloudSun className="h-3 w-3" />
            {weather.location} · {weather.temperature}°{weather.unit} · {weatherLabel(weather.code)}
          </p>
        )}
      </header>

      <MobileCapture />

      <Section title="Today">
        {events.length === 0 ? <MEmpty>A clear day.</MEmpty> : (
          <MList>
            {events.map((e) => (
              <MRow
                key={e.id}
                onClick={() => open(e.source, e.entityId)}
                lead={<span className="h-2 w-2 rounded-full" style={{ background: e.color }} title={CATEGORY_META[e.category].short} />}
                title={e.title}
                meta={e.allDay ? 'All day' : fmt(e.start, 'HH:mm')}
              />
            ))}
          </MList>
        )}
      </Section>

      {nextUp.length > 0 && (
        <Section title="Next up">
          {/* A due date is a calendar day; shifting it into a zone is what
              turned an Oct 5 target into Oct 4. */}
          <MList>
            {nextUp.map((e) => (
              <MRow
                key={e.id}
                onClick={() => open(e.source, e.entityId)}
                lead={<span className="h-2 w-2 rounded-full" style={{ background: e.color }} />}
                title={e.title}
                meta={e.allDay ? format(calendarDate(e.start)!, 'MMM d') : fmt(e.start, 'MMM d')}
              />
            ))}
          </MList>
        </Section>
      )}

      <Section
        title="Recent"
        action={<Link href={m('/notes')} className="kb-tap-inline gap-1 text-[11px] text-[var(--muted-foreground)]">All <ArrowRight className="h-3 w-3" /></Link>}
      >
        {!entries && (
          <div className="flex items-center justify-center gap-2 py-5 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {entries?.length === 0 && <MEmpty>Your first note will show up here.</MEmpty>}
        <MList>
          {entries?.map((e) => {
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

      <MobileTaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
    </div>
  )
}
