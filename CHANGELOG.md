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

### Fixed

- The settings page's time zone list no longer causes a hydration error when the
  server's and the browser's time zone data disagree.

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
