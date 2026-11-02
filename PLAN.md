# Floorplan Generator — plan

A constraint-driven 2D floor-plan generator. You describe the plot and the room
programme; it produces a layout, walls, windows, doors and an SVG sheet.

## Scope

In: rectangular plots, setbacks, rooms with target areas and minimum dimensions,
interior/exterior walls, windows on exterior walls, one straight circulation hall
spanning the buildable width, interior doors and an entry door, SVG output, a
browser UI with a live preview.

Not in (for now): L-shaped or irregular plots, corridors that turn or branch,
staircases, furniture, 3D, PDF/DXF export, any server-side component.

## Architecture

The engine is pure TypeScript — no DOM, no React, no dependencies, no I/O. It
takes a `Brief` and returns a `Plan`. That is what makes it testable headlessly
and portable to the browser unchanged.

```
engine/src/geometry.ts    rect maths, shared edges, boundary tests
engine/src/brief.ts       Brief/Room types, room defaults, zones, adjacency rules
engine/src/subdivide.ts   seeded partitioner, hall spine placement
engine/src/score.ts       layout scoring + reachability
engine/src/walls.ts       interior walls from shared edges, exterior from leftovers
engine/src/windows.ts     window placement on exterior walls, clear of doors
engine/src/doors.ts       bath roles, door pairs, openings, door reachability
engine/src/validate.ts    rule checks, returns a list of violations
engine/src/render-svg.ts  Plan -> SVG string
engine/src/index.ts       generate(brief, seed, attempts, effort)
demo.ts                   CLI: writes out/plan.svg
ui/                       Vite + React + TypeScript, imports the engine directly
```

The UI imports `engine/src` with no copy and no build step between them. The
engine's imports carry `.js` extensions for `module: NodeNext`, which Node
resolves and Vite does not, so `ui/vite.config.ts` maps `./foo.js` onto
`./foo.ts` when the latter exists. Keep that plugin if you touch the config.

## Brief schema

```ts
interface Brief {
  plot: { w: number; d: number };            // metres
  setbacks: { front: number; back: number; left: number; right: number };
  wallThickness: number;                      // metres, e.g. 0.23
  windowWidth: number;                        // metres, e.g. 1.2
  rooms: RoomSpec[];                          // type, count, area, minW, daylight, windows
}
```

`normaliseAreas` scales target areas so the programme exactly fills the buildable
footprint. The form therefore never has to be arithmetically perfect.

## How the algorithm works

1. **Footprint** = plot minus setbacks.
2. **Hall spine.** The hall is placed before anything else: a strip spanning the
   full buildable width, `HALL_DEPTH` (1.2 m) deep, at a position the search
   picks. The rooms are then partitioned into the block above and the block
   below it. Letting the ordinary splitter place the hall produced a stub tucked
   beside the utility, with every other room reachable only through the living
   room.
3. **Partition**: recursively split each block by the longer axis or the other,
   whichever leaves better-shaped rooms. The split ratio is the area share of the
   rooms on one side, so every room lands on its target area *exactly*. The only
   freedom is *which* rooms go where — and that is what the search optimises.
4. **Score** each candidate: aspect ratio, minimum dimensions, daylight rooms
   touching the boundary, preferred adjacencies, rooms touching the hall, and
   whether doors can actually be placed.
5. **Keep the best** of N seeded candidates.
6. **Derive** walls, then doors, then windows, then validate.

Same seed + same brief = same plan. Never break that; it is what makes the
engine tunable.

`generate` takes a fourth argument, `effort` (default 1), which scales the spine
and split searches together. The CLI runs 0.5, the UI preview 0.35. Lower effort
is faster and may return a plan with a reported violation rather than a better
one.

## Doors and circulation

Modelled on Marson & Musse (2010), *Automatic Real-Time Generation of Floor
Plans Based on Squarified Treemaps Algorithm*, Int. J. Computer Games
Technology, doi:10.1155/2010/624817 (open access, CC BY 3.0).

Doors are **not** a spanning tree over every shared edge.

1. **Allowed pairs.** A door goes only where two rooms share an edge *and* the
   room types may connect (`ADJACENCY` in `brief.ts`). This is what stops a
   bathroom opening onto a kitchen.
2. **Baths get a role, not just a type.** One bath per house is common and opens
   onto the hall; every bath beyond that is en suite to a specific bedroom. Which
   bath plays which role, and which bedroom an en suite belongs to, comes from
   the seeded rng. A bath has exactly one door.
3. **Openings sit beside a corner**, not in the middle of the wall, with a
   clearance off the corner and a width of 0.9 m. The near end and the inset are
   drawn from the seeded rng.
4. **Reachability is checked through doors**, not through shared walls. A room
   with no door path from the living room is a validation failure.

