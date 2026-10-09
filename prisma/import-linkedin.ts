import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { prisma } from '../lib/db'
import { createContact } from '../lib/services/contacts'
import { requireConfiguredOwner } from '../lib/identity'

/**
 * Imports a LinkedIn "Connections.csv" export as contacts.
 *
 *   npm run import:linkedin -- [--dry-run] [--names=clean|keep] [--no-credentials]
 *
 * Re-running is safe: a connection whose LinkedIn profile URL is already on a
 * contact is skipped rather than duplicated. Matching on the URL and not on the
 * name is deliberate — the name is the field people edit after import.
 */

const CSV = process.env.LINKEDIN_CSV ?? '/app/.linkedin-export/Connections.csv'
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const KEEP_NAMES = argv.includes('--names=keep')
const KEEP_CREDENTIALS = !argv.includes('--no-credentials')
const TAG = 'linkedin'
const owner = requireConfiguredOwner()

// ------------------------------------------------------------------ parsing

/** LinkedIn prefixes the file with a three-line note before the real header. */
function csvBody(raw: string): string {
  const i = raw.indexOf('First Name,Last Name')
  if (i < 0) throw new Error('Not a LinkedIn Connections.csv — header row not found')
  return raw.slice(i)
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      /* CRLF */
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

// ------------------------------------------------------------------- names

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu

/** Generational suffixes are part of the name; postnominal letters are not. */
const GENERATIONAL = new Set(['II', 'III', 'IV', 'V', 'VI', 'JR', 'SR', 'JR.', 'SR.'])

const tidy = (s: string) => s.replace(EMOJI, '').replace(/\s+/g, ' ').trim()

/**
 * Splits "Blasi, PMP" into the surname and the letters after it. LinkedIn has
 * no field for credentials, so people append them to the last name; carrying
 * them through would sort "Davis IV, PMP" under D-a-v-i-s-space-I and print
 * the whole string everywhere a name appears.
 */
function splitCredentials(lastRaw: string): { last: string; credentials: string } {
  const comma = lastRaw.indexOf(',')
  let last = comma >= 0 ? lastRaw.slice(0, comma) : lastRaw
  const after = comma >= 0 ? lastRaw.slice(comma + 1) : ''
  const creds: string[] = []

  // ...and parenthesised ("Curry (MA)"). Uppercase-only, so a parenthesised
  // nickname or a maiden name survives.
  for (;;) {
    const m = last.trim().match(/^(.*\S)\s*\(([A-Z][A-Z.\-]{1,7})\)$/)
    if (!m || GENERATIONAL.has(m[2].replace(/\./g, ''))) break
    creds.unshift(m[2])
    last = m[1]
  }

  // A credential also turns up space-separated before any comma ("Cooney CBCP").
  for (;;) {
    const m = last.trim().match(/^(.*\S)\s+([A-Z][A-Za-z.\-]*[A-Z][A-Za-z.\-]*)$/)
    if (!m) break
    const token = m[2].replace(/\./g, '').toUpperCase()
    if (GENERATIONAL.has(token) || GENERATIONAL.has(m[2].toUpperCase())) break
    creds.unshift(m[2])
    last = m[1]
  }
  if (after.trim()) creds.push(after.trim())

  return { last: tidy(last), credentials: tidy(creds.join(', ').replace(/\s*,\s*/g, ', ')) }
}

// ------------------------------------------------------------------- fields

/** "https://www.linkedin.com/in/justinryancarver" -> "justinryancarver" */
function handleOf(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}

/** LinkedIn writes "20 Aug 2026". Anchor at UTC noon so no zone shifts the day. */
function parseConnectedOn(v: string): Date | null {
  if (!v.trim()) return null
  const d = new Date(`${v.trim()} 12:00:00 UTC`)
  return isNaN(d.getTime()) ? null : d
}

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// --------------------------------------------------------------------- main

async function main() {
  const rows = parseCsv(csvBody(readFileSync(CSV, 'utf8')))
  const header = rows[0].map((h) => h.trim())
  const recs = rows
    .slice(1)
    .map(
      (r) =>
        Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])) as Record<
          string,
          string
        >,
    )

  // Rows carrying only a date are connections whose profile is gone or hidden.
  const named = recs.filter((r) => r['First Name'] || r['Last Name'])
  const blank = recs.length - named.length

  const existing = await prisma.contactLink.findMany({
    where: { label: 'LinkedIn', contact: { owner } },
    select: { url: true },
  })
  const seen = new Set(existing.map((l) => l.url.replace(/\/+$/, '').toLowerCase()))

  let created = 0,
    skipped = 0,
    withCreds = 0
  const report: string[] = []

  for (const r of named) {
    const url = r['URL'].trim()
    const key = url.replace(/\/+$/, '').toLowerCase()
    if (url && seen.has(key)) {
      skipped++
      continue
    }

    const firstRaw = r['First Name']
    const lastRaw = r['Last Name']

    let first: string,
      last: string,
      credentials = ''
    if (KEEP_NAMES) {
      first = firstRaw
      last = lastRaw
    } else {
      first = tidy(firstRaw)
      const split = splitCredentials(lastRaw)
      last = split.last
      credentials = split.credentials
    }

    const displayName = [first, last].filter(Boolean).join(' ').trim()
    if (!displayName) {
      skipped++
      continue
    }
    if (credentials) withCreds++

    const company = r['Company'].trim()
    const role = r['Position'].trim()
    const email = r['Email Address'].trim()
    const handle = handleOf(url)
    const connectedOn = parseConnectedOn(r['Connected On'])

    const input = {
      displayName: cap(displayName, 160),
      firstName: first || null,
      lastName: last || null,
      nickname: null,
      pronouns: null,
      avatarUrl: null,
      headline: null,
      company: company ? cap(company, 160) : null,
      jobTitle: role ? cap(role, 160) : null,
      location: null,
      birthday: null,
      tier: 'TIER_3' as const,
      // Not the configured default: a cadence on 199 acquaintances at once would
      // fill "worth reconnecting" with people you never meant to commit to.
      cadence: 'NONE' as const,
      howWeMet: null,
      bio: null,
      personalContext: null,
      notes: null,
      interests: [],
      customFields: {},
      tags: [TAG],
      channels: [
        ...(email
          ? [{ type: 'EMAIL' as const, value: cap(email, 300), label: null, isPreferred: true }]
          : []),
        ...(handle
          ? [
              {
                type: 'LINKEDIN' as const,
                value: cap(handle, 300),
                label: null,
                isPreferred: !email,
              },
            ]
          : []),
      ],
      positions: role
        ? [
            {
              role: cap(role, 160),
              organization: company ? cap(company, 160) : null,
              team: null,
              startDate: null,
              endDate: null,
              isCurrent: true,
            },
          ]
        : [],
      milestones: connectedOn
        ? [{ title: 'Connected on LinkedIn', date: connectedOn, note: null }]
        : [],
      links: url ? [{ label: 'LinkedIn', url: cap(url, 600) }] : [],
      attributes:
        KEEP_CREDENTIALS && credentials
          ? [{ category: 'Professional', key: 'Credentials', value: cap(credentials, 2000) }]
          : [],
      isDraft: false,
    }

    if (DRY) {
      report.push(
        `${displayName}${credentials ? `  [${credentials}]` : ''}` +
          `${role ? ` — ${role}` : ''}${company ? ` @ ${company}` : ''}`,
      )
    } else {
      await createContact(owner, input as any)
      if (url) seen.add(key)
    }
    created++
  }

  if (DRY) {
    report.slice(0, Number(process.env.SHOW ?? 20)).forEach((l) => console.log('  ' + l))
    if (report.length > Number(process.env.SHOW ?? 20))
      console.log(`  … and ${report.length - 20} more`)
  }
  console.log(
    `\n${DRY ? '[dry run] would import' : 'Imported'} ${created} contacts` +
      ` · skipped ${skipped} already present` +
      ` · ignored ${blank} rows with no name` +
      (KEEP_CREDENTIALS ? ` · ${withCreds} carried credentials` : ''),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
