-- Expands the contact dossier: unifies the three detail tables into one
-- repeatable channel table, and adds positions, milestones and links.
-- Existing rows are carried across before the old tables are dropped.

CREATE TYPE "ChannelType" AS ENUM ('PHONE', 'EMAIL', 'SLACK', 'TEAMS', 'LINKEDIN', 'OTHER');

ALTER TABLE "Contact" ADD COLUMN "headline" TEXT;
ALTER TABLE "Contact" ADD COLUMN "personalContext" TEXT;
ALTER TABLE "Contact" ADD COLUMN "notes" TEXT;

CREATE TABLE "ContactChannel" (
    "id"          TEXT NOT NULL,
    "contactId"   TEXT NOT NULL,
    "type"        "ChannelType" NOT NULL,
    "value"       TEXT NOT NULL,
    "label"       TEXT,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "position"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ContactChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactPosition" (
    "id"           TEXT NOT NULL,
    "contactId"    TEXT NOT NULL,
    "role"         TEXT NOT NULL,
    "organization" TEXT,
    "team"         TEXT,
    "startDate"    DATE,
    "endDate"      DATE,
    "isCurrent"    BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ContactPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactMilestone" (
    "id"        TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "date"      DATE,
    "note"      TEXT,
    CONSTRAINT "ContactMilestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactLink" (
    "id"        TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "url"       TEXT NOT NULL,
    "position"  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ContactLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactChannel_contactId_idx"   ON "ContactChannel"("contactId");
CREATE INDEX "ContactPosition_contactId_idx"  ON "ContactPosition"("contactId");
CREATE INDEX "ContactMilestone_contactId_idx" ON "ContactMilestone"("contactId");
CREATE INDEX "ContactLink_contactId_idx"      ON "ContactLink"("contactId");

ALTER TABLE "ContactChannel"   ADD CONSTRAINT "ContactChannel_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactPosition"  ADD CONSTRAINT "ContactPosition_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactMilestone" ADD CONSTRAINT "ContactMilestone_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactLink"      ADD CONSTRAINT "ContactLink_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- data move

INSERT INTO "ContactChannel" ("id", "contactId", "type", "value", "label", "isPreferred", "position")
SELECT "id", "contactId", 'EMAIL'::"ChannelType", "value", "label", "isPrimary", 0
FROM "ContactEmail";

INSERT INTO "ContactChannel" ("id", "contactId", "type", "value", "label", "isPreferred", "position")
SELECT "id", "contactId", 'PHONE'::"ChannelType", "value", "label", "isPrimary", 1
FROM "ContactPhone";

-- Socials map onto the named channels where the platform is recognizable.
INSERT INTO "ContactChannel" ("id", "contactId", "type", "value", "label", "isPreferred", "position")
SELECT
  "id", "contactId",
  CASE
    WHEN lower("platform") LIKE '%linkedin%' THEN 'LINKEDIN'
    WHEN lower("platform") LIKE '%slack%'    THEN 'SLACK'
    WHEN lower("platform") LIKE '%teams%'    THEN 'TEAMS'
    ELSE 'OTHER'
  END::"ChannelType",
  "handle",
  NULLIF("platform", ''),
  false,
  2
FROM "ContactSocial";

-- Turn whatever company/jobTitle each contact already had into a current position,
-- so the history starts populated rather than empty.
INSERT INTO "ContactPosition" ("id", "contactId", "role", "organization", "isCurrent")
SELECT gen_random_uuid()::text, "id", COALESCE("jobTitle", 'Unknown role'), "company", true
FROM "Contact"
WHERE "jobTitle" IS NOT NULL OR "company" IS NOT NULL;

DROP TABLE "ContactEmail";
DROP TABLE "ContactPhone";
DROP TABLE "ContactSocial";
