# About this project

A working summary of the Floorplan Generator: what it is, how the code fits
together, where it stands, and where the code and the other docs disagree.
Written from a full read of the repository on 02/11/2026 (main at `94a9b00`);
updated 03/11/2026 for furniture, the plan editor and the pain-point research.
[README.md](README.md), [PLAN.md](PLAN.md) and [PROGRESS.md](PROGRESS.md)
remain the primary docs; this file is a map, not a replacement.

## What it is

A constraint-driven 2D floor-plan generator with a hand editor. Input: a
rectangular plot, setbacks and a room programme. Output: a `Plan` — rooms,
walls, doors, windows, furniture — and an SVG sheet, which the UI lets you edit
by drag and drop.

- The engine (`engine/src/`) is pure TypeScript: no runtime dependencies, no
  DOM, no I/O. It runs unchanged in Node and the browser.
- The React UI (`ui/`) imports the engine source directly. The engine's imports
  carry `.js` extensions (`module: NodeNext`); a small plugin in
  `ui/vite.config.ts` maps `./foo.js` onto `./foo.ts`. Keep it.
- Same seed + same brief = same plan. This is a hard rule.

About 3,900 lines in total.

## Layout

```
engine/src/geometry.ts    Rect, splitRect, sharedEdge, touchesBoundary, EPS
engine/src/brief.ts       Brief/RoomSpec/Room types, DEFAULTS, HALL_DEPTH (1.2 m),
                          ZONE_OF, ADJACENCY (allowed door pairs), footprint,
                          program, withHall, normaliseAreas
engine/src/subdivide.ts   mulberry32 rng, recursive area-exact partition,
                          hall spine placement, SplitMode 'flat' | 'zoned'
engine/src/score.ts       layoutScore, adjacencyGraph, unreachableCount (by shared walls)
engine/src/walls.ts       buildWalls, exteriorSegmentsOf, segLen
engine/src/doors.ts       doorCapacity, allowedPair, assignBaths, placeDoors,
                          door-graph reachability helpers
engine/src/windows.ts     placeWindows, windowDoorConflicts, sameLine, extent
engine/src/validate.ts    validate() -> string[]; never throws
engine/src/grid.ts        grid growth + annealing; rooms can be L-shaped
engine/src/shape.ts       rooms as unions of rectangles: shared edges, min width
engine/src/furniture.ts   placeFurniture (per-room beam search), symbols, inDoorSwing
engine/src/edit.ts        pure edit ops: setDoor, setWindow, moveWall, moveFurniture,
                          rotateFurniture, removeAt, furnitureClashes
engine/src/schedule.ts    areaSchedule (carpet, built-up, coverage, FAR), scheduleCSV
engine/src/dxf.ts         planDXF: AutoCAD R12 DXF in millimetres
engine/src/render-svg.ts  Plan type, sheetFrame, dimensionChains, doorSwingSide, renderSVG
engine/src/index.ts       generate(), infeasibleReason, re-exports
demo.ts                   CLI: node dist/demo.js [seed] [attempts] [effort] -> out/plan.svg
tests/engine.test.ts      25 node:test tests on the 2BHK demo brief
tools/stress.ts           6 briefs x seeds 1-8, resumable, stress-results.json
ui/src/App.tsx            form, Generate button, toolbar, undo history, save/load, exports
ui/src/Editor.tsx         the editable drawing: engine SVG + a hit-target overlay, typed sizes
ui/src/Schedule.tsx       the area schedule table
ui/src/exports.ts         file download, print to scale on the smallest ISO sheet
```

## How generation works

`generate(brief, seed = 1, attempts = 400, effort = 1)` in `index.ts`:

1. **Feasibility.** `infeasibleReason` rejects a brief whose rooms need more
   area than is buildable, or whose room `minW` exceeds the footprint's narrow
   side. The plan is returned empty with `plan.infeasible` set. The hall is not
   counted here.
2. **Plain search.** For `i` in `0..attempts`, rng = `mulberry32(seed*100003 + i)`:
   - `normaliseAreas` scales target areas to fill the footprint exactly.
   - `subdivide` -> `partition`: recursive cuts at the area share of each side,
     so every room hits its target area exactly. The search chooses which rooms
     group together and the cut axis (both axes tried). `cutCost` scores
     finished rooms on shape and min width, intermediate blocks only against
     going pathological (aspect > 3), plus a penalty for separating allowed pairs.
   - `buildWalls`, then `placeDoors` with rng `mulberry32(seed*7919 + i)`.
   - Rank = `layoutScore` + 60 x rooms unreachable through doors + 15 x doors
     over capacity (hall exempt).
