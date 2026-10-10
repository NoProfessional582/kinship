'use client'
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { differenceInCalendarDays } from 'date-fns'
import { ArrowRight } from 'lucide-react'
import { Card, Avatar } from '@/components/ui/misc'
import { Inset } from './today-panel'
import { api, useContacts } from '@/lib/hooks/api'
import { useZonedToday } from '@/lib/hooks/settings'
import { nextAnniversary } from '@/lib/format'
import type { CadenceContact, ContactSummary } from '@/lib/api-types'

/**
 * The next birthday to fall due. Anything past the horizon is not a thing you
 * can act on, and calling it "upcoming" at 297 days out just makes the card
 * lie — so beyond it the block simply does not appear.
 */
const MILESTONE_HORIZON_DAYS = 90

function nextBirthday(contacts: ContactSummary[], today: Date) {
  const upcoming = contacts
    .flatMap((c) => (c.birthday ? [{ ...c, birthday: c.birthday }] : []))
    .map((c) => {
      // Birthdays are stored as a UTC calendar date; comparing them in local
      // time would shift half of them by a day. `nextAnniversary` also clamps
      // Feb 29 to Feb 28 rather than letting it roll into March.
      const next = nextAnniversary(c.birthday, today)
      return { contact: c, inDays: differenceInCalendarDays(next, today) }
    })
    .sort((a, b) => a.inDays - b.inDays)
  const next = upcoming[0]
  return next && next.inDays <= MILESTONE_HORIZON_DAYS ? next : null
}

export function PeopleOrbit() {
  const { data: contacts } = useContacts()
  const { data: reconnect } = useQuery({
    queryKey: ['cadence'],
    queryFn: () => api.get<CadenceContact[]>('/api/cadence'),
  })
  const today = useZonedToday()

  const list = React.useMemo(() => contacts ?? [], [contacts])

  const stats = React.useMemo(() => {
    if (!today) return null
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000)
    return {
      active: list.filter((c) => c.lastContactAt && new Date(c.lastContactAt) >= weekAgo).length,
      interactions: list.reduce((n, c) => n + c._count.mentions, 0),
    }
  }, [list, today])

  const faces = React.useMemo(
    () =>
      [...list]
        .sort(
          (a, b) =>
            new Date(b.lastContactAt ?? 0).getTime() - new Date(a.lastContactAt ?? 0).getTime(),
        )
        .slice(0, 4),
    [list],
  )

  const milestone = React.useMemo(() => (today ? nextBirthday(list, today) : null), [list, today])

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-3">
        <h2 className="text-[1.15rem]">People in orbit</h2>
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
        >
          Everyone <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mb-3 flex items-center gap-3 px-4">
        <div className="flex shrink-0 -space-x-2.5">
          {faces.map((c) => (
            <Link key={c.id} href={`/contacts/${c.slug}`} title={c.displayName}>
              <Avatar
                src={c.avatarUrl}
                name={c.displayName}
                size={32}
                className="ring-2 ring-[var(--card)] transition-transform hover:-translate-y-0.5"
              />
            </Link>
          ))}
          {faces.length === 0 && (
            <span className="text-xs text-[var(--muted-foreground)]">No one yet</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {stats ? `${stats.active} active this week` : ' '}
          </p>
          <p className="truncate text-[11px] text-[var(--muted-foreground)]">
            {stats ? `${stats.interactions} interactions logged` : ' '}
          </p>
        </div>
      </div>

      <Inset label="Worth reconnecting" meta={(reconnect ?? []).length || undefined}>
        {(reconnect ?? []).length === 0 ? (
          <p className="text-[13px] leading-snug text-[var(--muted-foreground)]">
            Everyone with a reconnect cadence is currently on track.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(reconnect ?? []).slice(0, 3).map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.slug}`}
                className="flex items-center gap-2 text-[13px] transition-opacity hover:opacity-70"
              >
                <Avatar src={c.avatarUrl} name={c.displayName} size={20} />
                <span className="min-w-0 flex-1 truncate">{c.displayName}</span>
                <span className="shrink-0 text-[11px] font-medium text-[var(--destructive)]">
                  {c.health.state === 'never'
                    ? 'never'
                    : c.health.state === 'overdue'
                      ? `${Math.abs(c.health.dueInDays ?? 0)}d over`
                      : `due in ${c.health.dueInDays}d`}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Inset>

      {milestone && (
        <Inset
          label="Upcoming milestone"
          meta={milestone.inDays === 0 ? 'today' : `in ${milestone.inDays} days`}
        >
          <Link
            href={`/contacts/${milestone.contact.slug}`}
            className="block truncate text-[13px] font-medium transition-opacity hover:opacity-70"
          >
            {milestone.contact.displayName}’s birthday
          </Link>
        </Inset>
      )}
    </Card>
  )
}
