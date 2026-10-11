---
title: Kinship: security and data correctness repairs
summary: Address all six review findings with focused regression tests and safe handling of existing data.
created: 2026-10-10
next: ""
overview_url: /home/nicho/Agents/plans/completed/kinship-review-fixes/overview.html
started: 2026-10-10
completed: 2026-10-10
---
# Kinship: security and data correctness repairs

## Goal
Resolve the six findings in the October 10 review of Kinship 0.1.0 at commit `91e6dac`: forged browser writes, task parent cycles, missing calendar spans, stale contact recency, retained/duplicated avatar files, and unused code. Each phase ends in a working state with meaningful regression coverage and all required merge checks.

Evidence: `/home/nicho/Agents/artifacts/kinship-code-review-2026-10-10/review.md`, `probes.log`, and the two reproduction `.mjs` files in that folder. Baseline: lint, format, types, 172 unit tests, 64 database tests, 174 browser/API checks, audit and secret scan passed. This baseline did not include the upgrade suite; every phase must include it before proposing a merge.

## Scope
In:
- Central request protection covering writes, exports and uploaded photos; correct origin/host handling with configurable public ports and isolated test hosts.
- Task hierarchy validation on writes and archive imports, including concurrent reparent operations; a read-only report of existing cycles before choosing any stored-data repair.
- Calendar overlap queries with date-only and timed boundary coverage.
- Transactional recency recomputation on entry date/mention edits and an in-place, versioned correction of already-stale `lastContactAt` values.
- Reference-aware photo export (including trashed contacts), idempotent photo restore, safe file lifecycle for new operations, and a preview of existing orphan files.
- Remove only confirmed unused `Separator`, its direct package dependency, and `attributesPayload`; update lockfile and affected docs.
- Regression tests, full merge checks, upgrade tests, changelog/version alignment and a reviewed release proposal.
Out:
- New sign-in, shared access, platform integration, redesign, framework migration or unrelated dependency upgrades.
- Production access/deployment, host configuration changes or other repositories/stacks.
- Automatic deletion of legacy orphan files or automatic repair of existing hierarchy cycles. A concrete preview and specific user approval precede either action.

## Architecture
Keep the existing Next.js/React/Prisma/PostgreSQL architecture. Keep Kinship's loopback-only publication and single configured owner. Request validation belongs in a small server-only policy module used by `proxy.ts`, with media-type validation applied centrally before API handlers. Product behavior should remain familiar: normal desktop/phone saves, avatar uploads, archive restore and documented command-line operations continue working.

Recommended request policy: explicitly allow supported local hosts at the configured public port; compare source Origin exactly with the validated target origin, including scheme and port; reject foreign, malformed and `null` origins and unsafe requests identified as cross-site or same-site-but-different-origin. Use Referer as a checked fallback when present. Originless command-line requests with no browser provenance headers remain usable on an allowed host, with the proper Content-Type. JSON bodies require `application/json` (with charset allowed); multipart upload retains its own content type and shares the origin policy. Do not trust forwarded headers to expand the allowlist. Isolated tests declare their own approved origin; container health checks get a narrowly scoped, data-free exception if required by port mapping. No broad CORS permissions.

