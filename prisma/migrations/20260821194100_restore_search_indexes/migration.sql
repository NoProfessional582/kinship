-- Restores the search and soft-delete indexes.
--
-- `prisma migrate dev` cannot see that `searchVector` is GENERATED ALWAYS (the
-- schema declares it as Unsupported("tsvector")), nor that the GIN/trigram
-- indexes on top of it are intentional, so every generated migration proposes
-- dropping them. One such migration was allowed to run far enough to execute
-- the DROPs before failing on the generated column, and Postgres did not put
-- them back. These are verbatim from 0_init and 4_cadence_tiers_attributes_trash.
--
-- IF NOT EXISTS throughout: this is a repair, and it has to be a no-op on any
-- database that still has them.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Contact_search_idx" ON "Contact" USING GIN ("searchVector");
CREATE INDEX IF NOT EXISTS "Entry_search_idx"   ON "Entry"   USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS "Contact_name_trgm_idx" ON "Contact" USING GIN ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_title_trgm_idx"   ON "Task"    USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Entry_deletedAt_idx"   ON "Entry"("deletedAt");
CREATE INDEX IF NOT EXISTS "Task_deletedAt_idx"    ON "Task"("deletedAt");
CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project"("deletedAt");
