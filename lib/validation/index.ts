import { z } from 'zod'

/**
 * One schema per entity, imported by both the API route and the form that
 * feeds it. The shape is never written down twice.
 */

export const entryKindSchema = z.enum([
  'NOTE',
  'CALL',
  'EMAIL',
  'TEXT',
  'MEETING',
  'IN_PERSON',
  'SOCIAL',
  'EVENT',
])
export const directionSchema = z.enum(['INBOUND', 'OUTBOUND'])
export const taskStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'ARCHIVED'])
export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

const optionalDate = z.coerce.date().nullish()
const trimmed = (max: number) => z.string().trim().max(max)

/**
 * A date that must actually be one.
 *
 * `z.coerce.date()` runs `new Date(value)` *before* it validates, and
 * `new Date(null)` is the Unix epoch rather than an error — so `start: null`
 * passed as 1970-01-01 and was written straight to the row, silently moving an
 * entry to the bottom of every date-ordered feed. A union with no null member
 * refuses it instead, which is what makes the 400 promised below actually
 * happen. `optionalDate` is unaffected: `.nullish()` short-circuits on null, so
 * there the value stays null instead of being coerced.
 */
const strictDate = z.union([z.string().min(1), z.number(), z.date()]).pipe(z.coerce.date())

// ------------------------------------------------------------------ Entries

export const pendingEntitySchema = z.object({
  tempId: z.string().startsWith('new:'),
  type: z.enum(['contact', 'task', 'project']),
  label: trimmed(200).min(1),
})

/**
 * The fields an entry carries, with no defaults on any of them.
 *
 * `.partial()` makes a key optional but leaves its `.default()` in place, so a
 * default written here would still fire on an absent key. That is how a PATCH
 * carrying nothing but a body came to silently re-date the entry to now, reset
 * its kind to NOTE and clear its tags. Defaults belong to the create schema
 * alone, where an absent key really does mean "use the usual value".
 */
const entryFields = {
  kind: entryKindSchema,
  title: trimmed(200).nullish(),
  bodyJson: z.any(),
  occurredAt: strictDate,
  direction: directionSchema.nullish(),
  durationMin: z
    .number()
    .int()
    .min(0)
    .max(60 * 24)
    .nullish(),
  location: trimmed(200).nullish(),
  /**
   * When to pick this conversation back up. Not a column: the save creates a
   * second entry dated to it, linked back to this one, so the follow-up can
   * carry its own agenda and its own people — and so writing it up afterwards
   * is filling in a note that already exists.
   */
  followUpAt: optionalDate,
  /** The project this entry belongs to, as opposed to one it merely mentions. */
  projectId: z.string().min(1).nullish(),
  tags: z.array(trimmed(50).min(1)),
  /** Entities the note asked to create inline; resolved inside the save transaction. */
  pendingEntities: z.array(pendingEntitySchema),
}

export const createEntrySchema = z.object(entryFields).extend({
  kind: entryFields.kind.default('NOTE'),
  occurredAt: entryFields.occurredAt.default(() => new Date()),
  tags: entryFields.tags.default([]),
  pendingEntities: entryFields.pendingEntities.default([]),
})

/**
 * A real partial: an absent key means "leave this alone", which is what
 * `updateEntry` reads it as. Every write there is guarded on `!== undefined`.
 *
 * `pendingEntities` is kept rather than omitted: an edit can introduce a new
 * inline entity exactly the way a first save can, and it carries the label
 * hints for it. Dropping the field meant an edit stored a `new:` placeholder
 * that nothing ever resolved.
 */
export const updateEntrySchema = z.object(entryFields).partial()

// ----------------------------------------------------------------- Contacts

