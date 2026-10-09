-- Single-row settings. Timezone is nullable: null means "follow the browser".
CREATE TABLE "Settings" (
    "id"        TEXT NOT NULL DEFAULT 'singleton',
    "timezone"  TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Settings" ("id", "timezone", "updatedAt") VALUES ('singleton', NULL, now());
