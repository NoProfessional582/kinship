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
