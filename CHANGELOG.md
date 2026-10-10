# Changelog

All notable changes to Kinship are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Kinship as a standalone app: one `compose.yaml` runs its own PostgreSQL 18
  database, a one-shot migration job and the web app, and keeps everything in
  `./data`.
- Single-user identity: everything acts as the one owner named by
  `KINSHIP_OWNER`, and no request header can change that. The web port is bound
  to `127.0.0.1` only.
- `.env.example` with the three settings, and a README covering setup, settings,
  backups, restores and upgrades.
- `GET /api/health`, used by the container health check.
- MIT license.
- `scripts/check.sh` runs the checks before a merge and stops at the first
  failure. `quick`: format, lint, types, unit tests, the dependency audit, and
  that compose publishes ports on `127.0.0.1` only. `privacy`: gitleaks on the
  branch's commits and the working tree, and a sweep for personal data using a
  private pattern list kept outside the repo. `stack` (`scripts/test-stack.sh`):
  builds the image and runs the app in a throwaway test stack with its own
  database, no published port and no way out, then checks health and logs and
  runs the database tests, the command-line jobs (seed, export, import, LinkedIn
  import) and the Playwright tests. Its log checks allow no errors at start-up or
  while the pages load, and afterwards only the exact refusals the tests ask for.
  `upgrade` (`scripts/test-upgrade.sh`): the previous version makes a database
  and uploads a photo, then this version migrates and runs on it; every table
  must keep its rows, the photo its bytes, and every page must load. Each part
  removes everything it made, pass or fail. The README's "Checks" explains them.
- Playwright tests (`npm run test:e2e`, run inside the test stack): every page
  loads with no errors, the eleven desktop pages in Desktop Chrome and the same
  eleven under `/m` on a Pixel 7. API tests for every route, `/uploads` and
  `/icons`. Browser flows on a desktop and a phone: contacts and photos, notes
  with mentions, projects, board moves, calendar events, settings, search, trash,
  and archive download and restore, including a made-up archive in the old app's
  format. A guard checks the board stays idle after New task closes.
- `scripts/node.sh` runs npm in the Dockerfile's Node image, so the checks need
  no Node on the host.
- Prettier and ESLint (`npm run format`, `format:check`, `lint`). The whole
  repo was formatted once; `.git-blame-ignore-revs` lets `git blame` skip that.
- `upstream.yaml` lists the pinned pieces: the Node image, Postgres, Next.js,
  Playwright (the npm package and the test stack's browser image, together)
  and the npm lockfile.

### Changed

- `npm run lint` runs ESLint 9 with Next.js's React, hooks, accessibility, import
  and TypeScript rules, since Next.js 16 no longer has `next lint`. For now it
  runs without Next.js's own plugin (see Security), and `eslint.config.mjs` sets
  the same rules up directly.
- The three fonts are bundled with the app through `next/font` instead of loaded
  from Google Fonts in the browser.
- Components no longer copy props into state from effects, or read refs while
  rendering, as React's hooks rules ask; the code is typed throughout, with no
  `any`. What the app does is unchanged.
- `@types/node` 24, to match Node 24.
- The single-user gate is `proxy.ts`, Next.js 16's new name for
  `middleware.ts`, and now runs in the Node.js runtime.
- Archive downloads are named `kinship-archive-<time>.json`, and a file that is
  not an archive is refused as "Not a Kinship archive". The marker inside stays
  `kb-archive`, so archives move both ways between the old app and Kinship.
- Refresh dependencies (`upstream upgrade`): package-lock.json: @alloc/quick-lru 5.2.0 → 5.3.0, @bramus/specificity 2.4.2 → 2.4.3, @csstools/color-helpers 6.1.1 → 6.1.2, @csstools/css-calc 3.3.0 → 3.4.3, @csstools/css-color-parser 4.2.0 → 4.2.6, @csstools/css-parser-algorithms 4.0.0 → 4.0.2, @csstools/css-syntax-patches-for-csstree 1.1.8 → 1.1.15, @csstools/css-tokenizer 4.0.0 → 4.0.2 (+114 more) (package.json pins: @tiptap/core, @tiptap/extension-placeholder, @tiptap/extension-task-item, @tiptap/extension-task-list, @tiptap/pm, @tiptap/react, @tiptap/starter-kit, @tiptap/suggestion).

### Fixed

- The settings page's time zone list no longer causes a hydration error when the
  server's and the browser's time zone data disagree.
- The app image no longer carries the source code: two avatar file paths, known
  only at run time, made the build copy the whole project into it.
- Board cards, subtasks and columns that share a position always come back in
  the same order (by id), instead of whichever order the database chose.
- On a phone, the projects list shows each project's done and total task counts
  again, and a contact's "other details" show their labels.
- Reading a contact, note, project or task that doesn't exist answers 404
  instead of `200 null`; moving an unknown project on the calendar answers 404,
  and listing relationships for an unknown type answers 400, instead of a 500.
  The contact, note and project pages and the task view say "not found", with a
  way back, on a desktop and on a phone, where the note and contact pages used
  to keep loading forever. A refused request is no longer retried.
- Moving an unknown task on the calendar is refused before anything is written.

### Security

- Next.js 16.3.8 (from 16.3.3), which fixes a critical advisory in `next/og`
  ImageResponse, used to draw the app icons, and a high one in image
  optimization.
- Dependency fixes inside their current version ranges: sharp 0.35.5 (a
  librsvg advisory in its bundled libvips), source-map-js 1.2.2, fast-uri 3.1.8
  and, for the tests only, undici 7.30.0.
- npm `overrides` force mysql2 3.24.5 and deepmerge-ts 8.0.2 under the Prisma
  7 command-line tool, which pins older versions with high advisories. They go
  when Kinship moves to Prisma 8.
- The lint tools no longer include `eslint-config-next`: its Next.js plugin
  brings in braces, which has a high advisory (GHSA-vfj7-8cjw-p6xm) and no fixed
  release yet. It comes back once braces is fixed.
