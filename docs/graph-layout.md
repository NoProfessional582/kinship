# Graph layout

`lib/graph/layout3d.ts` places the map's records in 3D. `GET /api/graph` sends records and
links without positions (docs/api/graph.openapi.json); the browser works out where each one
goes. Nothing about positions is stored or calculated on the server.

## What it does

`compute3DLayout(nodes, links, options?)` runs a force simulation (d3-force-3d 3.0.6):

- linked records pull together, to about `linkDistance` apart;
- every record pushes the others away, up to `chargeRange` away;
- orbs keep a gap of about `spacing` between their surfaces, for their glow;
- a weak pull towards the centre (`gravity`) keeps lone records and separate clusters in view.

It is pure: no DOM, WebGL, database, file or server import (a unit test checks the imports),
so it can run in a browser worker. It runs a fixed number of steps by hand, stops the
library's timer before the first one, and leaves nothing scheduled when it returns.

The same graph and options always give the same positions:

- nodes and links are sorted by id first, so their order makes no difference;
- starting places and the library's random numbers come from `seed`;
- several links between the same two records, in either direction, make one spring, and a
  record linked to itself gets none.

The result is centred on the origin. If it comes out wider than `maxRadius`, it is shrunk to
fit (`scale` below 1), never stretched, so a small graph stays small and the camera frames it
with `bounds`.

It refuses, with a `LayoutInputError`: a link whose end is not among the nodes, two nodes
with the same id, and any option outside the ranges below. The API never sends such a graph;
the refusal stops a caller's mistake turning into a silently wrong map.

## Settings

| Option         | Default | Allowed                     |
| -------------- | ------- | --------------------------- |
| `iterations`   | 200     | whole number, 1 to 1000     |
| `seed`         | 1       | whole number, 0 to 2^32 - 1 |
| `linkDistance` | 18      | above 0                     |
| `charge`       | -30     | 0 or below                  |
| `chargeRange`  | 50      | above 0, finite             |
| `spacing`      | 3       | 0 or above                  |
| `gravity`      | 0.05    | 0 to 1                      |
| `maxRadius`    | 120     | above 3.2 (two large orbs)  |

Fixed in the code: Barnes-Hut accuracy (theta) 1.5, and collision only in the last 30% of
the steps. Orb radii follow the approved mockup: 1.6 for contacts and projects, 1.25 for
entries, tasks and tags (`NODE_RADIUS`). Every value is a number, so the options can be
posted to a worker.

Small graphs are spaced with room to spare (the unit tests check star, clique, cycle and
two-cluster fixtures). Collision is a soft force, so on a large or very dense graph a gap can
come out a little under `spacing`; the tests don't promise more than no overlap there.

## Worker messages (phase 02)

`lib/graph/layout.worker.ts` is a module worker that runs `compute3DLayout`, one request at a
time, in the order they arrive. The messages are typed once, in `lib/graph/layout-messages.ts`,
and used by both sides. Everything in and out is plain data, safe for `postMessage` (a unit
test round-trips the result through `structuredClone` and JSON).

- In: `{ requestId, nodes: GraphNode[], links: GraphLink[], options?: LayoutOptions }`, the
  API's response as it came, plus any options. `requestId` counts up from 1 per page.
- Out: `{ requestId, layout: GraphLayout }`, the same id with:
  - `nodes`: new objects, in the order they came in: each API node's fields plus `x`, `y`,
    `z` and `radius`;
  - `bounds`: `{ center: { x: 0, y: 0, z: 0 }, radius }`, a sphere holding every orb, at
    least 10 across so an empty or one-record map frames sensibly;
  - `scale`: 1, or below 1 when the layout was shrunk to fit `maxRadius`;
  - `iterations`: the steps run.
- On a refusal: `{ requestId, error }` with the refusal's message (a `LayoutInputError`), or
  a plain "could not be laid out" for any other failure. The map shows an error, not a guess.

The page's side is `lib/graph/layout-client.ts`, used by the `useGraphLayout` hook
(`lib/graph/use-graph-layout.ts`):

- One layout is wanted at a time. A new graph, a cancel, or leaving the page stops the worker
  mid-run (a layout cannot be interrupted any other way); the next request starts a fresh
  worker. A finished layout leaves the worker running for the next one.
- An answer whose `requestId` is not the one awaited is dropped, and the hook pairs each
  layout with the very graph it was made from, so a stale layout is never drawn.
- A worker that crashes fails the waiting layout with a plain message and is replaced.

## Measured

`scripts/node.sh npm run --silent graph:benchmark` lays out a made-up graph, the same every
run (seeded): 1,000 records of every type and 3,000 links, most attached to a few hubs, as
people and projects collect them, and about 5% of records with no link. One warm-up run, then
five timed runs.

