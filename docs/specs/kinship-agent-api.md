---
title: Kinship agent API
summary: A documented API and an MCP connection so an AI agent can read and update Kinship
created: 2026-10-15
next: done
overview_url: overview.html
started: 2026-10-15
---
# Kinship agent API

## Goal
Let an AI agent running on the same computer as Kinship (Claude Code, Codex, Claude
Desktop, or any MCP client) find people, read their history, log notes and calls, and
manage tasks and projects, safely and without guessing:
1. A complete, machine-readable description of Kinship's API (OpenAPI 3.1), kept true by tests.
2. Agent-friendly writing: notes as plain text with mentions, not editor JSON.
3. An MCP connection built into Kinship, so an agent can be pointed at one URL and get a
   ready set of tools.
4. A short guide: how to connect each agent, what it can and can't do.

## Scope
In:
- OpenAPI 3.1 spec for every route under `app/api/` (28 route files, 47 methods), with
  request bodies and query parameters generated from the existing zod schemas in
  `lib/validation/index.ts` and response shapes defined once as zod schemas.
- Spec served at `GET /api/openapi.json`; committed copy in `docs/api/kinship.openapi.json`.
- Contract tests: every route is in the spec, and real answers from a running stack match it.
- Plain-text note bodies: entries accept `body` (with a mention syntax for people,
  tasks and projects) as an alternative to TipTap `bodyJson`, and every entry answer
  includes a `body` rendering. The existing `bodyText` (search text) is unchanged.
- `POST|GET /api/mcp`: an MCP server (Streamable HTTP, stateless, JSON answers) inside the
  Next.js app, with tools for search, contacts, entries, tasks, projects, calendar,
  cadence (who is due) and the graph.
