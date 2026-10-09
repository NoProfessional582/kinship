# Knowledge Base & Relationship Manager

A self-hosted, single-user web app that unifies three things that normally live in
separate tools:

- **Who you know** — contact dossiers: channels with a preferred one, position history, milestones, links, personal context and notes
- **What was said** — notes, calls, emails, texts and meetings in one typed timeline
- **What's owed** — Kanban tasks nested under projects

The binding mechanism is **inline tagging**. You write naturally, type `@` to
reference a person and `[[` to reference a task or project. Tagging something
that doesn't exist yet creates it on the spot, and a post-save modal queue walks
you through filling in each new entity one at a time — so capture is never
interrupted by data entry.

No cloud, no telemetry, no sign-in. Kinship is for one person on their own
machine: everything is stored under the single owner named by `KINSHIP_OWNER`.

> **Pre-release.** This repo is not ready for use yet; the first release is 0.1.0.
>
> **Never expose Kinship to a network.** It has no sign-in, so anyone who can
> reach it has full access to your data. Keep its port on `127.0.0.1`.

**Your data is not in git.** Nothing in this repo holds a contact, an entry or an
avatar; see [Moving to another machine](#moving-to-another-machine) for the one
thing that does.

---

## Running it

Copy `.env.example` to `.env`, fill in `KINSHIP_OWNER` and `DATABASE_URL`, then
start it with Docker Compose. Full setup instructions arrive with the first
release.

## Moving to another machine

Your data lives in two places Docker owns: the `pgdata` volume and the `uploads`
volume. An **archive** is one JSON file holding both — every row of every table,
plus the avatar images, which sit on the filesystem rather than in the database
and a database-only move would silently leave behind.

> **A GitHub repo is not a backup of your data.** Cloning this repo onto a new
> machine gives you a working app and an empty database. The archive below is
> the only thing that carries your contacts, entries and avatars across, and it
> is deliberately gitignored (`kb-archive-*.json`) so it can never be committed
> by accident. Treat pushing code and exporting data as two separate habits.

### The move, end to end

1. **On the new machine**, get the code there and start it:

   ```bash
   git clone https://github.com/NoProfessional582/kinship.git
   cd kinship
   cp .env.example .env      # then fill it in, using the same KINSHIP_OWNER
   docker compose up -d --build
   ```

   The database it creates is empty but fully migrated. Use the same
   `KINSHIP_OWNER` as on the old machine: every record is stored under it.
2. **On the old machine**, write the archive:
   `npm run --silent export > kb-archive.json`
3. Move that one file across however you like — `scp`, a USB stick, a synced
   folder. It is plain JSON and holds everything.
4. **On the new machine**, look before you leap, then restore:
   `npm run import < kb-archive.json`, then
   `npm run import -- --replace < kb-archive.json`
5. Open `http://localhost:2002` and check the dashboard, a contact with a photo,
   and a search. Then, and only then, retire the old machine.

Do the import on the **new** machine. Nothing in the tooling can tell which end
of the move you are standing on, and it replaces everything it finds.

### The commands, in detail

On the old machine:

```bash
npm run --silent export > kb-archive.json
```

`--silent` is load-bearing: without it npm prints its banner to stdout and into
the file. The archive travels on stdout rather than to a path argument because a
path would be a path *inside the container*, and anything the container wrote to
a bind mount would come out root-owned. Redirecting
on the host means your shell creates the file, so you own it.

On the new machine, bring the stack up first so the migrations run, then restore:

```bash
docker compose up -d --build
npm run import < kb-archive.json                  # says what it would do, changes nothing
npm run import -- --replace < kb-archive.json     # does it
```

Or do the same thing from **Settings → Data** in the browser: *Download archive*
on the old machine, then *Choose archive* on the new one, type `replace`, and
*Replace everything*.

Both flags together, for the case where the two machines are on different
migrations and you have decided to proceed anyway:

```bash
npm run import -- --replace --force < kb-archive.json
```

### Over HTTP, if you would rather script it

The browser panel is a thin wrapper over two routes, and `curl` can drive them:

```bash
curl -sO -J http://localhost:2002/api/export        # -J takes the filename from the response

curl -X POST 'http://localhost:2002/api/import?confirm=replace' \
     -H 'Content-Type: application/json' \
     --data-binary @kb-archive.json
```

The body is the archive and nothing else, so the file goes up as-is. Add
`&force=1` to waive the migration check.

`confirm=replace` is required and there is no way to turn it off. This app has
no authentication — it is not meant to — so the only thing between a stray POST
and every row in the database is that the caller had to spell out what it was
asking for.

### What import does

**It replaces everything.** Every table is truncated and rebuilt inside one
transaction, so a failure part-way leaves the database exactly as it was — but a
success leaves nothing of whatever was there before.

There is no merge mode, and that is deliberate. Rows keep their original ids, so
every `@mention`, every `[[ref]]` and every `EntityEdge` endpoint — which is a
bare `(type, id)` pair with no foreign key behind it — still points at the same
thing on the far side. No blend of two databases can honour that.

Both sides have to be on the same migrations. The archive records which ones the
old machine had applied; an import that does not match refuses and names the
difference. `--force`, or *Import anyway* in the UI, overrides that: columns
added since the export take their defaults, and columns dropped since are
discarded.

Uploads are written before the transaction opens, on purpose. A crash between
the two leaves unreferenced images on disk, which cost a few kilobytes; the
other order leaves restored contacts pointing at avatars that were never
written. For the same reason, files already on the new machine that the archive
does not mention are left alone rather than swept.

### What it does not carry, and why that is right

The `searchVector` columns, the GIN and trigram indexes, and the
`_prisma_migrations` ledger are all absent from the archive. They belong to the
migrations rather than to the data: `searchVector` is `GENERATED ALWAYS`, so
Postgres refuses a value for it and repopulates it from the restored rows on its
own. Full-text search works on the new machine the moment the import finishes —
see [Full-text search](#full-text-search).

`pg_dump` is the alternative, and a reasonable one between identical Postgres
versions, but it carries none of the avatars and the `uploads` volume then has
to be moved by hand.

### Verifying a restore without risking real data

The archive round trip can be checked end to end against a scratch database in
the same Postgres container, leaving `kb` untouched:

```bash
docker compose exec db psql -U kb -d postgres -c 'CREATE DATABASE kb_check OWNER kb;'
SCRATCH='postgresql://kb:kb@db:5432/kb_check'
docker compose run --rm --no-deps -T -e DATABASE_URL="$SCRATCH" migrate npx prisma migrate deploy

npm run --silent export > /tmp/a.json
docker compose run --rm --no-deps -T -e DATABASE_URL="$SCRATCH" \
  -v "$PWD/lib":/app/lib -v "$PWD/prisma":/app/prisma \
  migrate npx tsx prisma/archive.ts import --replace < /tmp/a.json
docker compose run --rm --no-deps -T -e DATABASE_URL="$SCRATCH" \
  -v "$PWD/lib":/app/lib -v "$PWD/prisma":/app/prisma \
  migrate npx tsx prisma/archive.ts export > /tmp/b.json

diff <(grep -v exportedAt /tmp/a.json) <(grep -v exportedAt /tmp/b.json) && echo identical
```

Rows come out of an export in a stable order precisely so that this diff is
meaningful. Drop the database again with
`docker compose exec db psql -U kb -d postgres -c 'DROP DATABASE kb_check;'`.

There is no browser suite for import, and there should not be: every other suite
in this repo is written to coexist with real data, and one that truncates every
table cannot be.

---

## Event categories

`occurredAt` answers two different questions. On a note typed just now it is a
filing date; on a meeting next Tuesday it is an appointment. Treating both as
calendar events is what put every note on the grid.

`lib/calendar-categories.ts` is the single vocabulary — six categories, one
label and one colour each — shared by the month grid, the Today brief, the
dashboard's Next up and the contact dossier:

| Category | What lands in it |
| --- | --- |
| `scheduled` | **Any** entry dated in the future, whatever its kind |
| `meeting` | A past meeting, call or in-person — it occupied a slot |
| `followup` | An entry's `followUpAt` |
| `deadline` | A task's due date, and a project's start/target dates |
| `milestone` | Birthdays and dated personal milestones |
| `log` | A past note, email, text or DM — a record, not an appointment |

`log` is the only category off by default on the calendar, and the only one the
day views never show. The chip choice persists in `kb.calendar.categories`.

Hovering a month cell tints it; clicking one pins the right-hand rail to that
day, which is why the rail heading becomes the weekday and offers a way back to
today. The ring is painted straight onto the cell's `data-date`, not through
`dayCellClassNames` — FullCalendar only re-runs that hook when it re-renders the
view, so a prop change alone would leave the ring on the previous day.

That module deliberately imports nothing. It used to live in
`lib/services/calendar.ts` next to the Prisma queries, and importing a category
name from a client component pulled `pg` into the browser bundle — the build
fails with `Module not found: Can't resolve 'dns'`.

---

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3 App Router, `output: 'standalone'` |
| UI | React 19.2, Tailwind CSS v4, Radix primitives |
| Data | Prisma 7.9 + PostgreSQL 17 (via `@prisma/adapter-pg`) |
| Editor | TipTap 3.30 with two `@tiptap/suggestion` instances |
| Drag & drop | dnd-kit |
| Calendar | FullCalendar 6.1.21 |

### One pinning hazard

**FullCalendar must stay at 6.1.21 across every package.** `core` and `react`
publish a 7.x `latest`, but `daygrid`/`timegrid`/`list`/`interaction` do not, and
FullCalendar fails at runtime on mixed versions.

### One measure, one rail, one board, one composer

Four things are deliberately singular, because each of them was previously two:

- **Page width.** Every page sits on `--page-max` (`app/globals.css`). Notes,
  settings and trash used to have a narrower "reading" measure of their own,
  which meant the content edge moved when you switched pages.
- **The shell.** The sidebar is *inside* the centred block, not pinned to the
  window (`.kb-shell`, sized to `--page-max + --rail-w`). On an ultrawide the
  app centres as one piece rather than stranding navigation on the far bezel.
- **The board.** There is one set of `BoardColumn` rows, all with
  `projectId: null`; a project page is that board filtered to the project's
  cards. Per-project column sets were the bug behind "no tasks in this project
  yet" on a project whose cards the board was showing at the time — the cards
  sat in global columns while the project page created empty ones of its own.
  `BoardColumn.projectId` still exists in the schema, unused, so removing it
  needs no migration (see the FTS warning below for why that matters).
- **The composer.** `UnifiedComposer` renders the dark capture card everywhere.
  It used to take a `variant`, and the light "panel" skin on the notes page made
  one feature look like two. Both places share the draft under
  `kb.composer.hero`.

### Native dropdowns need explicit colours

A `<select>` popup is painted by the browser out of the control's own
background and colour, so the translucent field skin on the dark capture card
came out as white text on a white menu. `:root`/`.dark` declare `color-scheme`,
and `select option` is given an opaque background and colour explicitly —
Tailwind classes on the `<select>` cannot reach inside the popup.

### How inline tagging works

`@` and `[[` are two configured `@tiptap/suggestion` instances sharing one
dropdown (`components/editor/suggestion-list.tsx`). Choosing "create" inserts a
node with a **provisional id** (`new:<uuid>`), rendered with a dashed underline.

On save, `lib/services/entries.ts` runs one transaction that:

1. creates each pending entity as a real row with `isDraft: true`
2. **rewrites every provisional id in the document body to the real id**
3. inserts the entry, its mentions and its refs
4. moves `lastContactAt` forward (never backward) for mentioned contacts

Doing the rewrite server-side *inside* the transaction is what guarantees a
failed save leaves no orphan contacts and no body pointing at rolled-back rows.
`tests/entries.integration.test.ts` asserts exactly that.

Typing `@Sarah` twice and choosing "create" both times reuses the same
provisional id — one contact, two mentions — by reading it back off the
document, which stays correct across undo, redo and paste.

### Contact dossier

Communication channels are one repeatable table discriminated by `ChannelType`
(phone, email, Slack, Teams, LinkedIn, other) rather than a table per medium, so
adding a channel is data rather than a migration. At most one channel per contact
carries `isPreferred`, enforced in the service rather than by a constraint.

Positions are the source of truth for what someone does now: the one flagged
`isCurrent` is what `company`/`jobTitle` on Contact are derived from on every
write. Those columns stay denormalized because the FTS vector, the contact list
and the mention dropdown all read them as single-table lookups.

### Dates and timezones

Every timestamp is stored in UTC (`timestamp without time zone`, written as UTC
by Prisma; both containers run UTC). Display is a separate concern, controlled
by a single-row `Settings.timezone` — null means "follow the browser", which is
right for one person on one machine, while pinning an IANA zone matters when
travelling or when the server does date maths on your behalf.

The distinction that matters is **instants versus calendar dates**:

- *Instants* — `occurredAt`, `createdAt`, `lastContactAt`, `completedAt` — are
  moments on the world clock, rendered *in* a zone via `formatInstant`. The same
  stored instant reads as Aug 21 12:46 in Sydney and Aug 20 19:46 in Los Angeles.
- *Calendar dates* — birthdays, position start/end, milestones, due dates — are
  days on a wall calendar, with no time and no zone. They go through
  `calendarDate`, which reads the Y/M/D parts directly. Zone-converting these is
  exactly what once rendered a June 14th birthday as the 13th.

The trap is the third case: a **calendar-day question about now**. "Is this
overdue", "how many days until", "is it today". `isPast` / `isToday` /
`differenceInCalendarDays` against a bare `new Date()` answer in the *browser's*
zone, which is a different day for part of every night. Use `useZonedToday()`:
it returns today as a local-midnight `Date` — the same shape `calendarDate`
produces, so the two compare directly. It is `null` until mounted; render
nothing rather than guess.

A `datetime-local` input has no zone at all. It is wall time, and the browser
neither knows nor cares whose wall. Both directions go through
`toLocalInputValue` / `fromLocalInputValue`. Seeding one is also a race:
`useTimezone()` answers `'UTC'` until the settings query lands, so a field
filled once on first render keeps a UTC wall time forever — re-seed on zone
change, guarded by a "has the writer touched it" ref.

FullCalendar needs `@fullcalendar/luxon3` to honour a named zone. Without it,
handed `America/Los_Angeles` it silently falls back to UTC and draws every event
at its UTC wall time — a 6:24pm call on the 11th shows up on the 12th.

`npm run test:tz` guards all of it by driving the app with the browser in Los
Angeles and the app pinned to Tokyo, sixteen hours apart.

### Full-text search

`Contact.searchVector` and `Entry.searchVector` are `GENERATED ALWAYS` tsvector
columns with GIN indexes, plus `pg_trgm` indexes for fuzzy name matching — a
misspelled name still finds the right record. `array_to_string` is `STABLE`, not
immutable, so Postgres rejects it in a generated column; the migration defines a
narrow `kb_array_to_string(text[])` wrapper, which genuinely is immutable.

### `prisma migrate dev` will try to drop full-text search

Read this before generating a migration. `searchVector` on `Contact` and
`Entry` is a `GENERATED ALWAYS` tsvector column created by hand in `0_init`,
and the schema can only describe it as `Unsupported("tsvector")?`. Prisma
therefore sees the column defaults, the two GIN indexes and the three trigram
indexes as **drift**, and every generated migration begins by dropping them:

```sql
DROP INDEX "Contact_search_idx";
DROP INDEX "Entry_search_idx";
DROP INDEX "Contact_name_trgm_idx";      -- and Task_/Project_
ALTER TABLE "Contact" ALTER COLUMN "searchVector" DROP DEFAULT;   -- fails
```

The last statement errors (`column "searchVector" is a generated column`), so
the migration fails — but the `DROP INDEX`es ahead of it are **not** rolled
back, and neither is an `ALTER TYPE ... ADD VALUE`. That is how
`5_restore_search_indexes` came to exist.

So: run `npm run db:migrate:create -- --name <slug>` (which is
`prisma migrate dev --create-only`), delete everything from the generated SQL
except the change you actually meant, and only then `migrate deploy`.

**This is now enforced, not just advised.** `prisma/check-migrations.mjs` runs
inside the `migrate` container ahead of `prisma migrate deploy`, so a migration
that drops any of the two generated columns, the six custom indexes, the
`kb_array_to_string` function or the `pg_trgm` extension — without putting it
back in the same migration — is refused before anything is applied, in dev, in
CI and in production alike. Run it yourself with `npm run db:migrate:check`. Enum additions want `ADD VALUE IF NOT EXISTS`, since a
retry after a failed migration otherwise hits `42710 enum label already
exists`. Afterwards, confirm the indexes are still there:

```bash
docker compose run --rm migrate \
  npx prisma db execute --stdin <<<"select indexname from pg_indexes \
    where indexname ilike '%search%' or indexname ilike '%trgm%';"
```

### The archive is three modules, not one

`lib/archive-format.ts` is the wire contract — the format marker, the version, and
the shape of an import's answer. It imports nothing, because the settings page is
a client component and can have neither a database nor `node:fs` in its bundle.

`lib/archive-rows.ts` knows the schema: which tables in which foreign-key order,
which columns are instants, which task has to be written before which. It reads
its column lists from `Prisma.dmmf` rather than repeating them, so a column added
to the schema is exported the day it lands — and it asserts that every model in
the schema is accounted for, because a table forgotten there would be dropped
from every archive without a word. Being free of both the database and the
filesystem, it is covered by the ordinary unit suite (`tests/archive-rows.test.ts`).

`lib/services/archive.ts` knows the machine: it queries, truncates, and reads and
writes the uploads directory.

One ordering is hand-written rather than derived, and deliberately so: Prisma 7's
slimmed DMMF no longer exposes `relationFromFields`, so the foreign-key dependency
graph cannot be reconstructed at runtime. `MODEL_ORDER` states it, and a unit test
checks the dependencies it claims.

### Migrations

Migrations run as a one-shot `migrate` compose service built from the `builder`
stage, which `web` waits on via `service_completed_successfully`. That keeps the
Prisma CLI out of the runtime image instead of hand-picking its dependencies in.

Prisma 7 moved the datasource URL out of `schema.prisma` into `prisma.config.ts`
and no longer auto-loads `.env`, which is why that file imports `dotenv/config`.
