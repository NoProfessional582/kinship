import { prisma } from '../db'
import { HL_OPTIONS, highlightSnippet } from '../search-highlight'

export interface MentionSuggestion {
  id: string
  label: string
  kind: 'contact' | 'task' | 'project'
  sublabel?: string | null
  isDraft?: boolean
}

/**
 * Feeds the `@` and `[[` dropdowns. Exact prefix matches rank first, then
 * trigram similarity, so a misspelled name still finds the right record.
 */
export async function searchMentions(
  owner: string,
  type: 'contact' | 'entity',
  q: string,
  limit = 8,
): Promise<MentionSuggestion[]> {
  const term = q.trim()

  if (type === 'contact') {
    if (!term) {
      const recent = await prisma.contact.findMany({
        where: { owner, deletedAt: null },
        select: { id: true, displayName: true, company: true, jobTitle: true, isDraft: true },
        orderBy: [{ lastContactAt: { sort: 'desc', nulls: 'last' } }, { displayName: 'asc' }],
        take: limit,
      })
      return recent.map(toContactSuggestion)
    }

    const rows = await prisma.$queryRaw<
      { id: string; displayName: string; company: string | null; jobTitle: string | null; isDraft: boolean }[]
    >`
      SELECT id, "displayName", company, "jobTitle", "isDraft"
      FROM "Contact"
      WHERE "owner" = ${owner} AND "deletedAt" IS NULL
        AND ("displayName" ILIKE ${term + '%'}
             OR "displayName" ILIKE ${'%' + term + '%'}
             OR similarity("displayName", ${term}) > 0.2)
      ORDER BY ("displayName" ILIKE ${term + '%'}) DESC,
               similarity("displayName", ${term}) DESC,
               "displayName" ASC
      LIMIT ${limit}
    `
    return rows.map(toContactSuggestion)
  }

  // `[[` searches tasks and projects together.
  const [tasks, projects] = await Promise.all([
    term
      ? prisma.$queryRaw<{ id: string; title: string; status: string }[]>`
          SELECT id, title, status::text AS status FROM "Task"
          WHERE "owner" = ${owner} AND "deletedAt" IS NULL
            AND (title ILIKE ${'%' + term + '%'} OR similarity(title, ${term}) > 0.2)
          ORDER BY (title ILIKE ${term + '%'}) DESC, similarity(title, ${term}) DESC
          LIMIT ${limit}
        `
      : prisma.task.findMany({
          where: { owner, deletedAt: null },
          select: { id: true, title: true, status: true },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        }),
    term
      ? prisma.$queryRaw<{ id: string; name: string; status: string }[]>`
          SELECT id, name, status::text AS status FROM "Project"
          WHERE "owner" = ${owner} AND "deletedAt" IS NULL
            AND (name ILIKE ${'%' + term + '%'} OR similarity(name, ${term}) > 0.2)
          ORDER BY (name ILIKE ${term + '%'}) DESC, similarity(name, ${term}) DESC
          LIMIT ${limit}
        `
      : prisma.project.findMany({
          where: { owner, deletedAt: null },
          select: { id: true, name: true, status: true },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        }),
  ])

  return [
    ...(projects as any[]).map((p) => ({
      id: p.id, label: p.name, kind: 'project' as const, sublabel: 'project',
    })),
    ...(tasks as any[]).map((t) => ({
      id: t.id, label: t.title, kind: 'task' as const, sublabel: 'task',
    })),
  ].slice(0, limit)
}

function toContactSuggestion(c: {
  id: string; displayName: string; company: string | null; jobTitle: string | null; isDraft: boolean
}): MentionSuggestion {
  const bits = [c.jobTitle, c.company].filter(Boolean)
  return {
    id: c.id,
    label: c.displayName,
    kind: 'contact',
    sublabel: c.isDraft ? 'draft' : bits.join(' · ') || null,
    isDraft: c.isDraft,
  }
}

export interface SearchHit {
  id: string
  kind: 'entry' | 'contact' | 'task' | 'project'
  title: string
  snippet?: string | null
  href: string
  rank: number
}

/** Command-palette search: Postgres FTS over entries and contacts, trigram over the rest. */
export async function globalSearch(owner: string, q: string, limit = 20): Promise<SearchHit[]> {
  const term = q.trim()
  if (!term) return []

  const [entries, contacts, tasks, projects] = await Promise.all([
    prisma.$queryRaw<{ id: string; title: string | null; snippet: string; rank: number }[]>`
      SELECT id,
             title,
             ts_headline('english', "bodyText", plainto_tsquery('english', ${term}),
                         ${HL_OPTIONS}) AS snippet,
             ts_rank("searchVector", plainto_tsquery('english', ${term})) AS rank
      FROM "Entry"
      WHERE "owner" = ${owner} AND "deletedAt" IS NULL
        AND "searchVector" @@ plainto_tsquery('english', ${term})
      ORDER BY rank DESC LIMIT ${limit}
    `,
    prisma.$queryRaw<{ id: string; slug: string; displayName: string; jobTitle: string | null; rank: number }[]>`
      SELECT id, slug, "displayName", "jobTitle",
             GREATEST(
               ts_rank("searchVector", plainto_tsquery('english', ${term})),
               similarity("displayName", ${term})
             ) AS rank
      FROM "Contact"
      WHERE "owner" = ${owner} AND "deletedAt" IS NULL
        AND ("searchVector" @@ plainto_tsquery('english', ${term})
             OR similarity("displayName", ${term}) > 0.2
             OR "displayName" ILIKE ${'%' + term + '%'})
      ORDER BY rank DESC LIMIT ${limit}
    `,
    prisma.$queryRaw<{ id: string; slug: string; title: string; rank: number }[]>`
      SELECT id, slug, title, similarity(title, ${term}) AS rank FROM "Task"
      WHERE "owner" = ${owner} AND "deletedAt" IS NULL
        AND (title ILIKE ${'%' + term + '%'} OR similarity(title, ${term}) > 0.2)
      ORDER BY rank DESC LIMIT ${limit}
    `,
    prisma.$queryRaw<{ id: string; slug: string; name: string; rank: number }[]>`
      SELECT id, slug, name, similarity(name, ${term}) AS rank FROM "Project"
      WHERE "owner" = ${owner} AND "deletedAt" IS NULL
        AND (name ILIKE ${'%' + term + '%'} OR similarity(name, ${term}) > 0.2)
      ORDER BY rank DESC LIMIT ${limit}
    `,
  ])

  const hits: SearchHit[] = [
    ...entries.map((e) => ({
      id: e.id, kind: 'entry' as const, title: e.title || 'Untitled',
      snippet: highlightSnippet(e.snippet), href: `/notes/${e.id}`, rank: Number(e.rank) + 0.05,
    })),
    ...contacts.map((c) => ({
      id: c.id, kind: 'contact' as const, title: c.displayName,
      snippet: c.jobTitle, href: `/contacts/${c.slug}`, rank: Number(c.rank) + 0.1,
    })),
    ...tasks.map((t) => ({
      id: t.id, kind: 'task' as const, title: t.title, snippet: null,
      href: `/board?task=${t.id}`, rank: Number(t.rank),
    })),
    ...projects.map((p) => ({
      id: p.id, kind: 'project' as const, title: p.name, snippet: null,
      href: `/projects/${p.slug}`, rank: Number(p.rank),
    })),
  ]

  return hits.sort((a, b) => b.rank - a.rank).slice(0, limit)
}