The corridor is not a fallback generated by path-finding. It is a room in the
programme, placed by the partitioner as a spine, which is why the door graph
comes out as a star rather than a chain. If a later version needs corridors that
turn or branch, that is a partitioner change, not a door change.

## Roadmap

| Stage | Work | Done when |
|---|---|---|
| 0 | Geometry, brief, partitioner | Rooms fill the footprint exactly, tests pass |
| 1 | Scoring + seeded search | Best-of-N beats a random candidate on every metric |
| 2 | Walls | Interior from shared edges, exterior from uncovered leftovers |
| 3 | Windows | Only on exterior walls, every daylight room covered |
| 4 | Validator | Returns violations, never throws |
| 5 | SVG renderer | Readable plan sheet with labels and dimensions |
| 6 | Doors + circulation | Allowed pairs, one door per room, bath roles, hall spine, doors clear of windows |
| 7 | React UI | Form + live preview, engine imported directly |
| 8 | Export + presets | SVG/JSON download, 1BHK/2BHK/3BHK presets, seed control |

Stages 0–7 are done. Stage 8 is the remaining feature work, but it is blocked
behind the audit plan below — the engine only works reliably on the demo brief.

## Audit plan (external review, 01/11/2026)

An external review stress-tested the engine on six briefs. Only the 2BHK demo
passed; almost every other brief failed. The phases below are the agreed way to
fix that, in order, with a checkpoint review after each group. Ground rules:
no claim without a harness number, never break determinism, the engine stays
pure, fix root causes rather than loosening the validator, one phase per commit
series with before/after numbers recorded in [PROGRESS.md](PROGRESS.md).

| Phase | Work | Status |
|---|---|---|
| 0 | Stress harness, real tests, `npm test` | **Done** |
| 1 | Door rules: allowed pairs, capacity enforced in placement, entry fallback, window feasibility in ranking | **Written, not merged** — the rules are right but the gate is not green |
| 2.1 | Hall spine too rigid: pick the spine direction, make the hall optional | **Done** — hall is now tried only when the door rules need it |
| 2.2 | `effort` not propagated into the recursive splits | **Done** (fixed as part of 2.1 work) |
| 2.3 | Repair pass for min-width violations | Pending |
| 2.4 | Infeasible briefs must say so | **Done** — `plan.infeasible` with a plain reason |
| 3 | Geometry honesty: clear vs centreline sizes, front/back convention, stronger `validate()`, merge collinear walls | Pending |
| 4 | Performance: rank cheap first, build walls/doors for the top K only, Web Worker in the UI | Pending — **next**, it gates Phase 1 |
| 5 | Hygiene: README/PLAN/PROGRESS honesty, LICENSE, dead code, `noUnusedLocals`, CI | Partly done (README, dead code below) |
| 6 | Real-world norms — needs the owner, not guesswork | Blocked on owner input |
| 7 | Stage 8 features, with the audit briefs as regression cases | Pending |

Checkpoints: **1** = Phase 0, then 2.1 and 2.4, then Phase 1. **2** = the rest of
Phase 2, then Phase 3. **3** = Phases 4 and 5. Harness output is reviewed at each.

The gate for Phase 1 is 1BHK and 3BHK at 7/8 seeds or better at the preview
settings (60 attempts, effort 0.6). It is not met. Enforcing door capacity shrank
the share of legal layouts enough that 60 attempts no longer samples it: 2BHK
scores 6/8 at 60 attempts and 8/8 at 150 with identical code. That points at
Phase 4 rather than at the door rules.

## Open decisions

- **Performance.** 120 attempts at effort 0.5 takes about 15 s; full effort at
  150 attempts takes about 29 s. The effort knob trades quality for latency but
  does not remove the cost. The real fix is to rank candidates on shape first and
  derive walls and doors only for the top few.
- **Licence.** The repository is public and has no `LICENSE` file, which leaves
  it all-rights-reserved by default. Pick one before inviting use.
- **Zone-first split.** Marson & Musse squarify *zones* (social / service /
  private) first, then squarify rooms inside each zone. It is implemented in
  `subdivide.ts` behind `SplitMode = 'zoned'` and defaulted off: constraining the
  layout into three blocks measured worse on shape. Revisit only with a better
  zone-level cut.
- **Hall depth.** `HALL_DEPTH` is 1.2 m and is a plausible value, not a verified
  norm. Rooms shrink about 10% to pay for the corridor, so this number is a real
  trade against target areas.
- Room defaults in `brief.ts` and the allowed-pair table are plausible starting
  values, **not** verified building norms. Check against the applicable local
  rules before trusting them.
- Whether the UI renders SVG or draws to canvas — SVG for now, since it is
  exportable as-is.

## Conventions

- No new runtime dependency without a licence check.
- The engine stays free of DOM and I/O.
- `validate()` always runs; violations are returned, never thrown.
- Commit messages describe behaviour, not files.
