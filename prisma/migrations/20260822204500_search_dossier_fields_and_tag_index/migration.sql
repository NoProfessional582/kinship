-- Hand-written, like every migration in this directory.
--
-- `prisma migrate dev` cannot see that "searchVector" is GENERATED ALWAYS (the
-- schema declares it Unsupported("tsvector")) and proposes dropping it and its
-- GIN indexes every time. Generating this one would have repeated the incident
-- that 20260821194100_restore_search_indexes exists to repair.

-- 1. Contact.searchVector was defined in 0_init and never revised, so the three
--    dossier fields added in 20260821025900_expand_contact_dossier — headline,
--    personalContext and notes — were never indexed. Up to 20 000 characters of
--    running notes per contact, and the command palette could not see a word of
--    it: globalSearch matches Contact on this vector or on displayName alone.
--
--    A generated column cannot be altered in place; it has to be dropped and
--    re-added. Dropping it takes "Contact_search_idx" with it, so the index is
--    recreated below — that ordering is the whole point of doing this by hand.
--
--    Weights follow the existing scheme: A identity, B how you place them,
--    C what you know about them. headline joins B, the long-form fields join C.

DROP INDEX IF EXISTS "Contact_search_idx";
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "searchVector";

ALTER TABLE "Contact" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("displayName", '') || ' ' || coalesce("nickname", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("company", '') || ' ' || coalesce("jobTitle", '') || ' ' || coalesce("location", '') || ' ' || coalesce("headline", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("bio", '') || ' ' || kb_array_to_string("interests") || ' ' || coalesce("personalContext", '') || ' ' || coalesce("notes", '')), 'C')
  ) STORED;

CREATE INDEX "Contact_search_idx" ON "Contact" USING GIN ("searchVector");

-- 2. Tags are resolved case-insensitively but were only unique on the exact
--    name, so two concurrent saves of "#work" and "#Work" both missed the
--    lookup and both inserted: identical spellings raised a P2002 that aborted
--    an otherwise valid save, and spellings differing only in case created the
--    two divergent tags resolveTagIds exists to prevent. The index below is the
--    database-level guarantee that makes its ON CONFLICT DO NOTHING correct.
--
--    The expression mirrors normalizeLabel() in lib/utils.ts exactly:
--    trim, collapse internal whitespace, lowercase.

-- Fold any pre-existing case variants onto the earliest row first, or the
-- index cannot be built. A no-op on a database that has none.
WITH canon AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) ORDER BY id
         ) AS keep_id
  FROM "Tag"
)
INSERT INTO "ContactTag" ("contactId", "tagId")
SELECT ct."contactId", c.keep_id FROM "ContactTag" ct JOIN canon c ON c.id = ct."tagId"
WHERE c.keep_id <> ct."tagId"
ON CONFLICT DO NOTHING;

WITH canon AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) ORDER BY id
         ) AS keep_id
  FROM "Tag"
)
INSERT INTO "EntryTag" ("entryId", "tagId")
SELECT et."entryId", c.keep_id FROM "EntryTag" et JOIN canon c ON c.id = et."tagId"
WHERE c.keep_id <> et."tagId"
ON CONFLICT DO NOTHING;

WITH canon AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) ORDER BY id
         ) AS keep_id
  FROM "Tag"
)
INSERT INTO "TaskTag" ("taskId", "tagId")
SELECT tt."taskId", c.keep_id FROM "TaskTag" tt JOIN canon c ON c.id = tt."tagId"
WHERE c.keep_id <> tt."tagId"
ON CONFLICT DO NOTHING;

-- The join rows above are now duplicated onto the survivor, so deleting the
-- losers only cascades away the copies.
WITH canon AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) ORDER BY id
         ) AS keep_id
  FROM "Tag"
)
DELETE FROM "Tag" t USING canon c WHERE c.id = t.id AND c.keep_id <> t.id;

CREATE UNIQUE INDEX "Tag_name_normalized_key"
  ON "Tag" (lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));
