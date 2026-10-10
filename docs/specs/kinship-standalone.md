---
title: Kinship as a standalone public app
summary: Pull Kinship and its own database out of the old home-server setup into a new public GitHub repo that anyone can run with one compose file
created: 2026-10-09
next: done (plan complete)
started: 2026-10-09
---
# Kinship as a standalone public app

## Goal
A new public GitHub repo, `kinship`, holding Kinship (contacts, notes, board, calendar) with its
own Postgres, runnable by anyone with `docker compose up` and an `.env`. Nothing in it refers to
the old home-server setup, its domain, its secret vault, or the user's personal
details. The old private repo `kb-relationship-manager` stays as it is.

## Scope
In:
- New repo `kinship` with fresh git history, built from `kb-relationship-manager` main
  at c1495e7 (includes the board render-loop fix).
- Remove the home-server coupling: its settings, the `X-Estate-User` header, the secret-vault
  modes (their library, probe and tests), the shared-cluster assumption, server paths, the home
  domain, the Hub link, the server operating notes, and server-only scripts (dev proxy,
  puppeteer smoke runs).
- Single-user only (decision 5): no sign-in, one owner, reachable only on the same computer.
- Own database in `compose.yaml`: official Postgres image, pinned; migrate job; web; bind-mounted
  data and uploads; healthchecks.
- Repo standards (code.md 3, 9, 19-23): README, CHANGELOG, LICENSE, Dockerfile, compose.yaml,
  .env.example, scripts/check.sh, working ESLint + Prettier, tsc, Vitest unit + integration,
  npm audit, gitleaks, image build and health, Playwright browser tests for every page and main
  flow, Node 24 LTS pinned.
- Phase 02 detail (2026-10-09):
  - Integration tests against the running container are Playwright API tests for every route,
    plus the CLI jobs (seed, archive export and import, LinkedIn import).
  - The upgrade check (code.md 25) upgrades from the newest `vX.Y.Z` tag, or from origin/main
    before the first release.
  - `upstream.yaml` lists every pinned piece (code.md 27).
  - The React-hooks and `any` lint findings get fixed (321 errors and 24 warnings in the dry run),
    after the browser tests exist.
  - Decision 10's four small fixes.
- Phase 03 detail (2026-10-09, decisions 16-18):
  - The 28 in-range npm updates through `upstream upgrade kinship dependencies`, merged first.
  - Questions 12, 13 and 14 fixed, with tests.
  - One image for the web app and the CLI; compose.yaml pulls it by exact version and can
    still build from source; a quick check keeps package.json, compose.yaml and the CHANGELOG
    on the same version; README screenshots from the demo data.
- Release 0.1.0: git tag `v0.1.0`, CHANGELOG, image `ghcr.io/noprofessional582/kinship:0.1.0`
  (linux/amd64), README quick start proven from a fresh clone.
Out:
- Moving production Kinship data. Dev never touches production data (security.md 1); the
  app's archive export/import is documented for the user to move their own data.
- Rewriting Kinship onto FastAPI + React/Vite (decision 3).
- Changes to `kb-relationship-manager`, the home-server repos, or the dev platform.
- AI features (the Refine plan in docs/ stays unbuilt and is not carried over).

## Architecture
Unchanged app: Next.js 16 (App Router, React 19) serving pages and `/api/*`, Prisma 7 to Postgres,
TanStack Query on the client. Through phase 02: one image (`runner` stage) plus the `builder`
stage used by the one-shot `migrate` service (runs prisma/check-migrations.mjs then
deploy-migrations.mjs). From phase 03 step 04 (decision 16): one image,
`ghcr.io/noprofessional582/kinship:<version>`, holds the web server and the CLI (Prisma CLI,
tsx, migrations, seed, archive, LinkedIn import); `migrate` and `web` both run it, and
compose.yaml keeps a `build:` so it can be built from source. The CLI lives in `/app/cli` with
only the packages it uses (docker/cli-modules.mjs), apart from the web server's node_modules;
`migrate` runs there as root.

Standalone compose: `db` (official `postgres:18.x`, pinned exact; `pg_trgm` is a trusted
extension the database owner can create, so no init script or superuser use by the app),
`migrate` (depends on db healthy), `web` (depends on migrate completed). Data in
`./data/postgres` and `./data/uploads` bind mounts. Web published on `127.0.0.1:3000` by default
for the public repo's users; the dev VM test stack overrides this with no published port
(network.md 2).

