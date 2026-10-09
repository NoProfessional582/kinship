-- P6 contract: every user-owned root now requires an owner, and uniqueness that
-- used to be global is scoped to that owner.
--
-- Hand-trimmed from `prisma migrate diff`. Removed on purpose: the proposed
-- drops of the search/trigram indexes and the `searchVector` ALTERs (Prisma
-- cannot see them; see prisma/check-migrations.mjs) and three unrelated
-- EntityEdge index renames.
--
-- SET NOT NULL fails the whole migration if any row escaped the expansion
-- backfill, which is the intended fail-closed behaviour.

-- AlterTable
ALTER TABLE "BoardColumn" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "EntityEdge" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "Entry" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "Settings" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "Tag" ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "owner" SET NOT NULL;

-- Global uniqueness gives way to owner-scoped uniqueness.
DROP INDEX "Contact_slug_key";
DROP INDEX "Project_slug_key";
DROP INDEX "Task_slug_key";
DROP INDEX "Tag_name_key";

CREATE UNIQUE INDEX "Contact_owner_slug_key" ON "Contact"("owner", "slug");
CREATE UNIQUE INDEX "Project_owner_slug_key" ON "Project"("owner", "slug");
CREATE UNIQUE INDEX "Task_owner_slug_key" ON "Task"("owner", "slug");
CREATE UNIQUE INDEX "Settings_owner_key" ON "Settings"("owner");

-- Case/whitespace-insensitive tag names, now per owner. Same name, so the
-- migration guard sees a drop that is put back in the same file.
DROP INDEX "Tag_name_normalized_key";
CREATE UNIQUE INDEX "Tag_name_normalized_key"
  ON "Tag" ("owner", lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));

-- CreateIndex
CREATE INDEX "BoardColumn_owner_idx" ON "BoardColumn"("owner");
CREATE INDEX "EntityEdge_owner_idx" ON "EntityEdge"("owner");
CREATE INDEX "Entry_owner_idx" ON "Entry"("owner");
