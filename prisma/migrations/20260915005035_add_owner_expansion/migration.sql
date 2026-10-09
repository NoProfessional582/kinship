-- AlterTable
ALTER TABLE "BoardColumn" ADD COLUMN     "owner" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "owner" TEXT;

-- AlterTable
ALTER TABLE "EntityEdge" ADD COLUMN     "owner" TEXT;

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "owner" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "owner" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "owner" TEXT,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "owner" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "owner" TEXT;

-- Backfill every user-owned root from the owner given in the
-- `kinship.legacy_owner_subject` connection setting. Only data created before
-- owner columns existed needs it; a new database never does. Populated
-- databases without it fail closed.
--
-- Settings is deliberately NOT part of the populated test: 20260821160100_settings
-- seeds a default `singleton` row into every database, including a brand-new
-- one, so its presence says nothing about user data.
DO $$
DECLARE
  legacy_owner TEXT := NULLIF(BTRIM(current_setting('kinship.legacy_owner_subject', true)), '');
  has_legacy BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "Contact" UNION ALL
    SELECT 1 FROM "Entry" UNION ALL
    SELECT 1 FROM "Project" UNION ALL
    SELECT 1 FROM "Task" UNION ALL
    SELECT 1 FROM "Tag" UNION ALL
    SELECT 1 FROM "BoardColumn" UNION ALL
    SELECT 1 FROM "EntityEdge"
  ) INTO has_legacy;

  IF has_legacy AND legacy_owner IS NULL THEN
    RAISE EXCEPTION 'kinship.legacy_owner_subject is required to migrate populated Kinship data';
  END IF;

  IF legacy_owner IS NOT NULL THEN
    UPDATE "Contact" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "Entry" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "Project" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "Task" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "Tag" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "BoardColumn" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "EntityEdge" SET "owner" = legacy_owner WHERE "owner" IS NULL;
    UPDATE "Settings" SET "owner" = legacy_owner WHERE "owner" IS NULL;
  ELSE
    -- No user data and no subject: the only unowned root left is the seeded
    -- default settings row. It has no owner to be given, and each subject's row
    -- is created on first load, so it is removed rather than left to fail the
    -- contract's NOT NULL.
    DELETE FROM "Settings" WHERE "owner" IS NULL;
  END IF;
END $$;