Identity (decision 5): single user only. One module (`lib/identity.ts` + `middleware.ts`)
returns the owner from `KINSHIP_OWNER` (required; missing refuses to start) for every request and
every CLI command. No request header is trusted for identity: the `x-estate-user` path is removed,
not renamed. Rows keep their `owner` column, so adding sign-in later stays possible without a data
change. The app is reachable only on the same computer: compose publishes `127.0.0.1:3000` only.

## Data model and API outline
Unchanged: 19 Prisma models, 14 migrations (the first standalone release starts from the same
schema, so a database exported from the old app imports cleanly). API routes under `app/api/*`
unchanged. Settings renamed to `KINSHIP_*`; the CLI
commands (seed, archive export/import, LinkedIn import) read `KINSHIP_OWNER`.

## Repos and stacks touched
- New: github.com/NoProfessional582/kinship (public; decisions 1-2).
- Read only: the old private repo `kb-relationship-manager` (source of the copy).
- Test stacks on the dev VM, with their own Postgres and no published port: check.sh starts
  `test-kinship` and `test-kinship-upgrade` itself and removes them after every run. Phase 03
  step 05 ran the README quick start as `test-kinship-quickstart` and removed it.
- Work happens on agent branches (`claude/...`, `codex/...`); `main` is pushed only after the
  user's merge yes.
- Outside the repo: the privacy sweep's pattern list.

## Dependencies
- Official images only: `node:24.x-alpine` (pinned exact), `postgres:18.x` (pinned exact),
  `mcr.microsoft.com/playwright:v1.63.0-noble` for browser tests.
- npm registry for packages, locked in package-lock.json.
- Dev tools, pinned exact:
  - ESLint 9.39.5. ESLint 10 crashes with eslint-config-next 16.3.8, so it waits for a plan.
  - eslint-config-next 16.3.8, which moves with next.
  - Prettier 3.9.9.
  - @playwright/test 1.63.0, matching the Playwright image.
  - @types/node 24.x.
- Decision 9: npm `overrides` force mysql2 3.24.5 and deepmerge-ts 8.0.2 under Prisma
  7. The Prisma 8 plan drops them.

## Release and rollback
- 0.1.0 = first public release: tag `v0.1.0` on main, CHANGELOG entry, image
  `ghcr.io/noprofessional582/kinship:0.1.0` (linux/amd64, exact tag only, no `latest`). The
  user makes the GHCR package public, or tells the agent to (decision 7).
- Next.js 16.4 and Playwright 1.64 (cool-down until 2026-10-14) come after 0.1.0 through
  `upstream`, as 0.1.1 (decision 17).
- Released 2026-10-09: main dffd8da, tag `v0.1.0`, image digest
  `sha256:60ea4c15ecd15adc185e5b657d6b761cc91b86d11d2cd13f817fc44e6f5d07f0` (1.1 GB unpacked).
  GitHub has no API for package visibility, so the user made the package public in its settings
  page; it pulls with no login.
- Rollback: the old private repo remains the working copy of the app; nothing in it changes.
  A bad public commit is fixed forward (never rewrite pushed main history, code.md 8).

## Risks
- Personal data in a public repo. Mitigation: fresh history; commits authored with the GitHub
  noreply address; gitleaks plus a personal-data sweep (emails, phone numbers, names, the home
  domain, server paths) as a check in scripts/check.sh (its `privacy` part) before every push.
  The sweep's pattern list stays outside the repo: committing it would publish
  the very names, emails and domain it guards.
- With no sign-in, anyone who can reach the app has full access. Mitigation: compose binds to
  127.0.0.1 only; the README says plainly not to expose it to a network or put it on the
  internet; a check fails if compose publishes anything other than 127.0.0.1.
- Hidden home-server assumptions break at runtime (e.g. middleware expecting the header).
  Mitigation: Playwright tests for every page and main flow.
- Next.js and Prisma major versions move fast; pin exact versions and the lockfile.
- The React-hooks lint fixes change component code, including the board where the render loop
  lived. Mitigation: the browser tests and the board-freeze guard are written first (phase 02,
  steps 02-03), and the board files change last, one at a time.
- Forcing newer mysql2 and deepmerge-ts under Prisma (decision 9) could break the Prisma CLI.
  Mitigation: every stack check runs generate, migrations, seed and the archive CLI.
