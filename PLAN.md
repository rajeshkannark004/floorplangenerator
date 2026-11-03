# Floorplan Generator — plan

A constraint-driven 2D floor-plan generator. You describe the plot and the room
programme; it produces a layout, walls, windows, doors and an SVG sheet.

## Scope

In: rectangular plots, setbacks, rooms with target areas and minimum dimensions,
interior/exterior walls, windows on exterior walls, one straight circulation hall
spanning the buildable width, interior doors and an entry door, SVG output, a
browser UI with a live preview.

Also in (since 03/11/2026): furniture, and hand editing of the generated plan
(furniture, doors, windows, interior walls) with undo and JSON save/load.

Not in (for now): L-shaped or irregular plots, corridors that turn or branch,
staircases, 3D, any server-side component. PDF/DXF export is now planned; see
*Architect pain points*.

## Architecture

The engine is pure TypeScript — no DOM, no React, no dependencies, no I/O. It
takes a `Brief` and returns a `Plan`. That is what makes it testable headlessly
and portable to the browser unchanged.

```
engine/src/geometry.ts    rect maths, shared edges, boundary tests
engine/src/brief.ts       Brief/Room types, room defaults, zones, adjacency rules
engine/src/subdivide.ts   seeded partitioner, hall spine placement
engine/src/grid.ts        grid growth + annealing; rooms can be L-shaped
engine/src/shape.ts       rooms as unions of rectangles: shared edges, min width
engine/src/score.ts       layout scoring + reachability
engine/src/walls.ts       interior walls from shared edges, exterior from leftovers
engine/src/windows.ts     window placement on exterior walls, clear of doors
engine/src/doors.ts       bath roles, door pairs, openings, door reachability
engine/src/validate.ts    rule checks, returns a list of violations
engine/src/furniture.ts   furniture placement (beam search) and symbols
engine/src/edit.ts        pure edit operations used by the UI editor
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
| 9 | Furniture | Every room type furnished, clear of door swings, reachable from the door |
| 10 | Editor | Drag furniture, openings and walls; undo; save/load |

Stages 0–7, 9 and 10 are done; stage 8 has JSON save/load only. Stage 8 is the remaining feature work, but it is blocked
behind the audit plan below — the engine only works reliably on the demo brief.
The layout step itself is being replaced; see *Next direction* below.

Since stage 7 the UI generates only when the Generate button is pressed, not on
every field change.

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
| 2.3 | Repair pass for min-width violations | Folded into step D of the new direction below |
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

## Next direction: an architect-style generator (agreed 02/11/2026)

The plans read as templates. The cause is the splitter: it only ever slices a
rectangle into smaller rectangles, so every plan is a treemap with a straight
hall strip through it. The owner wants the algorithm itself to design like an
architect — **no AI, no learned model, no dataset** — and to be as intelligent
as possible when a plan has problems: it should find and fix them itself, not
hand back a broken plan with a list of violations.

The replacement keeps walls, doors, windows, validation and the seeded rng.
Only the layout step changes.

| Step | Work | Source |
|---|---|---|
| A | **Grid growth.** Rooms start from seed cells and grow cell by cell towards their target area, rectangular first and L-shaped when that fits better. Replaces `partition` and `spine`. | Lopes et al. (2010), *A Constrained Growth Method for Procedural Floor Plan Generation*, GAME-ON 2010 |
| B | **Zones first.** Social at the front with the entry, service at the side or back, private in its own wing. Seed cells are placed inside their zone. The hall grows only where it has to join the zones. | Marson & Musse (2010); Mirahmadi & Shami (2012), arXiv:1211.5842, for corridors |
| C | **Optimise.** Simulated annealing over seed positions, room swaps and wall shifts. A move is kept only if it improves a score covering shape, daylight, door flow, privacy, hall waste and target areas. | Merrell, Schkufza & Koltun (2010), *Computer-Generated Residential Building Layouts*, doi:10.1145/1866158.1866203 |
| D | **Self-repair.** When validation fails, targeted moves on the offending rooms (widen a narrow room, regrow an unreachable one next to circulation, move a daylight room onto the boundary) before giving up. A plan is only returned with problems when repair cannot find a fix, and it says which. | Replaces audit item 2.3 |

Status (02/11/2026): **A is in**, behind `layout = 'grid'`, with an early form
of C (annealing on the grid) because growth alone validated 0/8 on every
brief. Grid beats split on 1BHK, ties on 2BHK, trails on 3BHK; numbers in
PROGRESS.md.

Order: A first — it is what removes the boxy look — then B, C, D. Each step is
measured on the stress harness against the current splitter before it replaces
it. The old splitter stays selectable until the new one wins on every brief.

What this changes downstream:

- Rooms are no longer always rectangles. `Room.rect` becomes a list of cells or
  a rectilinear polygon; `sharedEdge`, `buildWalls`, `exteriorSegmentsOf`,
  door and window placement and the renderer must handle that.
- Area becomes grid-quantised. Grid size is a trade between precision and
  speed; start at 0.3 m and measure.
- Determinism still holds: every random choice comes from the seeded rng.

## Architect pain points (researched 03/11/2026)

From here on the work targets what slows architects down on a floor plan.
Caveat: no primary survey of architects turned up; the sources are vendor
blogs, academic reviews and contract samples, so read them as directional.

| # | Pain point | What we build | Size |
|---|---|---|---|
| 1 | A small change means redrawing (a moved wall ripples through the drawing); clients reject the first draft and each revision round costs hours | Partly solved by the editor. Next: live dimension lines, typed exact sizes | S |
| 2 | Revision loops and client indecision; contracts cap revisions at 2–3 | Several options side by side, compare, named versions | M |
| 3 | Code and zoning checks by hand; AI generators ignore codes | Live compliance panel against **Indian norms**: NBC 2016 room sizes and heights, light and ventilation (window area vs floor area), setbacks, ground coverage, FAR, as switchable rule packs per state bye-law | M–L |
| 4 | AI output is not editable or is raster, so it is redrawn in CAD | DXF export (AutoCAD and other CAD tools) and a scaled PDF (1:50 / 1:100); our output is already vector | S–M |
| 5 | Area schedules (carpet / built-up) done by hand | Automatic room schedule and totals, CSV export | S |
| 6 | Plumbing, electrical and structure ignored | Stack wet rooms, column grid, flag fixtures far from a wet wall | M |
| 7 | Generators skip parts of the brief or invent rooms | Brief-adherence report: asked vs delivered, and why | S |
| 8 | Professional tools are expensive or overkill for small practices | Free and in the browser already | — |

Order: quick wins first — 5, 1, 4 — then 3, then 2, then 6 and 7.

Status (03/11/2026): **5, 1 and 4 are done** — area schedule with CSV,
dimension chains with typed sizes, DXF / SVG / scaled-PDF export. **3 is
in**: NBC 2016 room sizes from the BIS guide (Part 3 cl. 12), light and
ventilation from secondary sources (labelled), bye-law limits as user input,
and a one-click window fix. Details and checks in PROGRESS.md. Next is 2.

Still open on 3: read the NBC text itself for the secondary-sourced rules;
state bye-law presets (setbacks, coverage, FAR by plot size); room heights
once the brief carries them.

The rule pack values for 3 must come from the code text (NBC 2016 Part 3 and
Part 8, and the state bye-law in use), not from secondary sources; each rule
carries its clause reference.

Sources: [Snaptrude, AI house plan generators](https://www.snaptrude.com/blog/ai-house-plan-generators-2025);
[Snaptrude, residential software](https://www.snaptrude.com/blog/best-residential-architecture-software-2026);
[DesignDrafter buyer's guide](https://designdrafter.com/how-to-choose-architecture-design-software-for-architects/);
[DesignDrafter, AI generators](https://designdrafter.com/how-ai-floor-plan-generators-are-revolutionizing-architectural-design-in-2026/);
[ArchPulse](https://www.archpulse.co/blog/ai-floor-plan-generator);
[Meltplan](https://www.meltplan.com/blogs/best-ai-to-generate-floor-plans);
[TECT, schematic design](https://www.tect.com/feeds/blog/luxury-home-schematic-design-architect);
[Law Insider, design clauses](https://www.lawinsider.com/clause/architectural-design);
[CHI 2025 GenAI floor-planning survey](https://generativeaiandhci.github.io/papers/2025/genaichi2025_6.pdf);
[comparative study of AI floor plan generators](https://www.researchgate.net/publication/404157015_Comparative_Analysis_of_AI-Based_Floor_Plan_Generators_in_Architectural_Design_Process);
[Gen-AI in building research, review](https://arxiv.org/pdf/2410.01098);
[Vizcraft](https://vizcraft.ai/blog/posts/ai-floor-plan-generator-guide-architects);
[AI tools architects should not trust blindly](https://www.amanzadegan.com/ai-tools-architects-should-not-trust-blindly/);
[Kispo](https://www.kispo.ai/blog/ai-floor-plan-generator-architects-guide);
[Homestyler](https://www.homestyler.com/article/trends/ai-floor-plan-generators-explained).

Furniture research (03/11/2026): clearances from
[Homes & Gardens](https://www.homesandgardens.com/interior-design/bedrooms/an-expert-guide-to-bedroom-clearances-measurements-and-spacing),
[Arcedior](https://arcedior.com/blog/chair-clearance-behind-dining-tables),
[Houzz](https://www.houzz.com.sg/ideabooks/109239110),
[kitchen work triangle (NKBA)](https://en.wikipedia.org/wiki/Kitchen_work_triangle);
search-and-score layout after
[Automatic Generation of Constrained Furniture Layouts](https://arxiv.org/pdf/1711.10939).

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
  layout into three blocks measured worse on shape. Zoning returns in step B of
  the new direction, as seed placement for grid growth rather than as a cut.
- **Phase 4 vs the new direction.** Phase 4 optimises the splitter that step A
  replaces. Decide whether to finish it first or fold its "rank cheap first"
  idea into step C.
- **Hall depth.** `HALL_DEPTH` is 1.2 m and is a plausible value, not a verified
  norm. Rooms shrink about 10% to pay for the corridor, so this number is a real
  trade against target areas.
- Room defaults in `brief.ts` and the allowed-pair table are plausible starting
  values, **not** verified building norms. Check against the applicable local
  rules before trusting them.
- Whether the UI renders SVG or draws to canvas — SVG, settled 03/11/2026:
  the editor overlays hit targets on the engine's SVG.
- **Which Indian rules.** NBC 2016 as the base; which state bye-law pack
  comes first is the owner's call.
- **Edits vs regeneration.** Today a hand edit is kept until the next Generate,
  which starts fresh. Locking edited rooms through a regenerate is open.

## Conventions

- No new runtime dependency without a licence check.
- The engine stays free of DOM and I/O.
- `validate()` always runs; violations are returned, never thrown.
- Commit messages describe behaviour, not files.
