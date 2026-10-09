-- The board column now owns a task's workflow state, replacing the separate
-- isDoneColumn flag. Existing columns are mapped by name so no board loses its
-- meaning, and every task is re-synced to the column it currently sits in.

ALTER TABLE "BoardColumn" ADD COLUMN "status" "TaskStatus" NOT NULL DEFAULT 'TODO';

UPDATE "BoardColumn" SET "status" = CASE
  WHEN "isDoneColumn"                        THEN 'DONE'
  WHEN lower("name") LIKE '%progress%'       THEN 'IN_PROGRESS'
  WHEN lower("name") LIKE '%block%'          THEN 'BLOCKED'
  WHEN lower("name") LIKE '%done%'
    OR lower("name") LIKE '%complete%'
    OR lower("name") LIKE '%shipped%'        THEN 'DONE'
  WHEN lower("name") LIKE '%archive%'        THEN 'ARCHIVED'
  ELSE 'TODO'
END::"TaskStatus";

-- Bring every task in line with the column it is already in.
UPDATE "Task" t SET
  "status"      = c."status",
  "completedAt" = CASE WHEN c."status" = 'DONE' THEN COALESCE(t."completedAt", now()) ELSE NULL END
FROM "BoardColumn" c
WHERE c.id = t."columnId";

ALTER TABLE "BoardColumn" DROP COLUMN "isDoneColumn";
