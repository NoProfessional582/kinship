/**
 * Calendar vocabulary — shared by the server feed, the month grid, the Today
 * brief, Next up and the contact dossier. Deliberately free of any Prisma or
 * node import so a client component can name a category without pulling the
 * database driver into the browser bundle.
 *
 * `occurredAt` answers two different questions depending on the entry: for a
 * note typed just now it is a filing date, for a meeting next Tuesday it is an
 * appointment. Treating both as calendar events is what put every note on the
 * grid. The category is what each surface subscribes to instead.
 */
export type EventCategory =
  /** Any entry dated in the future. Kind is irrelevant — a date that has not
   *  arrived yet is something you plan to do. */
  | 'scheduled'
  /** An EVENT entry: something on the calendar that is not a communication.
   *  The only category where kind beats the date — an appointment is the same
   *  thing the morning after as the morning before, and moving it into another
   *  bucket the moment it passes is how you lose track of what you attended. */
  | 'event'
  /** A past encounter: it took place at a time and is worth seeing again. */
  | 'meeting'
  /** An entry that continues an earlier one. It outranks 'scheduled' before
   *  its date and 'log' after it, for as long as nothing has been written into
   *  it: a promised conversation that never happened is the one thing on the
   *  calendar you most need to still be able to see. */
  | 'followup'
  /** A task's due or start date. */
  | 'deadline'
  /** Birthdays and other fixed recurring dates. */
  | 'milestone'
  /** A past note, email, text or DM. A record, not an appointment; the only
   *  category the calendar hides by default. */
  | 'log'

export const EVENT_CATEGORIES: EventCategory[] = [
  'event', 'scheduled', 'meeting', 'followup', 'deadline', 'milestone', 'log',
]

/** Everything except the filing noise. What the day views subscribe to. */
export const AGENDA_CATEGORIES: EventCategory[] = [
  'event', 'scheduled', 'meeting', 'followup', 'deadline', 'milestone',
]

/**
 * One name and one colour per category, shared by the calendar chips, the
 * dashboard's Next up and the dossier's upcoming block. A follow-up is ochre
 * everywhere or the colour stops meaning anything.
 */
export const CATEGORY_META: Record<EventCategory, { label: string; short: string; tint: string }> = {
  event: { label: 'Events', short: 'Event', tint: '#5b7f8c' },
  scheduled: { label: 'Scheduled', short: 'Scheduled', tint: '#4a6572' },
  meeting: { label: 'Meetings', short: 'Meeting', tint: '#8c5a4a' },
  followup: { label: 'Follow-ups', short: 'Follow-up', tint: '#ba8a42' },
  deadline: { label: 'Deadlines', short: 'Deadline', tint: '#697760' },
  milestone: { label: 'Milestones', short: 'Milestone', tint: '#a06a86' },
  log: { label: 'Notes & messages', short: 'Logged', tint: '#7a6a86' },
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end?: string
  allDay: boolean
  source: 'task' | 'entry' | 'birthday' | 'project'
  category: EventCategory
  entityId: string
  color: string
  editable: boolean
  meta?: Record<string, unknown>
}
