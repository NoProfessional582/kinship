-- Contact photos were removed from the app: no upload route, no /uploads files,
-- and archives no longer carry them.
ALTER TABLE "Contact" DROP COLUMN "avatarUrl";