3. **Spine search**, only if the plain winner fails validation: `withHall` adds
   a hall of area `max(4, 1.2 x footprint width)`. `spine()` places it as a
   full-width strip, partitions the rooms above and below, and picks the
   winning layout by `layoutScore` alone (door feasibility only filters
   afterwards). Falls back to a plain partition if the strip would be
   too thin or deeper than 35% of the plan.
4. Return whichever is clean, else the one with fewer problems.
5. **Windows** are placed only on the winner.

### Doors (`doors.ts`)

After Marson & Musse (2010), doi:10.1155/2010/624817.

- Step 1: a door for **every** shared edge whose type pair is in `ADJACENCY`
  (bath and utility excluded). Capacity is not enforced during placement.
- Step 2: baths. `assignBaths` keeps one common bath; every bath beyond that is
  en suite to a seeded bedroom. Each bath gets one door: its partner bedroom,
  else hall, dining, living.
- Step 3: utility -> kitchen, else hall or dining.
- Entry: 1.0 m on the living room's exterior wall, preferring "front" (lowest
  y), then the longest run.
- Openings are 0.9 m, 0.15 m off the corner plus a seeded inset, at a seeded end.
- `doorCapacity`: hall unlimited; living/dining/kitchen 2; everything else 1.

### Windows (`windows.ts`)

Only on exterior segments of at least 1.2 m, longest first, at most **one per
segment**, centred on the longest run left free by doors on the same line,
width `min(windowWidth, 0.8 x run)`. Blocked intervals are clamped to the run
(the fix for windows landing in the next room).

### Validation (`validate.ts`)

Checks coverage vs footprint, min dimensions, door reachability from living,
baths with more than one door, daylight rooms with no window, window/door
overlap, any exterior walls, positive wall thickness. An empty plan returns no
problems. It does **not** check door capacity, a missing entry, or window
counts against the spec — those are Phase 1 work.

### Room defaults (`DEFAULTS`, unverified starting values)

| type | area m² | minW m | daylight | windows |
|---|---|---|---|---|
| living | 16 | 3.0 | yes | 2 |
| dining | 10 | 2.4 | yes | 1 |
| kitchen | 8 | 2.1 | yes | 1 |
| bedroom | 12 | 2.7 | yes | 1 |
| bath | 4 | 1.5 | no | 0 |
| utility | 3 | 1.2 | yes | 1 |
| store | 2 | 1.0 | no | 0 |
| hall | 4 | 1.0 | no | 0 |

## Furniture (`furniture.ts`, 03/11/2026)

Placed per room by a beam search (12 partial layouts kept per piece), not
greedily. Each piece has size variants (queen bed with bedside tables down to a
single; 6- to 4-seat dining) and clear zones in its own frame: hard zones must
be free floor, soft ones earn score. Scored relations: bed head off the door
wall and not under a window; WC and basin on one wet wall, shower in a corner;
sink and hob as an L, sink–hob–fridge work triangle (legs 1.2–2.7 m, total
< 7.9 m); TV opposite and centred on the sofa; dining table near the centre.
Finalists are re-ranked on walkways: a ~50 cm path from the door must reach
every piece. Door swings are tested as the quarter disc the leaf sweeps.
Clearances are rules of thumb from design guides, not code. Deterministic.
`Plan.furniture` stores the result so edits stick; `renderSVG` places it on
the fly only when it is absent.

## Editor (`ui/src/Editor.tsx`, `edit.ts`, 03/11/2026)

The engine's SVG is drawn unchanged; a transparent overlay with the same
viewBox (`sheetFrame`) carries hit targets. Drag furniture (R rotates, Del
deletes; red = clash), slide and resize doors and windows (held to their host
wall), drag interior walls (every room edge on the line moves, walls are
rebuilt, openings refitted; refused below 0.9 m). Undo/redo (Ctrl+Z/Y),
Re-furnish, Save/Load JSON (`{version: 1, brief, plan}`). Validation re-runs on
every edit. Every edit op is a pure function returning a new plan.

## Status

- Feature stages 0–7 done (engine, walls, windows, validator, SVG, doors, UI).
  Stage 8 (export, presets) waits behind the audit plan.
- External audit (01/11/2026): only the 2BHK demo validates reliably. 1BHK,
  3BHK and narrow fail; tiny and overstuffed are now rejected as infeasible.
- Audit phases: 0 (harness + tests) done; 2.1 (optional hall) and 2.4
  (infeasible briefs) done; **Phase 1 (door rules) is written but not on main —
  no local branch, stash or remote branch holds it**; next is **Phase 4
  (performance)**: rank cheaply, build walls/doors for the top K, Web Worker in
  the UI. Phase 6 (real norms) needs the owner.
