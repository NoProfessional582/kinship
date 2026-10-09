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
