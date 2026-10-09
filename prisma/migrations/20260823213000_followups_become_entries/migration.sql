-- Follow-ups become entries of their own.
--
-- `Entry.followUpAt` could hold a date and nothing else: no agenda, no people
-- of its own, and no way to say whether the conversation ever happened -- which
-- is why the dossier reached back a fixed 30 days and called that a guess. A
-- planned conversation is now an entry dated forward, tied to the one that
-- promised it by an `EntityEdge` with relation 'follows-up', so writing it up
-- afterwards is filling in a note that already exists rather than creating one.
--
-- Hand-written, not generated. `prisma migrate dev` cannot see that
-- `searchVector` is GENERATED ALWAYS (the schema declares it as
-- Unsupported("tsvector")), so it proposes dropping the FTS and trigram indexes
-- on every run; 20260821194100 exists only to put them back after that
-- happened once. Entry.searchVector reads `title` and `bodyText` only, so
-- dropping `followUpAt` does not touch it.

-- The stub's id is derived from its parent's rather than generated, so the
-- three inserts below can join on it without a temp table and a re-run is a
-- no-op instead of a second copy of every follow-up.
INSERT INTO "Entry" (
  id, kind, title, "bodyJson", "bodyText", "occurredAt", "projectId",
  "createdAt", "updatedAt"
)
SELECT
  'fu_' || e.id,
  -- The kind is inherited: a promise made on a call is most likely another
  -- call. It is a guess, but it is the parent's own answer to the same
  -- question, and the follow-up note is editable.
  e.kind,
  'Follow up — ' || COALESCE(NULLIF(btrim(e.title), ''), replace(lower(e.kind::text), '_', ' ')),
  -- The same empty document `createEntry` writes, so a backfilled stub and one
  -- created by the app are indistinguishable to the editor.
  '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  -- Empty body is the open-loop signal: the conversation has not been written
  -- up. It is what replaces the missing "done" flag.
  '',
  e."followUpAt",
  e."projectId",
  now(),
  now()
FROM "Entry" e
WHERE e."followUpAt" IS NOT NULL
  AND e."deletedAt" IS NULL
ON CONFLICT (id) DO NOTHING;

-- The people carry over, or the follow-up would not reach the dossier of the
-- person you promised it to.
INSERT INTO "Mention" (id, "entryId", "contactId")
SELECT 'fu_' || m.id, 'fu_' || m."entryId", m."contactId"
FROM "Mention" m
JOIN "Entry" e ON e.id = m."entryId"
WHERE e."followUpAt" IS NOT NULL
  AND e."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

-- Source is the follow-up, target the conversation it came out of, so the
-- relation reads forwards: "this entry follows up that one".
INSERT INTO "EntityEdge" (
  id, "sourceType", "sourceId", "targetType", "targetId", relation, weight, "createdAt"
)
SELECT 'fue_' || e.id, 'entry', 'fu_' || e.id, 'entry', e.id, 'follows-up', 1, now()
FROM "Entry" e
WHERE e."followUpAt" IS NOT NULL
  AND e."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS "Entry_followUpAt_idx";
ALTER TABLE "Entry" DROP COLUMN "followUpAt";
