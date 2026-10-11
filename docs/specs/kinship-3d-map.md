---
title: Kinship 3D Visual Map
summary: 3D spatial visual map connecting persons, projects, notes, tasks, and tags with a celestial nexus aesthetic
created: 2026-10-10
next: done
overview_url: overview.html
started: 2026-10-10
---
# Kinship 3D Visual Map

## Goal
Build a full-screen interactive 3D visual knowledge map for Kinship that connects contacts (persons), projects, notes/entries, tasks, and tags/topics in a celestial graph layout with the user-approved "Cosmic Nexus" aesthetics, clean single-layer orbs, subtle aura glow, and interactive neighborhood highlighting.

## Scope
In:
- Dedicated full-screen `/map` route in Kinship with navigation link in the main navigation sidebar.
- Read-only graph data API (`GET /api/graph`) aggregating the configured owner's contacts, projects, entries, tasks, tags, and existing relationships. Include tag joins, project membership, and task hierarchy as well as `EntityEdge`, `Mention`, `EntityRef`, and `TaskAssignee`.
- Three.js WebGL canvas client component (`next/dynamic` with `ssr: false`) implementing the locked-in visual design:
  - Deep space starfield backdrop (`#080a0e`) with round circular starlight discs and additive starlight blending.
  - Compact single-layer jewel orbs (`0.8x` size default) colored by entity type: Contacts (`#3b82f6`), Projects (`#8b5cf6`), Notes (`#ec4899`), Tasks (`#f59e0b`), Tags (`#10b981`).
  - Delicate hairline connection conduits (`0.10` thickness default) without moving particle flow.
  - Calibrated radial aura glow (`4.33x` sprite scale relative to the base orb radius, 2/3 of the earlier prototype) with additive blending and soft surface emissive radiance (`0.45` ambient, `0.70` active). Match the prototype's actual sprite dimensions.
  - Generous invisible hit-testing trigger proxy (`2.8x` radius) covering orb and label for effortless hover/click interactions.
  - Interactive neighborhood highlighting: hover illuminates immediate 1st-degree connections and dims unrelated nodes; click locks focus, centers camera orbit, activates breathing beacon halo, and opens the slide-out inspector drawer.
- Glassmorphic UI overlay (HUD entity legend, auto-orbit toggle, camera reset, live parameter sliders).
- Slide-out Inspector Drawer with entity summary, connected relation chips (with click-to-traverse), and direct dossier links.
- Embedded mini-map widget for contact dossiers (`/contacts/[id]`, `/m/contacts/[id]`) and project pages (`/projects/[id]`, `/m/projects/[id]`) displaying that entity's immediate 1st and 2nd degree neighborhood.
- Unit, API, and visual component integration tests.
- Responsive mouse and touch interaction, keyboard-accessible controls and relationship navigation, reduced-motion behavior, and clear loading, empty, failed-request, and WebGL-unavailable states.

Out:
- In-canvas edge or entity creation/mutation (relationships remain authored via markdown wikilinks, task assignments, and dossier forms).
- Schema alterations or database migrations (the graph is computed from existing tables and relations).
- WebXR / VR / AR headset support (optimized strictly for desktop and mobile web browsers with mouse and touch gestures).
- Changing Kinship's identity system, exposing it beyond its existing host access, or changing another app or stack.

## Architecture
- **Existing app conventions**: Kinship uses root-level `app/`, `components/`, and `lib/`, not `src/`. Its current identity is the single configured `KINSHIP_OWNER`, resolved through `requireIdentity`; headers and query parameters cannot choose an owner. Keep the existing proxy, request policy, route error wrapper, and owner-scoped service boundaries.
- **API Layer**:
  - `app/api/graph/route.ts`: Dynamic, uncached read-only route returning JSON `{ nodes: GraphNode[], links: GraphLink[] }` through `lib/api.ts`'s handler.
  - `lib/services/graph.ts`: Owner-scoped batched Prisma queries, a consistent read snapshot, small metadata projections, and normalization through pure helpers in `lib/graph/`.
  - `docs/api/graph.openapi.json`: Server API contract for this endpoint; generate its browser-safe TypeScript types instead of maintaining a second handwritten client contract. Pin the generator in the lockfile and check that generated output is current.
  - Optional query parameters `?focusId=contact:<database-id>&depth=2`. Graph IDs always include their entity type. Depth defaults to 2 with a focus and accepts only 1 or 2. Missing, deleted, draft, or other-owner focus returns the same 404; malformed input returns 400. Depth without focus is rejected.
