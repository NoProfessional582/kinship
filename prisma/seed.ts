import 'dotenv/config'
import { prisma } from '../lib/db'
import { ensureColumns } from '../lib/services/board'
import { createEntry } from '../lib/services/entries'
import { CONTACT_MENTION, ENTITY_REF } from '../lib/tiptap/nodes'
import { requireConfiguredOwner } from '../lib/identity'
import type { ProseNode } from '../lib/tiptap/doc'

/**
 * Seeds the default board and a small demo network that exercises every
 * subsystem: mentions, refs, co-mention edges, explicit relationships,
 * due dates and birthdays. Safe to re-run — it no-ops if data already exists.
 */

const t = (text: string) => ({ type: 'text', text })
const at = (id: string, label: string) => ({ type: CONTACT_MENTION, attrs: { id, label } })
const ref = (id: string, kind: string, label: string) => ({
  type: ENTITY_REF,
  attrs: { id, kind, label },
})
const para = (...content: ProseNode[]): ProseNode => ({ type: 'paragraph', content })
const doc = (...content: ProseNode[]): ProseNode => ({ type: 'doc', content })

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000)

async function main() {
  const owner = requireConfiguredOwner()
  const existing = await prisma.contact.count({ where: { owner } })
  if (existing > 0) {
    console.log(`Database already has ${existing} contacts — skipping seed.`)
    return
  }

  console.log('Creating default board columns…')
  await ensureColumns(prisma, owner)

  console.log('Writing demo entries (this also creates the people and tasks)…')

  // Entry 1 — creates Maya, the project, and a task in one go.
  await createEntry(owner, {
    kind: 'CALL',
    direction: 'OUTBOUND',
    durationMin: 25,
    location: 'Zoom',
    title: 'Kickoff call — website redesign',
    occurredAt: daysAgo(9),
    tags: ['q3', 'kickoff'],
    bodyJson: doc(
      para(
        t('Kickoff with '),
        at('new:maya', 'Maya Okafor'),
        t(' on '),
        ref('new:redesign', 'project', 'Website redesign'),
        t('. She owns '),
        ref('new:sitemap', 'task', 'Draft the sitemap'),
        t(' and wants a first pass before the design review.'),
      ),
      para(t('She mentioned her team is short-staffed until the new hire starts in October.')),
    ),
    pendingEntities: [
      { tempId: 'new:maya', type: 'contact', label: 'Maya Okafor' },
      { tempId: 'new:redesign', type: 'project', label: 'Website redesign' },
      { tempId: 'new:sitemap', type: 'task', label: 'Draft the sitemap' },
    ],
  })

  const maya = await prisma.contact.findFirstOrThrow({
    where: { owner, displayName: 'Maya Okafor' },
  })

  // Entry 2 — introduces two more people alongside Maya, creating co-mention edges.
  await createEntry(owner, {
    kind: 'MEETING',
    durationMin: 60,
    location: 'Office — room 3',
    title: 'Design review',
    occurredAt: daysAgo(4),
    tags: ['design'],
    bodyJson: doc(
      para(
        t('Design review with '),
        at(maya.id, 'Maya Okafor'),
        t(', '),
        at('new:tobias', 'Tobias Lindqvist'),
        t(' and '),
        at('new:priya', 'Priya Raman'),
        t('. Tobias pushed back on the nav; Priya will handle '),
        ref('new:copy', 'task', 'Rewrite the homepage copy'),
        t('.'),
      ),
    ),
    pendingEntities: [
      { tempId: 'new:tobias', type: 'contact', label: 'Tobias Lindqvist' },
      { tempId: 'new:priya', type: 'contact', label: 'Priya Raman' },
      { tempId: 'new:copy', type: 'task', label: 'Rewrite the homepage copy' },
    ],
  })

  const tobias = await prisma.contact.findFirstOrThrow({
    where: { owner, displayName: 'Tobias Lindqvist' },
  })
  const priya = await prisma.contact.findFirstOrThrow({
    where: { owner, displayName: 'Priya Raman' },
  })
  const redesign = await prisma.project.findFirstOrThrow({
    where: { owner, name: 'Website redesign' },
  })

  // Entry 3 — a second Maya+Tobias pairing, so their inferred edge outweighs the rest.
  await createEntry(owner, {
    kind: 'EMAIL',
    direction: 'INBOUND',
    title: 'Budget question',
    occurredAt: daysAgo(2),
    tags: ['budget'],
    bodyJson: doc(
      para(
        at(maya.id, 'Maya Okafor'),
        t(' looped in '),
        at(tobias.id, 'Tobias Lindqvist'),
        t(' about the extra budget for '),
        ref(redesign.id, 'project', 'Website redesign'),
        t('. Needs an answer by Friday.'),
      ),
    ),
    pendingEntities: [],
  })

  console.log('Filling in dossiers…')
  await prisma.contact.update({
    where: { id: maya.id },
    data: {
      firstName: 'Maya',
      lastName: 'Okafor',
      pronouns: 'she/her',
      company: 'Northwind Studio',
      jobTitle: 'Product Manager',
      location: 'Portland, OR',
      birthday: new Date('1988-06-14'),
      howWeMet: 'Introduced by a mutual friend at a conference in 2023',
      bio: 'Sharp product sense, prefers async updates. Two kids, coaches soccer on weekends.',
      interests: ['sailing', 'jazz piano', 'trail running', 'Ethiopian coffee'],
      isDraft: false,
      headline: 'Product lead who prefers async, answers fastest on Slack',
      personalContext: 'Married to Dele; two kids (Ada 9, Tomi 6). Coaches weekend soccer.',
      notes: 'Prefers a written agenda 24h ahead. Do not schedule before 10am PT.',
      channels: {
        create: [
          { type: 'SLACK', value: '@maya', label: 'work', isPreferred: true, position: 0 },
          { type: 'EMAIL', value: 'maya@northwind.example', label: 'work', position: 1 },
          { type: 'PHONE', value: '+1 555 0142', label: 'mobile', position: 2 },
          { type: 'LINKEDIN', value: 'mayaokafor', position: 3 },
        ],
      },
      positions: {
        create: [
          {
            role: 'Product Manager',
            organization: 'Northwind Studio',
            team: 'Growth',
            startDate: new Date('2023-02-01'),
            isCurrent: true,
          },
          {
            role: 'Associate PM',
            organization: 'Lumen Labs',
            team: 'Platform',
            startDate: new Date('2019-06-01'),
            endDate: new Date('2023-01-15'),
          },
        ],
      },
      milestones: {
        create: [
          { title: 'Promoted to PM', date: new Date('2023-02-01') },
          {
            title: 'Ran the Portland marathon',
            date: new Date('2025-10-05'),
            note: 'Training again this year.',
          },
        ],
      },
      links: {
        create: [
          { label: 'LinkedIn', url: 'https://linkedin.com/in/mayaokafor', position: 0 },
          { label: 'Personal site', url: 'https://maya.example', position: 1 },
        ],
      },
    },
  })

  await prisma.contact.update({
    where: { id: tobias.id },
    data: {
      firstName: 'Tobias',
      lastName: 'Lindqvist',
      pronouns: 'he/him',
      company: 'Northwind Studio',
      jobTitle: 'Design Lead',
      location: 'Stockholm',
      birthday: new Date('1991-11-02'),
      interests: ['typography', 'cycling', 'film photography'],
      howWeMet: 'Maya introduced us on the redesign kickoff',
      isDraft: false,
      headline: 'Design lead, typography obsessive',
      channels: {
        create: [
          {
            type: 'EMAIL',
            value: 'tobias@northwind.example',
            label: 'work',
            isPreferred: true,
            position: 0,
          },
          { type: 'TEAMS', value: 'tobias.lindqvist', position: 1 },
        ],
      },
      positions: {
        create: [
          {
            role: 'Design Lead',
            organization: 'Northwind Studio',
            team: 'Brand',
            startDate: new Date('2021-09-01'),
            isCurrent: true,
          },
        ],
      },
    },
  })

  await prisma.contact.update({
    where: { id: priya.id },
    data: {
      firstName: 'Priya',
      lastName: 'Raman',
      pronouns: 'she/her',
      company: 'Freelance',
      jobTitle: 'Copywriter',
      location: 'Bengaluru',
      interests: ['long-form essays', 'birdwatching', 'baking'],
      headline: 'Freelance copywriter, long-form specialist',
      channels: {
        create: [{ type: 'EMAIL', value: 'priya@example.com', isPreferred: true, position: 0 }],
      },
      positions: { create: [{ role: 'Copywriter', organization: 'Freelance', isCurrent: true }] },
      isDraft: false,
    },
  })

  console.log('Adding relationships…')
  await prisma.entityEdge.createMany({
    data: [
      {
        owner,
        sourceType: 'contact',
        sourceId: tobias.id,
        targetType: 'contact',
        targetId: maya.id,
        relation: 'reports to',
      },
      {
        owner,
        sourceType: 'contact',
        sourceId: priya.id,
        targetType: 'contact',
        targetId: maya.id,
        relation: 'contracted by',
      },
    ],
    skipDuplicates: true,
  })

  console.log('Setting tiers and check-in cadence…')
  await prisma.contact.update({
    where: { id: maya.id },
    data: { tier: 'TIER_1', cadence: 'BIWEEKLY' },
  })
  await prisma.contact.update({
    where: { id: tobias.id },
    data: { tier: 'TIER_2', cadence: 'MONTHLY' },
  })
  await prisma.contact.update({
    where: { id: priya.id },
    data: { tier: 'TIER_3', cadence: 'QUARTERLY' },
  })

  await prisma.contactAttribute.createMany({
    data: [
      {
        contactId: maya.id,
        category: 'Working style',
        key: 'Meetings',
        value: 'Written agenda 24h ahead; never before 10am PT',
        position: 0,
      },
      {
        contactId: maya.id,
        category: 'Working style',
        key: 'Decisions',
        value: 'Confirms verbally, renegotiates over Slack — get it in writing',
        position: 1,
      },
      {
        contactId: maya.id,
        category: 'Preferences',
        key: 'Coffee',
        value: 'Ethiopian, black',
        position: 0,
      },
    ],
  })

  console.log('Scheduling tasks…')
  const columns = await prisma.boardColumn.findMany({
    where: { owner, projectId: null },
    orderBy: { position: 'asc' },
  })
  const project = await prisma.project.findFirstOrThrow({
    where: { owner, name: 'Website redesign' },
  })

  await prisma.project.update({
    where: { id: project.id },
    data: {
      description: 'Full marketing site rebuild — new IA, copy and visual system.',
      color: '#6366f1',
      status: 'IN_PROGRESS',
      isDraft: false,
      targetDate: daysAhead(45),
    },
  })

  const sitemap = await prisma.task.findFirstOrThrow({
    where: { owner, title: 'Draft the sitemap' },
  })
  const copy = await prisma.task.findFirstOrThrow({
    where: { owner, title: 'Rewrite the homepage copy' },
  })

  await prisma.task.update({
    where: { id: sitemap.id },
    data: {
      projectId: project.id,
      columnId: columns[2].id,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: daysAhead(3),
      isDraft: false,
      assignees: { create: [{ contactId: maya.id }] },
    },
  })

  await prisma.task.update({
    where: { id: copy.id },
    data: {
      projectId: project.id,
      columnId: columns[1].id,
      priority: 'MEDIUM',
      dueDate: daysAhead(10),
      isDraft: false,
      assignees: { create: [{ contactId: priya.id }] },
    },
  })

  // A subtask, so the card shows its progress pill.
  const { uniqueSlug } = await import('../lib/slug')
  for (const [title, done] of [
    ['Audit existing pages', true],
    ['Map redirects', false],
  ] as const) {
    await prisma.task.create({
      data: {
        owner,
        slug: await uniqueSlug('task', owner, title, prisma),
        title,
        parentTaskId: sitemap.id,
        projectId: project.id,
        columnId: done ? columns[4].id : columns[1].id,
        position: 1000,
        status: done ? 'DONE' : 'TODO',
        completedAt: done ? new Date() : null,
      },
    })
  }

  // One overdue task so the dashboard and calendar have something urgent.
  await prisma.task.create({
    data: {
      owner,
      slug: await uniqueSlug('task', owner, 'Send revised SOW', prisma),
      title: 'Send revised SOW',
      columnId: columns[1].id,
      position: 2000,
      priority: 'URGENT',
      dueDate: daysAgo(1),
      assignees: { create: [{ contactId: maya.id }] },
    },
  })

  const counts = {
    contacts: await prisma.contact.count({ where: { owner } }),
    entries: await prisma.entry.count({ where: { owner } }),
    tasks: await prisma.task.count({ where: { owner } }),
    projects: await prisma.project.count({ where: { owner } }),
    mentions: await prisma.mention.count({ where: { entry: { owner } } }),
    edges: await prisma.entityEdge.count({ where: { owner } }),
  }
  console.log('Seed complete:', counts)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
