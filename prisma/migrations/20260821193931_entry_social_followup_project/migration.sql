-- Adds the SOCIAL entry kind, plus a follow-up date and an optional project
-- home for an entry.
--
-- Hand-trimmed on purpose. `prisma migrate dev` also emitted DROP INDEX for the
-- hand-written FTS and trigram indexes and DROP DEFAULT for the `searchVector`
-- columns: Prisma models those as Unsupported("tsvector") and cannot see that
-- they are GENERATED, so it reads them as drift every time. Applying that half
-- fails outright ("column is a generated column") and would silently drop
-- search if it did not. Only the three intended changes are kept here.

-- AlterEnum. IF NOT EXISTS because Postgres commits an enum label even when
-- the surrounding migration transaction rolls back, so a retry hits 42710.
ALTER TYPE "EntryKind" ADD VALUE IF NOT EXISTS 'SOCIAL';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "followUpAt" TIMESTAMP(3),
                    ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Entry_followUpAt_idx" ON "Entry"("followUpAt");

-- CreateIndex
CREATE INDEX "Entry_projectId_idx" ON "Entry"("projectId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