- **Client Component Layer**:
  - `components/graph/graph-canvas.tsx`: Three.js scene, camera, OrbitControls, orb meshes, glow sprites, static conduits, and raycasting. A client wrapper dynamically loads the canvas with SSR disabled.
  - `components/graph/graph-overlay.tsx`: Glass overlay with entity legend, auto-orbit toggle, camera reset, and live sliders using the approved defaults. Settings are session-local in the first version.
  - `components/graph/graph-inspector.tsx`: Selected entity summary, accessible connected-record buttons, and a record link where a record page exists. Tags show connected records; no tag dossier route is invented.
  - `components/graph/mini-graph.tsx`: Shared renderer in a compact mode, fetching an entity's two-hop neighborhood. It links to the full map with that entity focused.
  - `/map`: Responsive full-screen route with a desktop navigation link and access from the mobile shell. Contacts and projects receive the local mini-map in their existing detail views.
- **Layout Simulation**:
  - `lib/graph/layout3d.ts`: Pure, DOM-free 3D force layout with sorted inputs, a fixed seed, finite bounded iterations, collision spacing, and normalized camera bounds. Return new nodes without mutating API data; handle empty, singleton, isolated, and disconnected graphs.
  - Execute layout in a browser worker when the renderer is built, leaving database reads free of simulation work. Cancel stale work after navigation or graph changes; stop simulation timers and dispose renderer resources on unmount.
  - Use instanced/shared geometry and distance-based label culling where needed. Validate with a reproducible 1,000-node / 3,000-link fixture and report timings; the first version has no silent data truncation. Larger-data limits require an explicit later decision if measurements show they are needed.

## Data model and API outline
### API Response: `GET /api/graph`
```typescript
interface GraphNode {
  id: string; // '<type>:<database-id>', used for graph selection and focusId
  entityId: string; // underlying database id
  type: 'contact' | 'project' | 'entry' | 'task' | 'tag';
  name: string;
  subtitle?: string;
  description?: string;
  color: string;
  url: string | null; // tags have no dossier page
}

interface GraphLink {
  id: string; // stable identity from directed endpoints and relation
  source: string;
  target: string;
  relation: string;
  origins: string[]; // source table(s), retained when identical links are collapsed
}

interface GraphDataResponse {
  nodes: GraphNode[];
  links: GraphLink[];
}
```

This outline documents the generated API contract; it is not a separately maintained client interface. Coordinates are produced by the client layout (its own output type), not persisted, calculated or typed in the API.

### Visibility, links, and focus
- Root queries filter `owner`; contacts, projects, entries, and tasks filter `deletedAt: null`; contacts, projects, and tasks also filter `isDraft: false`. Completed and archived task/project statuses remain visible because they are existing records, not trash. Tags have no soft-delete or draft field.
- Every relationship is retained only when both endpoints are in the visible node set. Join tables are scoped through both related records; `EntityEdge` also filters its own owner. Drop unsupported polymorphic types and dangling endpoints.
- Return isolated visible records too. Node names use `Contact.displayName`, `Project.name`, `Task.title`, `Tag.name`, and `Entry.title` with a kind-aware untitled fallback; entry summaries use a short excerpt of `bodyText`, never the full `bodyJson`.
- Contacts link to `/contacts/<slug>`, projects to `/projects/<slug>`, entries to `/notes/<id>`, and tasks to `/board?task=<id>`. URL-encode values. Tag nodes have a null URL and remain traversable through the inspector.
- Include `EntityEdge` with its original direction and relation; `Mention` entry-to-contact; `EntityRef` entry-to-task or project according to `targetType`; `TaskAssignee` task-to-contact; contact/entry/task tag joins; entry/task project membership; and parent-task-to-subtask links.
- Collapse only duplicate directed endpoint/relation tuples, preserving their sorted origins. Distinct relations and reverse-direction relations remain separate. Stable node/link sorting makes responses and layout reproducible.
- Focus uses breadth-first traversal of links in either direction, including the focus and nodes up to the requested depth, then keeps all links between retained nodes. Traversal does not change stored direction or relation labels.