2026-10-11, this dev VM: Node 24.21.0 in the pinned image, 4 CPUs (AMD Ryzen AI 7 350), 16 GB.
The VM was busy with other work (load average about 9 on 4 CPUs), so the times are on the
slow side.

| Graph                   | Time (min / median / max) | Peak heap | Fits 120 as is | Smallest gap, overlaps |
| ----------------------- | ------------------------- | --------- | -------------- | ---------------------- |
| 1,000 records, 3,000 links | 1.25 / 1.49 / 1.62 s   | 72 MB     | yes (radius 114) | 2.96, none           |
| 2,000 records, 6,000 links | 3.20 / 3.37 / 3.87 s   | 60 MB     | no, scale 0.54 | 0.11, none             |

The target, under 2 seconds for 1,000 / 3,000, is met. The first settings (300 steps, d3's
default theta 0.9, push with no range limit, collision on every step) took 5.2 to 6.3 s, and
the layout came out about 4 times too wide, so shrinking it to fit squeezed the orbs together.
Timing each force on its own showed the push (about 3 s) and collision (about 1 s) cost
nearly all of it. The settings above were chosen by measuring each change for time, size,
spacing and how much closer linked records sit than random pairs; that last measure stayed
within 0.01 of the first settings.

These are a reference point, not a promise: a phone may well be slower, and the work grows
faster than the graph (twice the records took about 2.3 times as long). Past about 1,000
records the layout also outgrows the 120-unit sphere and is shrunk, so orbs sit closer than
`spacing`. Limits for larger graphs are a later decision, on measurements in the browser.

## Measured in the browser

The render benchmark opens `/map` with the same made-up 1,000-record, 3,000-link graph
(`tests/support/synthetic-graph.ts`, shared with the layout benchmark), served in place of
the API's answer, three times. It reads two timings the page records with
`performance.measure`: `graph:layout` (request to answer from the layout worker) and
`graph:first-draw` (building the scene and drawing its first frame). Then it drags the view
round and times the gaps between the browser's frames. Run it in the `browser` service of a
running test stack (the same compose files and project as `scripts/test-stack.sh`):

    docker compose -p <project> ... run --rm --no-deps browser \
      npx playwright test -c tests/benchmark/playwright.config.ts

`MAP_BENCH_NODES`, `MAP_BENCH_LINKS` and `MAP_BENCH_RUNS` (passed with `-e`) change the size
and the number of runs.

2026-10-11, this dev VM (4 CPUs, 16 GB, load average about 11 to 14 from other work):
headless Chromium 153 in the Playwright 1.63 image, 1280 x 800 (canvas 1072 x 800), device
pixel ratio 1. The VM has no graphics card, so WebGL ran in software: `ANGLE (Google, Vulkan
1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, WebGL 2.0.

| Graph                      | Layout in worker | Scene + first frame | Page to first frame | Frame while dragging (median / p95) |
| -------------------------- | ---------------- | ------------------- | ------------------- | ----------------------------------- |
| 1,000 records, 3,000 links | 1.12 - 2.23 s    | 146 - 366 ms        | 1.85 - 3.60 s       | 350 - 367 / 667 - 767 ms            |
| 100 records, 300 links     | 0.26 - 0.38 s    | 72 - 125 ms         | 0.90 - 1.36 s       | 50 - 83 / 83 - 117 ms               |

Software WebGL is slow for any 3D scene: even 100 records draw at only 12 to 20 frames a
second. These numbers are a floor, for a browser that has no graphics card or has turned it
off. They are not what a computer or phone with a GPU will see. Nothing here measured one.

What a frame cost, timed part by part in the same browser (1,000 records): the orbs at 24
segments, 590 to 660 ms; the 1,000 aura sprites, 38 ms, although they are as many draws as
the orbs; the merged conduits, 113 to 127 ms; and the starfield, a few ms. The orbs cost
in proportion to their triangles, not their draws. At 16, 12 and 8 segments they took 283,
167 and 87 ms, so the instancing first planned as the fallback would not have helped. Two
changes came from this:

- Orbs further than 60 units from the camera use a 12-segment sphere. At that distance an
  orb is at most a few dozen pixels across and looks the same. Nearer orbs keep the full 24
  segments (`SCENE_STYLE.orb`, `updateView`). This took a whole 1,000-record frame from 760 -
  980 ms to about 345 ms, and a 100-record frame from 135 to 72 ms.
- The controls' damping is scaled by the time since the last frame. A slow device eases to a
  stop in the same time as a fast one, but in fewer frames. Before this change, each drag
  was followed by some 200 slow frames (tens of seconds) and the pointer stalled.

No records are dropped and there is no size limit. Whether larger graphs, or software WebGL,
need one is an open question in the plan.
