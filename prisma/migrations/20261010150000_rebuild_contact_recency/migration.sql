-- Repair only derived recency. Entries, mentions, contacts and photos are preserved.
-- Match runtime: live entries owned by the contact's owner, occurred at or before now.
UPDATE "Contact" AS c
SET "lastContactAt" = (
  SELECT max(e."occurredAt")
  FROM "Mention" AS m JOIN "Entry" AS e ON e.id = m."entryId"
  WHERE m."contactId" = c.id AND e.owner = c.owner
    AND e."deletedAt" IS NULL
    AND e."occurredAt" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
);
