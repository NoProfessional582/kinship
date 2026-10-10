-- Throwaway previous-version fixture. Never run on an existing installation.
INSERT INTO "Contact" (id, owner, slug, "displayName", "lastContactAt", "updatedAt")
SELECT '__recency_upgrade_' || name, CASE WHEN name = 'other-owner' THEN 'recency-other' ELSE 'recency-upgrade' END,
       name, 'Upgrade recency ' || name,
       CASE WHEN name = 'unchanged' THEN timestamp '2000-01-01' ELSE timestamp '2002-01-01' END, timestamp '2000-01-01'
FROM unnest(ARRAY['backdated','fallback','future-only','trashed-only','empty','unchanged','foreign-only','other-owner']) AS name;
INSERT INTO "Entry" (id, owner, "bodyJson", "bodyText", "occurredAt", "deletedAt", "updatedAt")
SELECT '__recency_upgrade_' || name, CASE WHEN name IN ('foreign-only','other-owner') THEN 'recency-other' ELSE 'recency-upgrade' END,
       '{"type":"doc","content":[]}'::jsonb, 'Source fixture ' || name,
       CASE WHEN name = 'future-only' THEN timestamp '9999-01-01'
            WHEN name IN ('unchanged','fallback-old') THEN timestamp '2000-01-01'
            WHEN name = 'fallback' THEN timestamp '1999-01-01'
            ELSE timestamp '2001-01-01' END,
       CASE WHEN name = 'trashed-only' THEN timestamp '2001-02-01' ELSE NULL END,
       timestamp '2000-01-01'
FROM unnest(ARRAY['backdated','fallback','fallback-old','future-only','trashed-only','unchanged','foreign-only','other-owner']) AS name;
INSERT INTO "Mention" (id, "entryId", "contactId")
SELECT '__recency_upgrade_' || name, '__recency_upgrade_' || name,
       '__recency_upgrade_' || CASE WHEN name = 'fallback-old' THEN 'fallback' ELSE name END
FROM unnest(ARRAY['backdated','fallback','fallback-old','future-only','trashed-only','unchanged','foreign-only','other-owner']) AS name;
