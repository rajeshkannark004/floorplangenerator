# Progress

Last updated: 02/11/2026

## Where things stand

Stages 0–7 of PLAN.md are done. The engine generates a plan end to end — rooms,
walls, windows, doors — renders an SVG, and the React UI in `ui/` imports the
engine directly with a live preview.

**It works reliably on one brief.** An external audit on 01/11/2026 ran six
briefs and only the 2BHK demo validated on every seed; the rest failed badly.
Treat everything below as true of the demo brief, and see the audit section for
what actually holds across briefs. The audit plan in PLAN.md is what the work is
following now.

Sample run: 10×15 m plot, 1.5 m setbacks all round → 7×12 m buildable
footprint, 9 rooms (8 plus the hall), 28 wall segments (14 exterior), 7 windows,
9 doors, validation clean, score −24.11 at seed 7 with 120 attempts and effort
0.5, in about 15 s.

Scores are only comparable between runs of the same scoring function. Compare
physical metrics instead, as in the table below.

## Speed

Generation is the expensive part, and it is now tunable: `generate(brief, seed,
attempts, effort)`. Effort scales the spine search and the split search together.

| attempts | effort | time | notes |
|---|---|---|---|
| 150 | 1.0 | ~29 s | the old default, no longer used |
| 120 | 0.5 | ~15 s | `demo.ts` default |
| 60 | 0.6 | ~7 s | UI preview |

The preview deliberately trades search depth for latency. At the preview settings
7 of 8 seeds validate clean; the eighth surfaces its violations in the UI rather
than hiding them. The CLI's 120 attempts at effort 0.5 is cleaner and slower.

## Splitter measurements

25 seeds × 300 attempts on the sample brief, before doors existed, same harness
for all three runs.

| splitter | avg max aspect | avg mean aspect | rooms >1.8 | rooms >2.0 | min-width fails |
|---|---|---|---|---|---|
| baseline (longer axis only, blocks scored) | 2.10 | 1.41 | 1.0 | 1.0 | 0 |
| zone-first, per Marson & Musse | 2.25 | 1.70 | 4.0 | 1.0 | 1.0 |
| flat, both axes, finished rooms only | 1.89 | 1.54 | 2.0 | 0.0 | 0 |

Those numbers predate the hall spine, so they describe the splitter in isolation
rather than today's output.

## What works

- Area-exact partition: every room hits its target area, footprint fully tiled.
- Seeded and deterministic: same seed and brief always give the same plan.
- Cut search tries both axes, not only the longer one.
- Cut cost scores *finished* rooms on shape and only stops intermediate blocks
  going pathological. Scoring every intermediate region was what forced baths to
  3.5×1.4 m.
- **Hall spine.** The hall is placed before the other rooms: a strip spanning the
  full buildable width, `HALL_DEPTH` (1.2 m) deep, at a position the search picks.
  Rooms are then partitioned into the block above and the block below, still
  area-exact. Letting the ordinary splitter place the hall produced a stub beside
  the utility, with every other room reachable only through the living room.
- **Doors** (`doors.ts`). A door goes only where two rooms share an edge and the
  pair is allowed. Baths get an assigned role — one common bath per house, every
  bath beyond that en suite — and exactly one door each, onto their bedroom or the
  hall. Openings sit beside a corner rather than the middle of the wall, chosen by
  the seeded rng.
- Windows only on exterior walls, every daylight room covered, and they slide
  around door openings instead of being placed independently.
- `validate()` reports coverage, minimum dimensions, unreachable rooms, baths
  with more than one door, daylight rooms without windows, and window/door overlap.
- **React UI** (`ui/`). Vite + React + TypeScript. The engine's imports carry
  `.js` extensions for NodeNext, so `vite.config.ts` has a small resolver mapping
  `./foo.js` onto `./foo.ts` — that is what lets the UI import the engine with no
  copy and no build step between them. Form for plot, setbacks, wall and window
  sizes, room counts, seed and attempts; debounced preview; violations listed.

## Known problems

- **Most briefs fail.** Only the 2BHK demo validates on every seed. 1BHK, 3BHK,
  narrow, tiny and overstuffed all fail; the audit section has the numbers and
  the causes.

- Full-effort generation is still slow: ~15 s at 120 attempts, ~29 s at 150.
  Ranking on shape first and deriving walls and doors only for the top few
  candidates is the real fix; the effort knob only masks it.
- At the preview settings (60 attempts, effort 0.6) roughly one seed in eight
  comes back with a min-width violation. That is the price of a ~7 s preview; the
  CLI's 120 attempts at effort 0.5 is the setting to trust.
- Rooms shrink about 10% to pay for the corridor. That is correct but it is a
  real trade against target areas.