- ESLint 9 is out of support (npm marks 9.39.5 deprecated), but ESLint 10 crashes with
  eslint-config-next 16.3.8. Mitigation: it is a lint tool only, never in the running app;
  `upstream check` lists ESLint 10 as a new major, which gets its own plan once
  eslint-config-next supports it.

## Decisions
<!-- The user's decisions, dated. -->
- 2026-10-09: the user asked for a new **public** repo. This overrides code.md 2 (new repos are
  private); noted to the user once (CORE 1).
- 2026-10-09 (plan approved): 1. repo name `kinship`. 2. Fresh history, one clean first commit;
  commits authored with the GitHub noreply address. 3. Keep Next.js + Prisma (code.md 18
  exception approved). 4. MIT license. 5. **Single user on localhost only** for now: no sign-in
  modes, no proxy header (the user removed the proxy mode from the recommendation). 6. Create the
  public repo at the end of phase 01, after the secret and personal-data scans pass; README marks
  it pre-release until 0.1.0. 7. Publish `ghcr.io/noprofessional582/kinship` from 0.1.0; the user
  makes the package public or tells the agent to.
- 2026-10-09 (after step 02): 8. Patch Next.js 16.3.3 to 16.3.8 before publishing (critical
  `next/og` advisory; a one-time exception to code.md 27, since `upstream upgrade` needs
  origin/main and scripts/check.sh), then merge and publish: approved. The user also chose the
  id-based noreply address, `210984904+NoProfessional582@users.noreply.github.com`, for every
  commit, and ran the email rewrite of the unpushed commits themselves after the safety check
  blocked it.
- 2026-10-09 (phase 02 planning; the user said "yes to both" recommendations):
  - 9. Clear the dependency audit with a one-time exception to code.md 27, like decision 8.
    - Why: npm audit showed 7 high and 1 moderate. Four packages are fixed inside their current
      ranges: sharp, source-map-js, undici, fast-uri. The other highs come from two helpers that
      Prisma 7.9.1 and 7.10.0 pin exactly, both used only by Prisma's command-line tool:
      mysql2 3.15.3 and deepmerge-ts 7.1.5. Prisma's own fix is only in 8.1 dev builds.
    - What: on the phase 02 branch, refresh only those four packages, and add npm `overrides`
      forcing mysql2 3.24.5 and deepmerge-ts 8.0.2 under Prisma 7. The Prisma 8 plan removes
      the overrides. After phase 02 merges, upgrades go only through `upstream`.
    - Not chosen: waiting for Prisma 8.1; a dated exception in check.sh, which would weaken a
      check.
  - 10. Four small fixes found in phase 01, in phase 02 step 02, each with a test:
    - `middleware.ts` becomes `proxy.ts`.
    - No whole-project tracing in the image (lib/uploads.ts).
    - Board order breaks ties by id.
    - Archive downloads are named `kinship-archive-*.json`, keeping the `kb-archive` format
      marker inside.

- 2026-10-09 (phase 02 step 01; the user said "yes to question 11, as recommended"):
  - 11. A new high advisory fails the dependency audit, and no fix is released.
    - Why: braces <=3.0.3, GHSA-vfj7-8cjw-p6xm (CVE-2026-93687, published 2026-09-18): a
      deeply nested brace pattern exhausts the stack (denial of service). It came with the
      lint tools: eslint-config-next → @next/eslint-plugin-next, which pins fast-glob 3.3.1 →
      micromatch 4.0.8 → braces 3.0.3 (the newest braces). next 16.4.0 and the 16.5 canaries
      pin the same chain. Fix PRs on micromatch/braces are open since 2026-10-06, none
      merged. Not in the app image's runtime; braces only sees patterns from the repo's own
      lint settings. Decision 9's eight findings are all cleared.
    - What: keep eslint-config-next and continue; steps 02-05 don't depend on the audit. When
      braces releases a fix, any step's session takes it as a one-time exception like
      decision 9 (an in-range refresh, or an override if the fix is a new major), in its own
      commit. If no fix is out when step 06 is otherwise ready, lint without
      @next/eslint-plugin-next: the same React, hooks, accessibility, import and TypeScript
      rules installed directly, losing its 22 Next.js rules (only `no-page-custom-font` fires
      today, once); switch back when the fix lands.
    - Not chosen: a braces fix from an unmerged GitHub PR (unreviewed code); a dated audit
      exception in check.sh, which weakens a check (turned down for decision 9).
    - Outcome (phase 02 step 06): no braces fix was out, so the fallback applied. eslint.config.mjs
      sets up eslint-config-next 16.3.8's plugins and rules directly (resolved config identical
      minus the 22 `@next/next` rules); npm audit is clean. Switch back when braces is fixed.

