-- Adds the EVENT entry kind: a calendar item that is not a communication.
--
-- Hand-written, not generated. `prisma migrate dev` cannot see that
-- `searchVector` is GENERATED ALWAYS (the schema declares it as
-- Unsupported("tsvector")), so it proposes dropping the FTS and trigram
-- indexes on every run. That is exactly what happened when SOCIAL was added
-- in 20260821193931, and 20260821194100 exists only to put them back.
-- One ALTER TYPE is the whole change; there is nothing to trim.

-- IF NOT EXISTS because Postgres commits an enum label even when the
-- surrounding migration transaction rolls back, so a retry would hit 42710.
ALTER TYPE "EntryKind" ADD VALUE IF NOT EXISTS 'EVENT';