export const tierSchema = z.enum(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4'])
export const cadenceSchema = z.enum([
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
  'NONE',
])
export const entityTypeSchema = z.enum(['contact', 'project', 'task', 'entry'])

/** GET /api/edges: whose edges to list. An unchecked type named no table and failed as a 500. */
export const edgeListSchema = z.object({
  type: entityTypeSchema.default('contact'),
  id: z.string().min(1),
})

export const edgeSchema = z.object({
  sourceType: entityTypeSchema,
  sourceId: z.string().min(1),
  targetType: entityTypeSchema,
  targetId: z.string().min(1),
  relation: trimmed(80).min(1),
  note: trimmed(400).nullish(),
  weight: z.number().int().min(1).max(100).optional(),
})

export const contactAttributeSchema = z.object({
  category: trimmed(60),
  key: trimmed(80).min(1),
  value: trimmed(2000),
})

export const attributesSchema = z.object({
  attributes: z.array(contactAttributeSchema).default([]),
})

export const trashActionSchema = z.object({
  action: z.enum(['restore', 'purge', 'empty']),
  kind: z.enum(['contact', 'entry', 'task', 'project']).optional(),
  id: z.string().min(1).optional(),
  /**
   * The `deletedAt` the trash view was showing when the purge was chosen.
   * Optional so an API caller is not forced to supply it, but when it is sent
   * a mismatch means the row was restored and re-trashed since — the action is
   * acting on a view that is no longer true, and the service refuses it.
   */
  deletedAt: z.string().datetime().optional(),
})

export const channelTypeSchema = z.enum(['PHONE', 'EMAIL', 'SLACK', 'TEAMS', 'LINKEDIN', 'OTHER'])

export const contactChannelSchema = z.object({
  type: channelTypeSchema,
  /** Handle, username, address or number, depending on the channel. */
  value: trimmed(300).min(1),
  label: trimmed(60).nullish(),
  isPreferred: z.boolean().default(false),
})

export const contactPositionSchema = z.object({
  role: trimmed(160).min(1),
  organization: trimmed(160).nullish(),
  team: trimmed(160).nullish(),
  startDate: optionalDate,
  endDate: optionalDate,
  isCurrent: z.boolean().default(false),
})

export const contactMilestoneSchema = z.object({
  title: trimmed(200).min(1),
  date: optionalDate,
  note: trimmed(500).nullish(),
})

/**
 * Link targets become live anchors on the dossier, so the scheme is part of
 * validation rather than a display concern: `javascript:...` in an href runs on
 * click. A bare "example.com" is still accepted and normalized to https, which
 * is how these are usually typed.
 */
const safeUrl = trimmed(600)
  .min(1)
  .transform((v) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`))
  .refine((v) => /^(https?:\/\/|mailto:)/i.test(v), 'Links must be http(s) or mailto')

export const contactLinkSchema = z.object({
  label: trimmed(100).min(1),
  url: safeUrl,
})

export const upsertContactSchema = z.object({
  displayName: trimmed(160).min(1, 'A name is required'),
  firstName: trimmed(80).nullish(),
  lastName: trimmed(80).nullish(),
  nickname: trimmed(80).nullish(),
  pronouns: trimmed(40).nullish(),
  avatarUrl: trimmed(500).nullish(),

  /** Short tagline under the name. */
  headline: trimmed(200).nullish(),
  /** Derived from the position marked current; accepted for direct edits too. */
  company: trimmed(160).nullish(),
  jobTitle: trimmed(160).nullish(),
  location: trimmed(160).nullish(),
  birthday: optionalDate,

  tier: tierSchema.default('TIER_3'),
  cadence: cadenceSchema.default('NONE'),

  howWeMet: trimmed(2000).nullish(),
  bio: trimmed(8000).nullish(),
  personalContext: trimmed(8000).nullish(),
  notes: trimmed(20000).nullish(),

  interests: z.array(trimmed(60).min(1)).default([]),
  customFields: z.record(z.string(), z.string()).default({}),
  tags: z.array(trimmed(50).min(1)).default([]),

  channels: z.array(contactChannelSchema).default([]),
  positions: z.array(contactPositionSchema).default([]),
  milestones: z.array(contactMilestoneSchema).default([]),
  links: z.array(contactLinkSchema).default([]),

  /**
   * Optional so the dedicated attributes endpoint can still own them alone.
   * When present the upsert replaces the whole set, which is what lets a single
   * save carry them: while they travelled only on their own endpoint, every
   * caller that forgot the second call — the create page and the enrichment
   * queue both did — dropped them silently.
   */
  attributes: z.array(contactAttributeSchema).optional(),

  /** Clearing this graduates an inline-created contact out of the draft tray. */
  isDraft: z.boolean().optional(),
})

// -------------------------------------------------------- Projects & Tasks

export const upsertProjectSchema = z.object({
  name: trimmed(160).min(1, 'A name is required'),
  description: trimmed(8000).nullish(),
  color: trimmed(20).nullish(),
  status: taskStatusSchema.default('TODO'),
  startDate: optionalDate,
  targetDate: optionalDate,
  /** See `Task.allDay`. Defaults to a whole-day span, which is the common case. */
  allDay: z.boolean().default(true),
  isDraft: z.boolean().optional(),
})

export const upsertTaskSchema = z.object({
  title: trimmed(300).min(1, 'A title is required'),
  description: trimmed(8000).nullish(),
  // No status field: it is derived from the chosen column, so the two can never
  // be set to contradict one another.
  priority: prioritySchema.default('MEDIUM'),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  columnId: z.string().nullish(),
  startDate: optionalDate,
  dueDate: optionalDate,
  /**
   * Whether the two dates above are calendar days or instants. The client sends
   * a bare "YYYY-MM-DD" when true and a full instant when false; this flag is
   * what tells every reader which of the two it is looking at.
   */
  allDay: z.boolean().default(true),
  assigneeIds: z.array(z.string()).default([]),
  tags: z.array(trimmed(50).min(1)).default([]),
  isDraft: z.boolean().optional(),
})

export const moveTaskSchema = z.object({
  columnId: z.string().min(1),
  /**
   * Fallback only. An index into what the user could SEE, which is not the
   * destination column whenever the board is filtered to a project or split
   * into swimlanes. The neighbour ids below are the real instruction.
   */
  toIndex: z.number().int().min(0),
  projectId: z.string().nullish(),
  /** Id of the visible card immediately above the drop slot, if any. */
  beforeId: z.string().nullish(),
  /** Id of the visible card immediately below the drop slot, if any. */
  afterId: z.string().nullish(),
})

export const reorderColumnsSchema = z.object({
  columnIds: z.array(z.string().min(1)).min(1),
})

export const upsertColumnSchema = z.object({
  name: trimmed(80).min(1),
  color: trimmed(20).nullish(),
  wipLimit: z.number().int().min(1).nullish(),
  /** The workflow state cards take on by sitting in this column. */
  status: taskStatusSchema.default('TODO'),
})

// ------------------------------------------------------------------ Queries

export const calendarQuerySchema = z.object({
  start: strictDate,
  end: strictDate,
})

/**
 * A drag off the calendar grid. Validated rather than trusted: `new Date(x)`
 * on anything unparseable yields an Invalid Date, which reaches Prisma as a
 * 500 instead of the 400 a bad request deserves.
 */
export const rescheduleSchema = z.object({
  source: z.enum(['task', 'entry', 'project']),
  entityId: z.string().min(1),
  start: strictDate,
  end: strictDate.nullish(),
})

export const entryListSchema = z.object({
  contactId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  kind: entryKindSchema.optional(),
  /** Bounded: an unparseable or absurd `take` otherwise reaches the database. */
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
  /**
   * `past=1` drops anything dated forward. The feed is a full archive and shows
   * everything, but a panel headed "recent activity" must not lead with a
   * dinner next Saturday — and the cut has to happen on the server, so the
   * client is not putting a clock reading into its query key.
   */
  past: z.enum(['1', 'true']).optional(),
  /** `upcoming=1` is the other half: only what is still ahead, nearest first. */
  upcoming: z.enum(['1', 'true']).optional(),
})

export const mentionSearchSchema = z.object({
  type: z.enum(['contact', 'entity']),
  q: z.string().default(''),
})

export type CreateEntryInput = z.infer<typeof createEntrySchema>
export type UpsertContactInput = z.infer<typeof upsertContactSchema>
export type UpsertTaskInput = z.infer<typeof upsertTaskSchema>
export type UpsertProjectInput = z.infer<typeof upsertProjectSchema>

/** Null timezone means "follow the browser". */
export const settingsSchema = z.object({
  userName: trimmed(80).optional(),
  appTitle: trimmed(60).optional(),
  tagline: trimmed(160).optional(),
  weatherEnabled: z.boolean().optional(),
  weatherLocation: trimmed(120).optional(),
  weatherUnit: z.enum(['fahrenheit', 'celsius']).optional(),
  calendarWeekStart: z.enum(['sunday', 'monday']).optional(),
  fontScale: z.number().min(0.85).max(1.35).optional(),
  defaultCadence: cadenceSchema.optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz })
          return true
        } catch {
          return false
        }
      },
      { message: 'Not a recognised IANA timezone' },
    )
    .nullable()
    .optional(),
})