- The entry door takes the longest exterior run on the living room, preferring
  the front elevation when the living room touches it. In several layouts it does
  not, so the entry lands on a side elevation.
- A bedroom that does not touch the hall is reached through the living room, so
  living ends up with two interior doors. Acceptable, but not what a real plan
  does.
- Exterior wall segments are emitted per room, so a straight run along the plot
  boundary can arrive as several collinear segments. Rendering is fine; a future
  DXF export will want them merged.
- `HALL_DEPTH` and the room defaults in `brief.ts` are plausible values, **not**
  verified building norms.
- The comparison harness that produced the splitter table is not in the repo. It
  should be, before the next scoring change.
- No `LICENSE` file, and the repo is now public. Add one before inviting anyone
  to use it.

## Rejected: zone-first split

Marson & Musse partition into social / service / private zones first, then
squarify each zone. It is implemented in `subdivide.ts` behind
`SplitMode = 'zoned'` and defaulted off, because it measured worse on shape:
constraining the layout into three blocks forces long rooms and cost a min-width
violation. The paper itself notes that the initial zone split can leave rooms
far from square. Keep it available; do not make it the default without a better
zone-level cut.

## Audit (external review, 01/11/2026)

Six briefs x seeds 1-8 at the preview settings (60 attempts, effort 0.6) unless
noted. `valid` means the plan validated with no problems at all.

**Baseline, before any fix:**

```
1BHK          0/8      676 ms   8x bedroom min-width; 6x bath unreachable; 1x kitchen unreachable
2BHK          8/8    10295 ms   —
3BHK          1/8    32995 ms   6x daylight room with no window; 1x bath min-width; 1x store unreachable
narrow        0/8     3390 ms   8x bath min-width; 3x bedroom unreachable
tiny          0/8      385 ms   every room below min width; kitchen and bath unreachable
overstuffed   0/8     2258 ms   32x bedroom min-width; and the rest
```

**Phase 0 — done.** `tools/stress.ts` (resumable per seed, `--briefs`, `--seeds`,
`--mode`, `--report`) and `tests/engine.test.ts` (13 tests on `node:test`, no new
dependencies). `npm test` and `npm run stress`.

The tests found a real bug on their first run: `complement()` in `windows.ts`
did not clamp blocked intervals to the wall run, so a door on the same wall line
but outside the room widened the free span and the window was centred on it.
Windows were landing up to 0.8 m outside their own room — dining's window sat in
the living room. Fixed, with a regression test that a window must lie on its own
room's wall and within that room's span. `walls.ts` had the same missing clamp
and got the same treatment.

**2.1 and 2.4 — done.** `infeasibleReason()` rejects a brief before searching
when the rooms need more floor area than the setbacks leave, or a room's minimum
width cannot fit the footprint; the reason lands on `plan.infeasible`. The hall
is no longer assumed — `generate()` tries the plain programme first and falls
back to the spine only when the door rules need it, and the fallback re-checks
feasibility with the hall's area added (5% tolerance, since normalisation
absorbs a small overshoot). 2.2 came with it: `effort` now reaches the recursive
splits.

```
tiny          0/0 (8 infeasible)     0 ms   programme needs 40.0 m² but only 20.0 m² is buildable
overstuffed   0/0 (8 infeasible)     0 ms   programme needs 96.0 m² but only 48.0 m² is buildable
1BHK          0/8                  790 ms   8x no door path from living: bath, kitchen
```

**Phase 1 — written, not merged.** living<->kitchen added to the pair table;
baths go all en suite when there is no hall, so a 1BHK's single bath can serve
its bedroom instead of demanding circulation; door placement grows outward from
the living room under `doorCapacity` instead of taking every allowed pair, and
`validate()` enforces capacity, requires an entry door, and checks window counts
against the spec; entry falls back living -> hall -> dining; the ranking
penalises a daylight room that touches no exterior wall.

It is not green, so it is not on main:

```
1BHK          0/8       599 ms   plain: kitchen and bath min-width, kitchen unreachable
                                  hall:  bedroom min-width, bath unreachable
2BHK          6/8      7171 ms   no door path: bedroom / bath+utility+bedroom
2BHK (150)    8/8     17836 ms   same code, more attempts
```

2BHK regressed from 8/8 to 6/8 at the preview setting and recovers to 8/8 at 150
attempts with identical code. That is search depth, not a structural conflict:
enforcing door capacity shrinks the fraction of legal layouts. The reason more
attempts is the only lever today is that `spine()` picks its winning layout with
`layoutScore` alone — door feasibility never influences which layout is built, it
only filters afterwards. Fixing that is the "rank cheap first, build walls and
doors for the top K" work in Phase 4.

