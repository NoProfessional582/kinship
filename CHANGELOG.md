# Changelog

All notable changes to Kinship are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-10-16

### Added

- A description of the whole API (OpenAPI 3.1), served at `GET /api/openapi.json` and kept in `docs/api/kinship.openapi.json`. It is generated from the code, the checks fail when it is out of date or misses a route, and tests check real answers against it.
- `docs/api/agents.md`: how a script or AI agent on the same computer uses the API, with worked `curl` calls.
- Notes can be written as plain text: `POST /api/entries` and `PATCH /api/entries/{id}` take `body`, text with mentions such as `@[Maya Okafor](contact:<id>)`, `[[Ship v2]](task:<id>)` and `[[Launch]](project:<id>)` (an id of `new` creates the record), instead of the editor's `bodyJson`. Every answer that carries an entry includes `body`, which can be sent back unchanged. A `body` that mentions an id Kinship doesn't have is refused with 400.
- An MCP endpoint for AI agents on the same computer, at `POST /api/mcp` (Streamable HTTP, stateless, JSON answers; `GET` and `DELETE` answer 405). Read tools search and read contacts, notes, tasks, projects, the board, the calendar, who is due for a catch-up and a record's neighbourhood on the map; write tools create and update contacts, tasks, projects and notes, move tasks, link and unlink records, and move records to the trash. Each tool uses the same checks as the matching API route. No tool can change settings, delete anything for good, import an archive or upload a photo.
- An "Agents" setting in Settings (desktop and phone): agents may read and change (the default) or only read. With read only, the write tools are hidden from agents and refused if called; the change takes effect at once. `GET` and `PATCH /api/settings` carry it as `agentAccess` (`write` or `read`).
- `KINSHIP_AGENT_ACCESS=off` in `.env` turns the MCP endpoint off entirely (it answers 404); any other value, or none, leaves it on.
- A guide to connecting AI agents, in `docs/api/agents.md`: setup for Claude Code, Claude Desktop, Codex (CLI, IDE extension and app), Hermes Agent with an OpenAI model and any other MCP client; what agents can and can't do; the read-only and off switches; safety; why the Gemini app can't connect; troubleshooting. The README has a short "Agents" section pointing to it.

### Fixed

- A request body that is not valid JSON is refused with 400 ("The body is not valid JSON.") instead of a 500 server fault.

## [0.4.0] - 2026-10-11

### Added

- The map is part of Kinship: "Map" in the desktop sidebar, "Go to map" in the command palette, and "Map" in the phone app's More menu, which opens the map inside the phone app (`/m/map`).
- Links that open the map on one record: `/map?focus=<type>:<id>` (and `/m/map?focus=`) selects it, centres it and opens its inspector. A record that is not on the map shows the whole map with a short notice instead of an error.
- A small map on each contact and project page (desktop and phone) showing the record's neighbourhood up to two links away, with the record selected. It loads only when scrolled into view and frees its 3D canvas when the page is left; it has loading, no-connections, failed and no-WebGL states. "Open in map", or picking a record in it, opens the full map focused there.
- An "Attraction" slider on the map (0.2x to 2.5x): higher pulls linked records closer together, lower spreads them out. The map is laid out again a moment after the slider settles; the current map stays on screen meanwhile, and the view and the selection are kept.
- The mouse wheel zooms the map towards the pointer rather than the middle of the view.
- The map follows the app's theme. By day it is drawn on Kinship's paper with dark stars, ink names and terracotta highlights, with the controls, inspector and Records list in the light palette; after dark it is the approved deep-space map. The small maps on contact and project pages follow too.

## [0.3.0] - 2026-10-11

### Added

- The map at `/map` is now explorable. Hovering a record lights its direct connections and dims the rest; clicking selects it, centres the orbit on it and rings it with a pulsing beacon (a still ring with reduced motion). Hovered records grow 1.2x and the selected one 1.35x, as in the approved prototype.
- A glass overlay on the map: the colour legend, auto-orbit (off at first), Reset view, a star density button, and live sliders for node size, link width and glow. Settings last for the visit; nothing is saved. On phones the controls fold behind a "View" button.
- An inspector for the selected record: its type, name, subtitle and description, an "Open record" link where it has a page (tags have none), and a button per connected record listing each relation with its direction, which selects that record. A drawer on the right on wide screens, a sheet along the bottom on phones; the view moves so the selected record stays in sight beside it.
- A "Records" list on the map, grouped by type with a name filter, so the map can be explored by keyboard alone. Focus moves into the inspector when it opens and back when it closes; Escape, a click on empty space or the close button clears the selection.