Entity Type Color Mapping:
- **Contact**: `#3b82f6` (Blue)
- **Project**: `#8b5cf6` (Purple)
- **Entry / Note**: `#ec4899` (Pink)
- **Task**: `#f59e0b` (Amber)
- **Tag / Topic**: `#10b981` (Emerald)

## Repos and stacks touched
- `/srv/src/kinship` (Next.js 16, React 19, Tailwind CSS v4, Prisma 7), on `codex/kinship-3d-map` or a later agent's own branch.
- Dev test stack `test-kinship`, only through Kinship's existing test scripts, using synthetic fixtures. Check handoff and existing stack ownership before starting it.
- Plan files and existing design artifacts under `/home/nicho/Agents/`. Production, host settings, and other apps are outside this plan.

## Dependencies
- Phase 01: `d3-force-3d` and compatible typings for the DOM-free layout, plus an OpenAPI TypeScript generator for the graph contract.
- Phase 02: `three` and matching `@types/three` for the renderer.
- Choose compatible versions from npm when each dependency is introduced, audit them, and commit the resulting lockfile. Do not copy the prototype's vendored scripts into the app or load runtime dependencies from a CDN.
- Keep the existing Next.js/React/Prisma stack and pinned Node runner; no framework upgrade is included.

## Release and rollback
- **Phase checkpoints**: Each phase ends with a working, mergeable state. Run the repo's full `scripts/check.sh` before proposing a phase merge: format/lint/types/unit/audit, secret and personal-data checks, image/health/log checks, database and Playwright API/browser suites, and upgrade preservation. Smaller intermediate steps use quick checks plus their targeted tests.
- **Release**: Propose the next available minor version from main when ready, update the repo's version files and changelog, and request the user's merge approval after checks. Publish any approved release using the normal repo/GHCR rules. No merge, image publication, or production deployment is authorized by planning alone.
- **Rollback**: Revert the feature commits and dependencies, or restore the previous image. Hiding the sidebar link alone is not a complete rollback because the map route and mini-maps would remain. There are no schema migrations or persistent layout records to undo.

## Risks
- **Large Graph Performance**: When graphs grow beyond 1,000 nodes, rendering many individual sphere geometries could impact frame rates. Mitigated by using Three.js `InstancedMesh` for nodes, sharing glow sprite materials, and distance-based label culling.
- **SSR / Next.js Hydration**: WebGL requires window/DOM access. Mitigated by wrapping canvas imports with `next/dynamic` (`ssr: false`).
- **Ownership and stale relationships**: Missing owner filters or dangling polymorphic links could expose unrelated data. Test two synthetic owners and intentionally invalid joins; require both visible endpoints before emitting a link.
- **Browser capability and motion**: Provide an accessible record list/inspector when WebGL is unavailable, reduce animation for reduced-motion users, and check touch controls and small screens. Auto-orbit is off initially and requires an explicit toggle.
- **Concurrent Host Work**: At the 2026-10-10 planning check, handoff had no other Kinship task and `/srv/src/kinship` was clean on main. Recheck at implementation start; this observation does not reserve a stack or override a later agent's handoff.