15. Approved 2026-10-09: allow only the complete `X-Estate-User` header name in the
    private privacy patterns. Other home-server names, headers, settings and header prefixes
    or suffixes remain flagged. Applied and verified with nine synthetic cases; both
    gitleaks scans and the private sweep pass across the working tree and 16 commits.

- 2026-10-09: User approved migrating the three existing fonts to next/font in step 04 to resolve the root-layout font lint false positive while keeping all rules enabled.

- 2026-10-09: User instructed to correct legitimate issues and continue past harmless findings. Apparent false positives no longer require a pause in step 04. Successful Next route cancellations are classified narrowly by protocol, response and completed destination, with negative tests preserving real request failures.

- 2026-10-09 (phase 03 planning; the user's answers):
  - 16. **One bigger image** for the web app and the database jobs, instead of the
    recommended two images (web plus a tools image). The runner stage gains the Prisma CLI,
    tsx and the CLI scripts; `migrate` runs the same image. compose.yaml pulls it by exact
    version and keeps a build-from-source path. linux/amd64 only for now. Not chosen: two
    images; publishing only the web image (users would still build `migrate`).
  - 17. **Don't wait** for Next.js 16.4.0 and Playwright 1.64.0 (cool-down until
    2026-10-14): take the 28 ready in-range updates through `upstream`, release 0.1.0 when it
    is checked; those two follow as 0.1.1. Not chosen: hold 0.1.0 until 14 October.
  - 18. Fix open questions **12, 13 and 14** before 0.1.0, each with tests, as recommended
    (phase 03 steps 02-03).
  - 19. **Fix the upstream tool**, as recommended (the user's answer, 2026-10-09). `upstream
    upgrade` failed on Kinship's eight exact @tiptap pins (npm ERESOLVE: starter-kit's nested
    extensions stayed locked at the old version). Before `npm install` takes moved pins, the
    tool now drops their lockfile entries and every entry that requires an old version of one
    exactly. In the agents' tooling, with tests (132 pass). Not chosen: release without the
    refresh.

## Open questions
- Decided (18), phase 03: 12 (from phase 02 step 02). Six pages have no main heading, which screen readers use to find
  their way around a page: the desktop note page, and the phone's contacts, notes, projects,
  board and calendar pages. Their tests check each page's own content instead.
  - Recommendation: add one to each, read by screen readers only, so nothing changes on screen.
    Step 04 completed the hook work without this undecided change. If approved, the page tests then check
    every page's heading.
  - Or: leave the pages as they are.

- Decided (18), phase 03: 13 (from phase 02 step 03 API tests). Reading an unknown contact, entry, project or
  task answers `200 null`; calendar PATCH with an unknown project answers 500; edges GET
  with an unknown entity type answers 500. Tests pin the existing behavior.
  - Recommendation: a later approved step returns 404 for missing records and 400 for bad
    types, and updates the pages to handle 404. Do not change routes in the test-writing step.
- Decided (18), phase 03: 14 (from phase 02 step 03 browser tests). On the phone, mention suggestions are behind
  the capture sheet and cannot be tapped (keyboard selection works). Search results open
  desktop URLs, leaving the phone interface.
  - Recommendation: a later approved step places suggestions inside/above the sheet and
    maps search result URLs to `/m`; add browser regression tests for tapping and phone URLs.

- Decided (19), phase 03: 19 (from phase 03 step 01). See Decisions.

## Phases
<!-- One line per phase: NN · name · status (todo | in-progress | done) · one-line goal -->
- 01 · extract-and-decouple · done · Fresh repo with Kinship and its own database, home-server coupling removed, single user on localhost, runs from one compose file on the dev VM
- 02 · checks-and-tests · done · scripts/check.sh with every code.md 9 check plus the upgrade check, Playwright API and browser tests for every route, page and flow, lint fixed, Node 24 and images pinned (6 steps, all done; merged to main 7616dfa on 2026-10-09)
- 03 · publish-0.1.0 · done · Dependency refresh merged; questions 12-14 fixed; one image for web and CLI; merged to main dffd8da and tagged v0.1.0 on 2026-10-09; image ghcr.io/noprofessional582/kinship:0.1.0 (sha256:60ea4c15…5d07f0) published and public; README quick start proven from a fresh clone of the public repo with the published image
