-- Hand-written: `prisma migrate dev` would propose dropping the generated
-- searchVector columns and their GIN indexes alongside this. See
-- 20260821194100_restore_search_indexes for what that costs.

-- Task and Project dates are genuine instants — "due by noon tomorrow" is a
-- real deadline — but they are just as often whole days. Midnight cannot serve
-- as the "no particular time" sentinel: it would make a real midnight deadline
-- unexpressible, and it is exactly what every existing row already holds.
--
-- Defaulting to true preserves what every current row means. Nothing on screen
-- changes when this runs: the readers already discard the time of day.
ALTER TABLE "Task"    ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT true;

-- All-day rows are read as UTC-midnight calendar days, so make that true of the
-- data rather than merely assumed. Three seeded tasks carry a time component
-- from `daysAhead()`, which the readers were silently slicing off anyway.
UPDATE "Task"
   SET "startDate" = date_trunc('day', "startDate"),
       "dueDate"   = date_trunc('day', "dueDate")
 WHERE "allDay" AND ("startDate" IS NOT NULL OR "dueDate" IS NOT NULL);

UPDATE "Project"
   SET "startDate"  = date_trunc('day', "startDate"),
       "targetDate" = date_trunc('day', "targetDate")
 WHERE "allDay" AND ("startDate" IS NOT NULL OR "targetDate" IS NOT NULL);