## Decisions
- **2026-10-10**: User selected the Hybrid "Cosmic Nexus" visual direction (Option 1 mindmap + Option 3 celestial starfield).
- **2026-10-10**: Clean single-layer jewel orbs without planetary rings or multi-layer wireframe coronas.
- **2026-10-10**: Node scale locked to `0.8x`, link width to `0.10`.
- **2026-10-10**: Energy flow particle animation removed in favor of serene static conduits.
- **2026-10-10**: Circular starlight discs with additive starlight blending.
- **2026-10-10**: Glow effect calibrated to 2/3 size (`4.33x` radius aura sprite, `0.45` emissive radiance, `1.0x` baseline slider).
- **2026-10-10**: Interactive neighborhood highlighting on hover (preview direct connections) and click (focus lock + pulse beacon halo + inspector drawer).
- **2026-10-10**: Hit proxy expanded to `2.8x` for effortless cursor targeting.
- **2026-10-11**: User approved the merge of phases 01-02: merged to Kinship main (`413f4ea`), tagged `v0.2.0`, image `ghcr.io/noprofessional582/kinship:0.2.0` published. Phase 03 branches fresh from main.
- **2026-10-11**: After the phase 02 screenshot review, graphs of up to 150 records show every record's name at any distance, as the prototype did; bigger graphs hide names further than 90 units from the camera so 1,000 records stay fast.
- **2026-10-11**: User approved growing records as the prototype does: a hovered record 1.2x and a selected one 1.35x its node size. Built in phase 03 step 03.
- **2026-10-11**: After the phase 03 screenshots, the user approved the merge of phase 03: merged to Kinship main (`45e56f1`), tagged `v0.3.0`, image `ghcr.io/noprofessional582/kinship:0.3.0` published. Phase 04 branches fresh from main.
- **2026-10-11**: User approved mini-maps on the phone contact and project pages (`/m/contacts/[id]`, `/m/projects/[id]`) as well as the desktop ones. Built in phase 04 step 02.

- **2026-10-11**: Speed check closed: the user tried `/map` in their own browser on a 1,016-record, 3,000-link synthetic graph and found it smooth. No lighter mode and no size limit; the dev VM's slowness is its software WebGL only.
- **2026-10-11**: User asked for an "Attraction" slider (how close connected records sit; re-runs the layout) and a light map for Kinship's light theme: the palette's paper background with dark stars (the dark map inverted); the current dark map stays with the dark theme. Phase 04 step 04.
- **2026-10-11**: User approved the light and dark map colours and theming from screenshots. After trying the slider: Attraction's low end should spread records much further (0.5x left a large central group), so the minimum is now 0.2x with the push reaching further below 1x; and the mouse wheel zooms towards the pointer, not the middle of the view. Phase 04 step 04.
- **2026-10-11**: User approved the slider range and zoom ("Better, commit, merge, etc"): phase 04 to be released as 0.4.0 after the full checks.

### Implementation recommendations awaiting plan approval
- Keep the current configured-owner identity and all existing data tables.
- Use typed graph IDs, read-only batched queries, generated API types, and deterministic browser-worker layout.
- Keep all non-draft, non-trashed records, including completed/archived statuses; retain isolated nodes.
- Use accessible record navigation, touch controls, reduced motion, and a WebGL fallback; keep auto-orbit off by default.
- Phase 01 has two self-contained steps. Later phases are detailed only when they are ready to start.

## Open questions
- Plan approved by the user 2026-10-10; started with `plan-start`.

## Phases
<!-- One line per phase: NN · name · status (todo | in-progress | done) · one-line goal -->
- 01 · data-and-layout · done · Build graph data API and 3D positioning layout engine
- 02 · webgl-renderer · done · Implement Three.js canvas component with approved Cosmic Nexus aesthetics, worker layout, and a bare `/map` page (no nav link) with its states
- 03 · interactive-ui · done · Add neighborhood highlighting, controls overlay, and inspector drawer
- 04 · integration-and-testing · done · Add the map to navigation (desktop, palette, phone `/m/map`), `?focus=` deep links, contact/project mini-maps, the speed decision, an attraction slider and light map theme, and the test suite