- Agent access switch: a new `agentAccess` setting (`write` default | `read`), changed both
  ways from Settings in the app (desktop and phone) and through `PATCH /api/settings`;
  read-only hides and refuses every write tool. Optional `KINSHIP_AGENT_ACCESS=off` in
  `.env` turns the MCP endpoint off entirely (env only, so an agent can't switch it back on).
  The MCP connection cannot change `agentAccess` itself: no settings tool.
- Agent guide `docs/api/agents.md` with setup for Claude Code, Claude Desktop, Codex
  (CLI and app), Hermes Agent (with an OpenAI model) and a general MCP section;
  README section; CHANGELOG; release 0.5.0.

Out:
- Any sign-in, API keys, or network exposure. Kinship stays on 127.0.0.1; the agent must
  run on the same computer (or reach it through its own SSH tunnel, the user's call).
- MCP tools for permanent or bulk-destructive actions: archive import, trash purge and
  empty, photo upload. (They stay reachable through the REST API, as today.)
- AI features inside Kinship itself (summaries, suggestions). Kinship calls no AI.
- Database changes beyond the one added settings column.
- The Gemini app (gemini.google.com): its custom apps connect only to MCP servers on the
  public internet over HTTPS with OAuth, and Kinship answers only on 127.0.0.1 with no
  sign-in. Reaching it would need sign-in and public exposure: a separate plan if wanted.
- The work in the backlog plan kinship-core-workflows.

## Architecture
- Kinship is Next.js 16 (App Router) + Prisma 7 + zod 4, not the standard FastAPI stack;
  this plan adds to it in its own style (approved when Kinship was built standalone).
- **Spec**: `scripts/api-spec.ts` builds the spec from a route table
  (`lib/openapi/routes.ts`: path, method, summary, query/body/response zod schemas) using
  zod 4's `z.toJSONSchema` (input mode; dates as `string`/`date-time`). The existing
  `docs/api/graph.openapi.json` stays the source for `/api/graph` and is merged in, so
  `lib/graph/api.generated.ts` keeps working. `npm run api:spec` writes the file;
  `scripts/check.sh` regenerates and diffs it, like the graph types today.
- **Response schemas**: `lib/openapi/responses.ts`, zod schemas describing what each
  service returns. Not used to filter answers at run time; the contract tests check real
  answers against them.
- **Plain text**: `lib/tiptap/from-text.ts` turns text into a TipTap doc. Mentions are
  written `@[Jane Doe](contact:<id>)`, `[[Ship v2]](task:<id>)`, `[[Launch]](project:<id>)`;
  an id of `new` creates the record, as inline tagging does in the editor (through the
  existing `pendingEntities` path). Paragraphs from blank lines; bullet lines become lists.
  Answers add `body` from a new renderer beside `docToText`, in the same mention syntax
  with real ids. `docToText` and the stored `bodyText` (search, empty-note checks) stay.
- **MCP**: route `app/api/mcp/route.ts` using `@modelcontextprotocol/sdk`'s web-standard
  Streamable HTTP transport in stateless JSON mode. Each tool calls the same
  `lib/services/*` functions and zod schemas the REST routes use, so behaviour and
  validation are identical. The existing request gate (`proxy.ts`, host check, JSON type)
  applies, with one narrow exception (decision 2026-10-16): on `/api/mcp` only,
  `Sec-Fetch-Mode: cors` alone, which Node's fetch always sends, is not taken for a browser.
- Tool results are JSON text, trimmed to what an agent needs (ids, names, dates, text),
  with ids so the agent can follow up. Text from notes is marked as stored user content in
  tool descriptions, so agents treat it as data, not instructions.

## Data model and API outline
- One migration: `Settings.agentAccess` text column, default `'write'`. Additive; 0.4.0
  ignores it, so rollback stays safe.
- New: `GET /api/openapi.json`; `POST /api/mcp` (and `GET`/`DELETE` answering 405 as the
  stateless transport expects).
- Changed: `POST /api/entries` and `PATCH /api/entries/:id` accept `body` (at most
  one of `body` / `bodyJson`); entry answers gain `body`.
- MCP tools (write access unless marked read):
  - read: `search`, `get_contact`, `list_contacts`, `get_entries`, `get_task`,
    `list_tasks`, `get_project`, `list_projects`, `get_calendar`, `who_is_due`,
    `get_neighbourhood` (graph around one record), `list_board_columns`
  - write: `log_entry`, `update_entry`, `create_contact`, `update_contact`,
    `create_task`, `update_task`, `move_task`, `create_project`, `update_project`,
    `link_records` / `unlink_records` (edges), `trash_record` (soft delete, restorable)

## Repos and stacks touched
- Repo `/srv/src/kinship` (public, github.com/NoProfessional582/kinship), branch
  `claude/kinship-agent-api`.
- Test stack from `scripts/test-stack.sh` only. No platform or production stack.
- Image `ghcr.io/noprofessional582/kinship:0.5.0`.

## Dependencies
- `@modelcontextprotocol/sdk` (npm, exact version at least two weeks old, lockfile).
- `ajv` + `ajv-formats` (npm, dev only) for contract tests against the spec.

## Release and rollback
- One minor release, 0.5.0, after phase 04: CHANGELOG, git tag, image to GHCR.
- The only migration adds one defaulted column that 0.4.0 ignores, so rollback is running
  0.4.0 again; the upgrade test (code.md 25) covers the migration.
- `body` is additive; existing clients are unaffected.

## Risks
- **An agent with write access acts on bad instructions** (e.g. text inside a stored email
  that tells it to delete things). Mitigations: no permanent deletes over MCP, everything
  trashed is restorable, a read-only switch in Settings, tool descriptions
  mark stored text as data.
- **No sign-in means any local program can use the MCP endpoint** — the same as the REST
  API today; nothing new is exposed. The guide repeats the 127.0.0.1-only warning.
- zod → JSON Schema gaps (coerced dates, transforms, refinements): handled with overrides
  in the generator; contract tests catch drift.
- MCP SDK version churn: pinned exact; the endpoint is thin over services.

## Decisions
<!-- The user's decisions, dated. -->
- 2026-10-15: Agents connect through an MCP endpoint built into Kinship (`/api/mcp`).
- 2026-10-15: Agents may read and write (no permanent deletes); the user can switch to
  read only and back. Implemented as a setting in the app, not only an env var.
- 2026-10-15: Guide covers Claude (Code and Desktop), Codex, Gemini (the Gemini app, not
  Antigravity, if possible) and Hermes Agent with OpenAI. The Gemini app proved not
  possible without public exposure; see Scope Out.
- 2026-10-15: Gemini app left out of this plan; the guide explains why. No remote-access
  plan for now.
- 2026-10-15: A body that isn't valid JSON answers 400, not 500: fixed in phase 01 step 02
  (`readJson()` in `lib/api.ts`, unit and contract tests, documented in the spec).
- 2026-10-16: Node-based MCP clients (Claude Code, the MCP SDK) send `Sec-Fetch-Mode: cors`,
  which the gate refused as a browser with no origin. Exempt that one header alone, on
  `/api/mcp` only; every other gate check stays (phase 03 step 02).
- 2026-10-16: Installing Hermes Agent on this host for testing is approved, including its
  official installer script (system.md 5). Install it as nicho, record it in
  host-changes.md, and try it in phase 04 step 01. No API key: after the install the user
  signs in to OpenAI through Hermes themselves (an interactive login they run with `!`).
- 2026-10-16: The plain-text field is named `body`, not `bodyText`: entries already
  answer with `bodyText` (flat search text, no ids) and the app relies on it.

## Open questions
- None.

## Phases
- 01 · api-reference · done, merged to main 2026-10-16 (927cce4) · Full OpenAPI spec for every route, served at /api/openapi.json, kept true by contract tests; agent-facing API guide
- 02 · plain-text-notes · done, merged to main 2026-10-16 (a54fa9d) · Entries accept and return plain text with mention syntax
- 03 · mcp-endpoint · done, merged to main 2026-10-16 (2afa3c3) · /api/mcp with read and write tools, the read-only switch in Settings, tests driving it like a real MCP client
- 04 · guide-and-release · done, released as 0.5.0 · Connection guide for Claude Code, Claude Desktop, Codex and Hermes (Claude Code, Codex CLI and Hermes tried for real); README, CHANGELOG, release 0.5.0