## [0.2.0] - 2026-10-11

### Added

- `GET /api/graph`: the owner's contacts, projects, entries, tasks and tags with the links between them, or one record's neighbourhood with `focusId` and `depth`, for the coming 3D map. Read-only, uncached, and typed from `docs/api/graph.openapi.json`.
- A 3D layout for the map (`lib/graph/layout3d.ts`): repeatable, browser-safe positions with spacing between orbs; 1,000 records and 3,000 links in about 1.5 s on the dev VM (`docs/graph-layout.md`).
- The 3D map at `/map` (no sidebar link yet): the Cosmic Nexus scene drawn with Three.js, laid out in a browser worker, with orbit, zoom and touch controls. It shows a message while loading, when there are no records, and when loading fails (with Try again); a browser without WebGL gets a list of the records with their links instead.
- A render benchmark for the map (`tests/benchmark`), with results in `docs/graph-layout.md`.

### Dependencies

- Add d3-force-3d 3.0.6 and three 0.186.1, and openapi-typescript 7.13.0 and @types/three 0.186.0 for development.

## [0.1.4] - 2026-10-10

### Changed

- Remove the unused Separator component, its direct dependency and the obsolete attributesPayload helper.
- Record final acceptance for all six review findings, including an in-place upgrade from source version 0.1.3.

## [0.1.3] - 2026-10-10

### Fixed

- Export only referenced live and trashed contact photos; preserve shared photos and external URLs.
- Reuse verified immutable photo bytes on restore, with safe partial-stage and transaction rollback.
- Protect pending uploads for seven days and reclaim only recorded new-operation candidates after grace and reference checks.
- Add a read-only owner photo inventory; existing untracked orphan files remain untouched.

### Tests

- Cover photo concurrency, filesystem failures, repeated restore, desktop and phone flows, and in-place upgrades with shared, trashed and legacy orphan photos.

## [0.1.2] - 2026-10-10

### Fixed

- Reject task-parent cycles on saves and archive restore, including concurrent reparent operations. Add a read-only task hierarchy inventory.
- Include task and project spans encompassing a calendar window, while keeping timed windows exclusive and all-day timezone handling intact.
- Recompute contact recency after earlier/future date edits, calendar moves, follow-up edits, mention changes and restore. Coordinate concurrent source changes and rebuild stale archive values.
- Correct existing derived contact recency with an in-place migration preserving source records and photos.

### Tests

- Cover concurrent task and entry edits, cyclic archive rollback, deep trees, interior calendar months, and exact recency correction on previous-version upgrades.

## [0.1.1] - 2026-10-10

### Fixed

- Reject cross-origin writes, hostile Host headers, and inappropriate API content types while preserving same-origin browser and local CLI access.
- Apply the configured public port to the request guard and protect photo and export reads against hostile hosts.

### Tests

- Cover request provenance and real browser attacks, including attempted empty-archive wipes.

## [0.1.0] - 2026-10-09

The first release.

### Added

- Kinship as a standalone app: one `compose.yaml` runs its own PostgreSQL 18
  database, a one-shot migration job and the web app, and keeps everything in
  `./data`.
- A published image, `ghcr.io/noprofessional582/kinship:0.1.0` (64-bit
  Intel/AMD), so `docker compose up -d` downloads Kinship instead of building it;
  `docker compose up -d --build` still builds it from the checkout. The one image
  runs both the web app and the command-line jobs (migrations, the seed, archive
  export and import, LinkedIn import), which it keeps in `/app/cli` with only
  the packages they use.
- Screenshots in the README, made from the demo data.
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
  `quick` also checks that package.json, its lockfile, compose.yaml's image, the
  Dockerfile's version label and this file's newest release name one version.
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
- Every page has one main heading for screen readers: the desktop note page and
  the phone's people, notes, projects, board and calendar pages had none. Nothing
  changes on screen.
- On a phone, `@` and `[[` suggestions in the capture sheet can be tapped; before,
  only the keyboard could pick one.
- On a phone, search results open the phone's own pages instead of the desktop
  ones, and a task result opens the task on the phone board (`/m/board?task=`).

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

[Unreleased]: https://github.com/NoProfessional582/kinship/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NoProfessional582/kinship/releases/tag/v0.1.0
