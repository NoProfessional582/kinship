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
  private pattern list kept outside the repo.
- `scripts/node.sh` runs npm in the Dockerfile's Node image, so the checks need
  no Node on the host.
- Prettier and ESLint (`npm run format`, `format:check`, `lint`). The whole
  repo was formatted once; `.git-blame-ignore-revs` lets `git blame` skip that.
- `upstream.yaml` lists the pinned pieces: the Node image, Postgres, Next.js
  and the npm lockfile.

### Changed

- `npm run lint` runs ESLint 9 with Next.js's rules, since Next.js 16 no longer
  has `next lint`.
- `@types/node` 24, to match Node 24.
- The single-user gate is `proxy.ts`, Next.js 16's new name for
  `middleware.ts`, and now runs in the Node.js runtime.
- Archive downloads are named `kinship-archive-<time>.json`, and a file that is
  not an archive is refused as "Not a Kinship archive". The marker inside stays
  `kb-archive`, so archives move both ways between the old app and Kinship.

### Fixed

- The settings page's time zone list no longer causes a hydration error when the
  server's and the browser's time zone data disagree.
- The app image no longer carries the source code: two avatar file paths, known
  only at run time, made the build copy the whole project into it.
- Board cards, subtasks and columns that share a position always come back in
  the same order (by id), instead of whichever order the database chose.

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
