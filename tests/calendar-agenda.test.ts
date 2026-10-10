import { describe, expect, it } from 'vitest'
import { eventsOnDay, withinDays } from '@/lib/calendar-agenda'
import type { CalendarEvent } from '@/lib/calendar-categories'

const event = (start: string, end?: string, allDay = true): CalendarEvent => ({
  id: 'span',
  title: 'Span',
  start,
  end,
  allDay,
  source: 'task',
  category: 'deadline',
  entityId: 'span',
  editable: true,
  color: '#000',
})

describe('calendar agendas include overlapping spans', () => {
  it('shows all-day spans in their interior and excludes the exclusive end', () => {
    const span = event('2031-02-01', '2031-05-02')
    expect(withinDays([span], '2031-03-01', '2031-03-31')).toEqual([span])
    expect(eventsOnDay([span], '2031-05-01', 'UTC')).toEqual([span])
    expect(eventsOnDay([span], '2031-05-02', 'UTC')).toEqual([])
    expect(eventsOnDay([span], '2031-01-31', 'UTC')).toEqual([])
  })
  it('places all-day points and reversed legacy spans only on their start day', () => {
    for (const span of [event('2031-03-01'), event('2031-03-01', '2031-02-01')]) {
      expect(eventsOnDay([span], '2031-03-01', 'UTC')).toEqual([span])
      expect(eventsOnDay([span], '2031-03-02', 'UTC')).toEqual([])
    }
  })
  it('uses the pinned timezone and exclusive timed ends across midnight', () => {
    const span = event('2031-03-01T20:00:00Z', '2031-03-02T08:00:00Z', false)
    expect(eventsOnDay([span], '2031-03-01', 'America/Los_Angeles')).toEqual([span])
    expect(eventsOnDay([span], '2031-03-02', 'America/Los_Angeles')).toEqual([])
    expect(eventsOnDay([span], '2031-03-02', 'UTC')).toEqual([span])
  })
  it('includes timed spans through a DST day without assuming 24 hours', () => {
    const span = event('2031-03-08T23:00:00Z', '2031-03-10T07:00:00Z', false)
    expect(eventsOnDay([span], '2031-03-09', 'America/Los_Angeles')).toEqual([span])
    expect(eventsOnDay([span], '2031-03-10', 'America/Los_Angeles')).toEqual([])
  })
})