- Phase 1 gate: 1BHK and 3BHK at 7/8 seeds or better at 60 attempts, effort 0.6.
- Timings (from PROGRESS.md): 120 attempts / effort 0.5 ~15 s; 60 / 0.6 ~7 s
  (UI preview); 150 / 1.0 ~29 s.

- **New direction (02/11/2026):** the splitter is being replaced by an
  architect-style generator with no AI: grid growth (A), zones first (B),
  simulated annealing (C), self-repair (D). Step A is next. Details in
  [PLAN.md](PLAN.md), *Next direction*.
- UI now generates only when the Generate button is pressed.
- **Furniture and editor (03/11/2026)**, sections above. Verified by tests and
  by driving the UI in headless Edge (drag, resize, wall move, undo).
- **Next (03/11/2026): architect pain points**, using **Indian norms** (NBC
  2016 and state bye-laws) for compliance. Research and order in
  [PLAN.md](PLAN.md), *Architect pain points*.
- **Step A done (02/11/2026):** `engine/src/grid.ts` (grid growth + annealing,
  L-shaped rooms via `Room.parts`) and `engine/src/shape.ts`. Select with
  `generate(brief, seed, attempts, effort, 'grid')`, the CLI's 5th arg, the
  harness's `--layout=grid`, or the UI's Layout picker (UI default: grid).
  Grid vs split at preview settings: 1BHK 6/8 vs 0/8, 2BHK 8/8 vs 8/8, 3BHK
  1/8 vs 7/8, narrow 0/8 vs 0/8. Door-rule fixes and ranking on real
  validation apply to both. See PROGRESS.md.

## Where code and docs disagree

1. **Phase 2.2 is marked done but is not on main.** The recursive `partition`
   calls in `subdivide.ts` (lines 166–167) and the fallbacks in `spine()` (185,
   218) drop `effort`, so it defaults to 1. `0.4 * effort` only reaches the
   first cut of each block. No commit has changed that recursion; the fix may
   live with the unmerged Phase 1 work. Timing numbers are affected.
2. **One window per wall segment.** Living asks for 2 and only gets them with
   two exterior segments. Hidden because `validate` doesn't check counts.
3. **Front/back flipped.** The entry prefers lowest y as "front", but
   `renderSVG` offsets y by `setbacks.back`, so y = 0 is drawn at the back.
   Listed under Phase 3.
4. Smaller items:
   - `doorDegrees` and `doorsPerRoom` are the same function.
   - Dead code: `void depth` and `void (0 as unknown …)` in `subdivide.ts`,
     `EPSILON` in `validate.ts`, the `depth` parameter of `subdivide`.
   - Door swings always hinge at the low end of the opening, whichever end
     `opening()` chose.
   - Sizes are wall centrelines, not clear dimensions; wall thickness is only
     used for drawing (Phase 3).
   - `footprint()` sits at origin (0, 0); setbacks only matter in rendering.
   - When the plain search fails, the whole search runs again with the hall,
     roughly doubling time on those briefs.
   - `infeasibleReason` compares every `minW` to the narrow side only.
   - `unreachableCount` (shared walls) is still used by `layoutScore`;
     `validate` uses the door graph.
5. UI: programme fixed to living + dining + kitchen, with counts for
   bedrooms/baths and a utility toggle (no store); effort fixed at 0.6;
   generation runs on the main thread, triggered by the Generate button.
6. Editor limits: no adding furniture; L-rooms change shape only through
   their walls; furniture is not re-placed when a wall moves (Re-furnish does
   it on request); a saved plan has no schema migration beyond `version`.

## Running

```
npm install
npm test                 # tsc, then node --test dist/tests/
npm run stress           # or: node dist/tools/stress.js --mode=preview --briefs=0,1 --seeds=1,2
node dist/demo.js 7 120 0.5

cd ui && npm install && npm run dev
```

- Dependencies installed 02/11/2026 (Node 22.18). Demo validates clean in
  5.1 s; all 22 tests pass (03/11/2026) via `node --test dist/tests/engine.test.js`.
  `npm test` itself fails on Windows (directory passed to `node --test`).
- Root devDeps: TypeScript `^7.0.2`, `tsx`, `@types/node`. UI: TypeScript
  `^5.7.2`, Vite 6, React 18.
- `npx tsx` and `vite build` hit WASM out-of-memory in the build sandbox;
  compile with `tsc` and run the emitted JS.

## Ground rules (from PLAN.md)

- No claim without a harness number; record before/after in PROGRESS.md.
- Never break determinism. The engine stays pure. `validate()` never throws.
- Fix root causes rather than loosening the validator.
- No new runtime dependency without a licence check. No `LICENSE` file yet,
  and the repo (`github.com/rajeshkannark004/floorplangenerator`) is public.
- Commit messages describe behaviour, not files.
