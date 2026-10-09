-- Relationship tiers and check-in cadence, free-form contact attributes,
-- generalised entity edges, soft delete, and the expanded settings surface.

CREATE TYPE "ContactTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3', 'TIER_4');
CREATE TYPE "CheckInCadence" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'NONE');

ALTER TABLE "Contact"
  ADD COLUMN "tier"      "ContactTier"    NOT NULL DEFAULT 'TIER_3',
  ADD COLUMN "cadence"   "CheckInCadence" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Entry"   ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Task"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Contact_deletedAt_idx" ON "Contact"("deletedAt");
CREATE INDEX "Contact_tier_idx"      ON "Contact"("tier");
CREATE INDEX "Entry_deletedAt_idx"   ON "Entry"("deletedAt");
CREATE INDEX "Task_deletedAt_idx"    ON "Task"("deletedAt");
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

CREATE TABLE "ContactAttribute" (
    "id"        TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "category"  TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "position"  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ContactAttribute_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContactAttribute_contactId_idx" ON "ContactAttribute"("contactId");
CREATE INDEX "ContactAttribute_category_idx"  ON "ContactAttribute"("category");
ALTER TABLE "ContactAttribute" ADD CONSTRAINT "ContactAttribute_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EntityEdge" (
    "id"         TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId"   TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId"   TEXT NOT NULL,
    "relation"   TEXT NOT NULL,
    "weight"     INTEGER NOT NULL DEFAULT 1,
    "note"       TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityEdge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntityEdge_unique" ON "EntityEdge"("sourceType","sourceId","targetType","targetId","relation");
CREATE INDEX "EntityEdge_source_idx" ON "EntityEdge"("sourceType","sourceId");
CREATE INDEX "EntityEdge_target_idx" ON "EntityEdge"("targetType","targetId");

-- Carry the contact-only relationships into the generalised table before it goes.
INSERT INTO "EntityEdge" ("id","sourceType","sourceId","targetType","targetId","relation","weight","note","createdAt")
SELECT "id", 'contact', "fromId", 'contact', "toId", "type", 1, "note", "createdAt"
FROM "Relationship";

DROP TABLE "Relationship";

ALTER TABLE "Settings"
  ADD COLUMN "userName"          TEXT    NOT NULL DEFAULT 'You',
  ADD COLUMN "appTitle"          TEXT    NOT NULL DEFAULT 'Kinship',
  ADD COLUMN "tagline"           TEXT    NOT NULL DEFAULT 'Personal knowledge & relationships',
  ADD COLUMN "weatherEnabled"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "weatherLocation"   TEXT    NOT NULL DEFAULT 'San Francisco, CA',
  ADD COLUMN "weatherUnit"       TEXT    NOT NULL DEFAULT 'fahrenheit',
  ADD COLUMN "calendarWeekStart" TEXT    NOT NULL DEFAULT 'monday',
  ADD COLUMN "fontScale"         DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "defaultCadence"    "CheckInCadence" NOT NULL DEFAULT 'MONTHLY';