The exact no-Origin/Referer/Fetch Metadata matrix must be written and tested before changing the guard. If browser compatibility requires a stronger explicit write-intent header, update the overview and obtain approval of that client contract change rather than silently breaking scripts. Background guidance: [OWASP CSRF prevention, origin verification, Fetch Metadata and simple content types](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

For data integrity, validation and writes occur in the same transaction. Task-cycle prevention must also resist two concurrent updates creating a cycle; use a narrowly scoped database lock or equivalent serializable/retry strategy, not only a read-then-write ancestor walk. Recency is derived from the latest live, past entry mentioning each affected contact. Photo files remain immutable and confined to their owner's upload directory; database commits and filesystem cleanup cannot be treated as one atomic transaction.

## Data model and API outline
- Existing public entity shapes remain stable. Foreign/null Origin writes receive a structured 403; wrong media types receive 415; a disallowed Host cannot expose owner data. Keep owner-missing and health behavior useful.
- Task create/update and archive validation reject self-parenting and multi-node cycles before persisting changes. Valid subtask trees continue to work. Existing cycles are reported first.
- Calendar queries include intervals overlapping the requested window and single-date records. Define inclusive stored deadlines and exclusive view boundaries explicitly; preserve timezone widening for all-day data without broadening timed intervals unnecessarily.
- Entry edits recompute recency for the union of previous/current mentioned contacts when dates or mentions change, including a change from past to future. Rebuild existing derived values in a versioned migration, preserving source entries.
- Export includes only owned local files referenced by stored contacts, including trashed contacts. Imported avatars reuse an already-verified immutable file when bytes match; otherwise stage a fresh file and rewrite references. Repeated restore must not grow file count. Preserve failed-import rollback and handle shared files, pending uploads, failed saves and concurrent restore/upload/purge operations.
- Build a read-only orphan inventory with file count, bytes, age, and current reference checks. Reclaim only files authorized by a concrete cleanup decision, revalidating immediately before removal. Establish a grace period/pending-upload mechanism before any general collection. No deletion of arbitrary files or another owner's files.
- No schema expansion is assumed. Any schema or stored-data change uses a versioned migration; never reset a database. A task-cycle constraint or photo tracking table, if justified during phase detailing, needs its migration, compatibility analysis and matching overview update.

## Repos and stacks touched
- Source: `/srv/src/kinship`, on a task-owned `codex/kinship-review-fixes-*` branch per phase. Recheck branch/handoff before starting.
- Plans: `/home/nicho/Agents/plans/backlog/kinship-review-fixes` until approval and `plan-start`.
- Test stacks: project's `test-kinship` and `test-kinship-upgrade`, or uniquely named isolated equivalents, no published host ports. Do not disturb the older relationship manager or other agents' stacks.
- No release stack or real user database is changed during implementation. No existing upload folder is swept during development.

## Dependencies
- Existing pinned Node/container/check toolchain and installed dependencies; remove the separator dependency only after confirming no imports.
- Phase 01 precedes the data/file phases because it closes the highest-risk attack. Phase 02 precedes phase 03 so import validation is sound before changing photo staging. Phase 04 completes cleanup and release acceptance.
- No sub-agent work is required. Later phases are detailed immediately before starting, following planning.md.

## Release and rollback
- Each phase ends with a merge proposal, including all required checks and a proposed version. Approval of this plan permits implementation; merges still follow code.md's separate approval rule.
- Target patch releases if the supported client contract remains compatible; tentative first version 0.1.1, checked against current tags at phase close. If a contract becomes breaking, apply the required major-version rule and ask about that change. Do not reuse published tags.
- Before each merge: update branch from main, rerun affected checks if files changed, and run `scripts/check.sh` (quick, privacy, stack, upgrade). Keep refusals observable; do not weaken checks to hide failures. Security rejections may need precise additions to the expected-refusal log checker.
- Before any real-data migration/cleanup: create and verify a recoverable full backup including database and uploads; record migration and affected files. A filtered app export is not a backup of unreferenced files.
- Roll back code using the previous tested image. Derived recency changes must be compatible with the prior code. A successful file deletion cannot be undone by reverting code; restore the verified file backup. Nothing is published/deployed as part of writing this plan.
- When all phases are complete, copy master.md to `docs/specs/kinship-review-fixes.md` in the repository and complete the plan through `plan-done`.

## Risks
- Docker sees internal port 3000 while the user's browser may use a different public port. Test this explicitly; avoid weakening checks to accommodate infrastructure.
- Loopback binding alone does not prevent browser-origin attacks. A custom header is not authentication and browser network permissions are not a substitute for server checks.
- Existing parent cycles and stale derived recency may already exist. Detect cycles and preserve source data; correct derived recency through a migration.
- Photo reuse/cleanup can race with a contact save, upload, export or restore. Shared references, trashed contacts, new unassigned uploads and rollback must all be protected.
- Large photo sets may exceed the existing 9 MiB HTTP/6 MiB decoded-photo restore limits. This plan prevents needless accumulation; raising limits or redesigning archives is outside scope. CLI/HTTP compatibility remains tested.

## Decisions
<!-- The user's decisions, dated. -->
- 2026-10-10: user requested a plan to address the six review findings. User approved the overview and all recommended defaults on 2026-10-10; implementation is authorized.
- Approved defaults: keep single-user/local-only behavior; use host/origin/metadata checks while preserving documented CLI usage; release checked phases separately; preview legacy data/file cleanup and request specific approval for it.

- 2026-10-10: user explicitly approved the phase-01 merge/push and instructed work through completion of every phase-02 step in this session. This supersedes the original session-sizing stop guidance; merge proposals remain the approved end of each phase.

## Phase 01 result

Completed both security steps on branch `codex/kinship-review-fixes-security`, commits `77ba7dd` and `5d4e71a`, proposed version 0.1.1. All quick/privacy/stack/upgrade checks passed; previous-version data and photo bytes were preserved. Merged and pushed to GitHub main at `5d4e71a` after explicit approval; no image was published or deployed. Evidence is in `/home/nicho/Agents/artifacts/kinship-request-security/`. Phase 02 is detailed in four steps: task hierarchy, calendar overlap, contact recency/migration, and full validation.

## Phase 02 preparation

Detailed on 2026-10-10 from the current source and approved scope. Task hierarchy writes/imports will share transaction coordination; existing cycles will only be inventoried. Calendar tests will distinguish all-day and timed boundaries. Recency repair will use an in-place migration with deliberately stale previous-version fixtures.  The user explicitly approved phase-01 merge/push and execution through completion of all phase-02 steps. Phase 01 is now on GitHub main. Phase-02 implementation is committed on `codex/kinship-review-fixes-correctness` through `d126b36`, with all acceptance parts passed; no real-data operations have run.

## Phase 02 result

All four steps are complete on `codex/kinship-review-fixes-correctness` at `d126b36`, proposed version 0.1.2. Task-cycle prevention is coordinated under concurrency; cyclic archives are rejected before replacement; the owner-scoped inventory is read-only. Calendar spans render in interior months/days on desktop and phone. Recency is recomputed transactionally and historical cached values repaired with an in-place migration preserving source records.

Acceptance passed: 225 unit tests, 75 database tests, 184 API/browser checks, CLI/import/diagnostic checks, format/lint/types/audit/secrets/privacy, image health and strict logs. Upgrades from v0.1.0 and merged 0.1.1 commit `5d4e71a` preserved 19 table counts, source fingerprints and photo bytes, corrected eight fixture values and verified repeat migration no-op. Final branch synchronization changed no files. Test resources are removed. Evidence and exact check/commit boundaries: `/home/nicho/Agents/artifacts/kinship-data-correctness/results.md`.

The 0.1.2 merge/push is proposed separately for approval under code.md 7. No image publication, deployment, real-data repair or legacy file deletion occurred. Phase 03 has four detailed steps; referenced photo export, restore reuse and safe cleanup/inventory are complete; full phase validation is complete; see Phase 03 result.

## Phase 03 preparation

Detailed on 2026-10-10 within the approved photo scope. Four steps cover shared cross-process file/reference coordination and referenced export; byte-verified, idempotent restore with partial-stage rollback; pending-upload protection, candidate-only cleanup and a read-only legacy inventory; then full browser/API and upgrade acceptance. Preserve UUID URLs, owner confinement, archive/API contracts and existing limits. No schema expansion is planned; a tracking table or client contract change needs an updated overview and approval first. Phase-02 merge remains separately pending. No source code, stacks, real data or upload files were changed while detailing this phase.

## Phase 03 step 01 result

Referenced exports and shared coordination are complete on `codex/kinship-review-fixes-avatars` at local commit `382a1ae`, based on phase-02 `d126b36`. Only the exact snapshot's owned live/trashed Contact photo references are exported, deduplicated and checked; orphan files and external photos are excluded. Invalid/missing photos fail explicitly without changing source. Contact saves and uploads now coordinate through the shared PostgreSQL lock; immutable file helpers reject unsafe paths/symlinks and preserve the packaged CLI's physical upload root.

Final focused acceptance passed: format/lint/types, 234 unit tests, dependency audit, privacy scans, image build/health/logs, 86 database tests and 184 API/browser checks. Actual packaged CLI export/import preserved shared live/trashed photo bytes; exported photo count stayed at one while the superseded original remained on disk. Post-commit scans passed. Evidence: `/home/nicho/Agents/artifacts/kinship-avatar-lifecycle/`. Test resources are removed; no code was pushed or merged, no image was published/deployed, and no legacy files were deleted. Idempotent restore is next; version/changelog preparation and full upgrade acceptance remain at phase close.

## Open questions
- (none)

Existing-cycle repair and legacy orphan deletion become concrete decisions only if the read-only inventory finds affected records/files. Exact concurrency and pending-upload mechanics are phase design work, constrained by the acceptance criteria above.

## Phase 03 step 02 result

Idempotent restore is complete on `codex/kinship-review-fixes-avatars` at local commit `27d6dcc`. All archive payloads are validated, but only referenced live/trashed photos are retained. Byte-verified owner-local reuse preserves matching original URLs, handles filename collisions and identical payload aliases, and coordinates through replacement commit. Attempt-owned file tracking and reference-checked rollback preserve reused/concurrently referenced files. Superseded old references receive private candidate markers for step 03; no file collection runs. Archive/schema/public shapes are unchanged; the resolved referenced-upload count is documented.

Final focused checks passed: quick/privacy, 234 unit tests, 95 database tests, 184 browser/API checks, image health/strict logs, and three actual packaged CLI photo restores retaining 2 contacts (1 trashed), 1 shared image and its exact hash/URL. Evidence is in `/home/nicho/Agents/artifacts/kinship-avatar-lifecycle/`. Task test resources are removed. No source was pushed/merged or image published/deployed; no real data or legacy files were changed. Cleanup/pending protection and the read-only orphan inventory are next. Full upgrade/version acceptance stays at phase close.

## Phase 03 step 03 result

Safe new-operation collection and the read-only inventory are complete on `codex/kinship-review-fixes-avatars` at local commit `f47dea1`. Seven-day pending upload journals protect open saves; assignment and cancellation of old candidates on reuse are persisted before commit. Removed references receive one day of grace, while pending/live/trashed/shared references remain protected. Collection and failed-restore deletion hold a dedicated database session lock until file work ends. Failed journals/deletions conservatively retain bytes without misreporting committed row changes. Unknown legacy orphans never enter automatic collection.

The packaged `photos:check` inventory reports an owner-scoped nonmutating snapshot of bytes, age, references, pending/assignment/candidate state, eligibility and unsafe/missing entries. Disposable fixtures prove exact totals and unchanged file/row fingerprints. Final source/privacy/stack checks passed: 234 unit tests, 115 database tests (20 lifecycle cases), 186 API/browser checks, CLI before/after export equality, image health and strict logs. Evidence: `/home/nicho/Agents/artifacts/kinship-avatar-lifecycle/step-03-results.md` and acceptance logs. No source was pushed/merged, no image published/deployed, and no real data or legacy orphan cleanup occurred. Test resources are removed. Full version/changelog/upgrade acceptance remains step 04; version remains the phase-02 0.1.2 baseline.

## Phases
<!-- One line per phase: NN · name · status (todo | in-progress | done) · one-line goal -->
- 01 · Request security · done · Reject forged browser writes and hostile hosts; preserve browser/CLI/health flows with regression tests and full checks.
- 02 · Data correctness · done · Prevent task cycles, include overlapping calendar spans, and correct recency on edits and upgrades.
- 03 · Avatar lifecycle · done · Referenced export, reusable restore, pending protection, candidate cleanup and inventory passed full acceptance and three upgrade baselines.
- 04 · Unused code and final acceptance · done · Unused exports/dependency removed; all six findings verified; final 0.1.4 patch/spec merged and pushed after approval.

## Phase 03 result

All four avatar steps are complete on `codex/kinship-review-fixes-avatars` at local acceptance commit `8d2a656`, proposed compatible patch 0.1.3. The branch includes the pending phase-02 correctness code. Main remains `5d4e71a`; no source was pushed/merged or image published/deployed.

Full quick/privacy/stack/upgrade passed: 234 unit tests, 115 database tests, 186 API/browser checks, zero audit vulnerabilities, image health and strict logs. Upgrades from tagged v0.1.0 (`dffd8da`), merged 0.1.1 source (`5d4e71a`) and completed phase-02 (`d126b36`) retained all 19 table counts, exact source fingerprints and photo bytes/UUID URLs; eight recency values were checked and repeat migration was a no-op. Shared live/trashed references and one legacy orphan remained on disk; repeated HTTP export/restore and packaged CLI restore held at two physical photos and one exported referenced image. Inventory remained read-only. Final synchronization changed no files, final quick/privacy and post-commit privacy passed, source is clean and disposable resources are removed.

Evidence and exact commit/check boundaries: `/home/nicho/Agents/artifacts/kinship-avatar-lifecycle/step-04-results.md`. Proposed merge is this branch including phases 02 and 03 at version 0.1.3, subject to separate code.md 7 approval. No real-data or legacy cleanup occurred. Phase 04 remains unstarted and is next to detail.

## Phases 02 and 03 source merge

2026-10-10: user explicitly approved “merge both.” Re-fetched main and tags; main remained `5d4e71a`, synchronization changed no files. Fast-forwarded main through both phase-02 `d126b36` and phase-03 acceptance `8d2a656`, then pushed main. GitHub main verified at `8d2a6562ae8ffcb722873a2ddf63ee8a15897653`; working tree clean. Source version is 0.1.3. Previous merge-pending statements above are historical and resolved. No tags/images were published and nothing was deployed. Phase 04 remains next and unstarted.

## Phase 04 preparation

Detailed on 2026-10-10 in two steps within the approved scope: confirm/remove unused code and the direct dependency with focused checks, then verify all six findings, run full acceptance including the merged 0.1.3 upgrade baseline, and prepare the final patch/spec for separate merge approval. Tentative version is 0.1.4, subject to current main/tags. No source, stacks or real data were changed while detailing. Final plan completion follows the approved final merge and record reconciliation.

## Phase 04 step 01 result

Unused Separator and attributesPayload exports and the direct separator dependency are removed at local commit 8d78045 on codex/kinship-review-fixes-cleanup, based on merged main 8d2a656. No other locked package changed. Quick/privacy checks passed, including 234 unit tests and zero audit vulnerabilities; post-commit privacy passed. Evidence: /home/nicho/Agents/artifacts/kinship-final-acceptance/. Source version remains 0.1.3. Final full acceptance, previous-version upgrade, version/changelog and spec preparation remain step 02. Nothing was pushed, merged, published or deployed; no real data or legacy files changed.

## Phase 04 final result

Both steps are complete on `codex/kinship-review-fixes-cleanup`, based on merged `0.1.3` source at `8d2a656`. Compatible patch `0.1.4` removes only the unused Separator, its direct separator dependency and attributesPayload helper; version manifests, image metadata, compose and changelog agree. No unrelated dependency versions changed. The final master specification is copied to `docs/specs/kinship-review-fixes.md`.

Full `scripts/check.sh` passed: format/lint/types, 234 unit tests, zero audit vulnerabilities, secret/privacy scans, image build/health/strict logs, 115 database tests, 186 API/browser checks and packaged CLI jobs. Upgrade acceptance passed from tagged `v0.1.0` and merged source `0.1.3` (`8d2a656`): all 19 table counts, source fingerprints and photo bytes/UUID URLs were preserved; eight exact recency values checked; repeat migration was a no-op. Three HTTP restores plus packaged CLI restore retained two physical photos (one shared live/trashed reference and one legacy orphan) while exporting only the referenced photo. Inventory was read-only; all 11 upgraded desktop pages passed on each baseline. Earlier 0.1.1 and phase-02 upgrade evidence remains in the phase-03 record; no new migration or runtime behavior change required repeating it.

All six findings have an evidence map in `/home/nicho/Agents/artifacts/kinship-final-acceptance/six-findings.md`; passing logs, corrected failed attempts and exact commit/check boundaries are recorded alongside it in `results.md`. Disposable task stacks/images/data are removed. Existing user data was not modified or inventoried. Legacy hierarchy repair and legacy orphan deletion remain separately authorized actions requiring a concrete preview and verified full backup.

The user approved the final source merge/push on 2026-10-10. Re-fetching main/tags and synchronizing changed no files. Main fast-forwarded from `8d2a656` through `8d78045` to checked acceptance commit `a062dc8`; push succeeded and GitHub main was verified at `a062dc86d607c70d921bda293c633ce303e3150e`. The final documentation reconciliation is recorded in the acceptance evidence. All four phases are complete; merge-pending statements in earlier results are historical and resolved. No tag/image was published and nothing was deployed. The plan is complete.