## 02/11/2026

- **Direction change.** The owner finds the plans too template-like and wants
  the algorithm itself — no AI — to design like an architect and repair its
  own problems. Agreed plan in PLAN.md, *Next direction*: grid growth (A),
  zones first (B), simulated annealing (C), self-repair (D). Step A is next.
- **UI.** A Generate button replaces the debounced live preview; nothing runs
  until it is pressed, and the panel says when inputs have changed since the
  last run.
- **Measured locally** (Windows, Node 22.18): demo at seed 7, 120 attempts,
  effort 0.5 validates clean in 5.1 s (PROGRESS above says ~15 s; that was the
  build sandbox). All 13 tests pass.
- **`npm test` fails on Windows**: `node --test dist/tests/` is handed a
  directory and exits with `MODULE_NOT_FOUND`. `node --test
  dist/tests/engine.test.js` works. Not yet fixed.
- **Phase 2.2 is not actually on main.** The recursive `partition` calls in
  `subdivide.ts` drop `effort`, so it falls back to 1 below the first cut. The
  fix is probably with the unmerged Phase 1 work.

### Step A — grid growth (02/11/2026)

`engine/src/grid.ts`, selected with `generate(..., layout = 'grid')`; the
splitter stays the default. Rooms grow from seeds on a 0.3 m grid (rectangles,
then L-growth, then leftover fill), then a tidy-up pass, then simulated
annealing over single-cell and whole-wall moves. Rooms can now be L-shaped:
`Room.parts` holds the rectangles, `rect` the bounding box, and `shape.ts`
gives walls, doors, windows, scoring, validation and the renderer what they
need for that.

What made it work, in the order it was found:

- Peeling "thin" cells ate rooms that were narrow all over. It now only peels
  bumps narrower than the rest of their room.
- Seeds spaced by both rooms' sizes, and placed one room-width from a room they
  may open onto, so door neighbours end up sharing a wall.
- Single-cell moves cannot widen a room; whole-wall shifts can.
- On a 0.3 m grid most width misses are one cell (2.94 m vs 3.0 m) and cost
  less than an odd shape. A miss now costs a fixed 40 on top.
- The grid score's door check let paths run through baths; one-door rooms are
  now dead ends. A daylight room needs 1.2 m of straight outside wall, not a
  corner touch.
- Rank cheap, refine the best 24 of 60 (4200 moves at full effort). Refining 4
  scored 1/6 on 2BHK; breadth matters more than depth.

Changes that affect both layouts:

- Candidates are ranked on real validation (100 per problem), windows placed,
  not on shape alone.
- Door rules: living↔kitchen and kitchen↔store added to the pair table
  (plausible, not verified norms); an en suite falls back to any bedroom it
  shares a wall with; a common bath with no circulation opens into a bedroom;
  a bath partner must share enough wall for a door.

Harness, preview settings (60 attempts, effort 0.6), seeds 1–8:

```
              split           grid
1BHK          0/8   0.6 s     6/8   4.1 s
2BHK          8/8   3.8 s     8/8   5.0 s
3BHK          7/8   8.5 s     1/8  12.7 s
narrow        0/8   1.4 s     0/8   ~7–10 s
```

Split 3BHK was 1/8 at the audit baseline; the door-rule fixes and ranking on
validation took it to 7/8. The narrow average in the raw report (82 s) is one
568 s seed that reruns in 9.8 s: the machine stalled, not the code. 18 tests
pass (5 new for grid).

Still wrong with grid: 3BHK (missing windows, bedrooms off circulation) and
narrow (bedrooms unreachable); about 2x slower than split; the hall is still a
full-width strip.

## Next task

Grid: 3BHK and narrow, then step B (zones first, hall only where it joins
zones). The UI defaults to grid; the CLI and harness default to split.

Earlier plan — Phase 4's "rank cheap first" is now done for grid; the rest
waits on whether split stays: rank candidates cheaply first and build walls and doors
only for the top K, then move `generate()` into a Web Worker in the UI. That
unblocks Phase 1, whose rules are written but cannot be gated while 60 attempts
samples the legal layouts so thinly.

Stage 8 — export and presets — waits until the audit phases are green, so the
presets can ship as regression cases rather than as more briefs that fail.

## How to run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js            # seed 7, 120 attempts, effort 0.5
node dist/demo.js 7 40 0.35  # seed, attempts, effort — writes out/plan.svg
```

The UI:

```
cd ui
npm install
npm run dev
```

Note: `npx tsx` and `vite build` do not work in the build sandbox (WASM out of
memory); compile with `tsc` and run the emitted JS.
