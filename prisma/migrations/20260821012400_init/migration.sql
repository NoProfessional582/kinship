-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'TEXT', 'MEETING', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "RefTargetType" AS ENUM ('TASK', 'PROJECT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "nickname" TEXT,
    "pronouns" TEXT,
    "avatarUrl" TEXT,
    "company" TEXT,
    "jobTitle" TEXT,
    "location" TEXT,
    "birthday" DATE,
    "howWeMet" TEXT,
    "bio" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEmail" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ContactEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPhone" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ContactPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSocial" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT,

    CONSTRAINT "ContactSocial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL DEFAULT 'NOTE',
    "title" TEXT,
    "bodyJson" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "Direction",
    "durationMin" INTEGER,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityRef" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "targetType" "RefTargetType" NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "EntityRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "startDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardColumn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "color" TEXT,
    "wipLimit" INTEGER,
    "isDoneColumn" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,

    CONSTRAINT "BoardColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "projectId" TEXT,
    "parentTaskId" TEXT,
    "columnId" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "EntryTag" (
    "entryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EntryTag_pkey" PRIMARY KEY ("entryId","tagId")
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("taskId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_slug_key" ON "Contact"("slug");

-- CreateIndex
CREATE INDEX "Contact_displayName_idx" ON "Contact"("displayName");

-- CreateIndex
CREATE INDEX "Contact_isDraft_idx" ON "Contact"("isDraft");

-- CreateIndex
CREATE INDEX "Contact_lastContactAt_idx" ON "Contact"("lastContactAt" DESC);

-- CreateIndex
CREATE INDEX "ContactEmail_contactId_idx" ON "ContactEmail"("contactId");

-- CreateIndex
CREATE INDEX "ContactPhone_contactId_idx" ON "ContactPhone"("contactId");

-- CreateIndex
CREATE INDEX "ContactSocial_contactId_idx" ON "ContactSocial"("contactId");

-- CreateIndex
CREATE INDEX "Relationship_fromId_idx" ON "Relationship"("fromId");

-- CreateIndex
CREATE INDEX "Relationship_toId_idx" ON "Relationship"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_fromId_toId_type_key" ON "Relationship"("fromId", "toId", "type");

-- CreateIndex
CREATE INDEX "Entry_occurredAt_idx" ON "Entry"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Entry_kind_idx" ON "Entry"("kind");

-- CreateIndex
CREATE INDEX "Mention_contactId_idx" ON "Mention"("contactId");

-- CreateIndex
CREATE INDEX "Mention_entryId_idx" ON "Mention"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_entryId_contactId_key" ON "Mention"("entryId", "contactId");

-- CreateIndex
CREATE INDEX "EntityRef_entryId_idx" ON "EntityRef"("entryId");

-- CreateIndex
CREATE INDEX "EntityRef_taskId_idx" ON "EntityRef"("taskId");

-- CreateIndex
CREATE INDEX "EntityRef_projectId_idx" ON "EntityRef"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "BoardColumn_projectId_position_idx" ON "BoardColumn"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Task_slug_key" ON "Task"("slug");

-- CreateIndex
CREATE INDEX "Task_columnId_position_idx" ON "Task"("columnId", "position");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_isDraft_idx" ON "Task"("isDraft");

-- CreateIndex
CREATE INDEX "TaskAssignee_contactId_idx" ON "TaskAssignee"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_contactId_key" ON "TaskAssignee"("taskId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "ContactTag_tagId_idx" ON "ContactTag"("tagId");

-- CreateIndex
CREATE INDEX "EntryTag_tagId_idx" ON "EntryTag"("tagId");

-- CreateIndex
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");

-- AddForeignKey
ALTER TABLE "ContactEmail" ADD CONSTRAINT "ContactEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPhone" ADD CONSTRAINT "ContactPhone_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSocial" ADD CONSTRAINT "ContactSocial_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRef" ADD CONSTRAINT "EntityRef_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRef" ADD CONSTRAINT "EntityRef_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRef" ADD CONSTRAINT "EntityRef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardColumn" ADD CONSTRAINT "BoardColumn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryTag" ADD CONSTRAINT "EntryTag_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryTag" ADD CONSTRAINT "EntryTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Full-text search: generated tsvector columns + GIN indexes.
-- GENERATED ALWAYS keeps these consistent with no trigger to maintain.
-- Declared in schema.prisma as Unsupported("tsvector")? so the Prisma client
-- omits them from create/update input types and never writes to them.
-- ============================================================================

-- array_to_string(anyarray, text) is STABLE (element output functions can be
-- stable for types like timestamptz), so Postgres rejects it in a generated
-- column. Narrowed to text[] the operation genuinely is immutable.
CREATE OR REPLACE FUNCTION kb_array_to_string(arr text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT array_to_string(coalesce(arr, ARRAY[]::text[]), ' ') $$;

ALTER TABLE "Contact" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("displayName", '') || ' ' || coalesce("nickname", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("company", '') || ' ' || coalesce("jobTitle", '') || ' ' || coalesce("location", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("bio", '') || ' ' || kb_array_to_string("interests")), 'C')
  ) STORED;

CREATE INDEX "Contact_search_idx" ON "Contact" USING GIN ("searchVector");

ALTER TABLE "Entry" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("bodyText", '')), 'B')
  ) STORED;

CREATE INDEX "Entry_search_idx" ON "Entry" USING GIN ("searchVector");

-- Trigram indexes power fuzzy matching in the @ / [[ suggestion dropdowns,
-- so a misspelled name still finds the right record.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Contact_name_trgm_idx" ON "Contact" USING GIN ("displayName" gin_trgm_ops);
CREATE INDEX "Task_title_trgm_idx"   ON "Task"    USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);
