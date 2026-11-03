# Floorplan Generator — plan

A constraint-driven 2D floor-plan generator and editor for Indian residential
work. You describe the plot and the room programme; it lays out rooms, walls,
doors, windows and furniture, and you refine the result by hand, check it
against NBC 2016 and export it.

## Scope

In: rectangular plots with setbacks; rooms with target areas and minimum widths,
rectangular or L-shaped; interior and exterior walls, doors, windows,
furniture; a drag-and-drop editor with undo and JSON save/load; dimension
lines; an area schedule; an NBC 2016 code check; SVG, DXF and scaled-PDF
export. Everything runs in the browser; no server.

Not in (for now): irregular plots, more than one storey, 3D, AI or learned
models of any kind (an owner decision: the algorithm itself should design).

## Architecture

The engine is pure TypeScript — no DOM, no React, no dependencies, no I/O. It
takes a `Brief` and returns a `Plan`, and every edit is a pure function from
plan to plan. That keeps it testable headlessly and portable to the browser.

```
engine/src/geometry.ts    rect maths, shared edges, boundary tests
engine/src/brief.ts       Brief/Room types, room defaults, zones, adjacency rules
engine/src/subdivide.ts   'split' layout: seeded partitioner, hall spine
engine/src/grid.ts        'grid' layout: grid growth + annealing; L-shaped rooms
engine/src/shape.ts       rooms as unions of rectangles: shared edges, min width
engine/src/score.ts       layout scoring + reachability
engine/src/walls.ts       interior walls from shared edges, exterior from leftovers
engine/src/windows.ts     window placement on exterior walls, clear of doors
engine/src/doors.ts       bath roles, door pairs, openings, door reachability
engine/src/validate.ts    rule checks, returns a list of violations
engine/src/furniture.ts   furniture: per-room beam search, symbols as primitives
engine/src/edit.ts        pure edit operations behind the UI editor
engine/src/schedule.ts    area schedule: carpet, built-up, coverage, FAR
engine/src/compliance.ts  NBC 2016 checks, bye-law limits, window fix
engine/src/dxf.ts         AutoCAD R12 DXF in millimetres
engine/src/render-svg.ts  Plan -> SVG sheet, dimension chains, door swings
engine/src/index.ts       generate(brief, seed, attempts, effort, layout)
demo.ts                   CLI: writes out/plan.svg
tools/stress.ts           six-brief stress harness
ui/                       Vite + React + TypeScript, imports the engine directly
```

The UI imports `engine/src` with no copy and no build step. The engine's
imports carry `.js` extensions for `module: NodeNext`, which Node resolves and
Vite does not, so `ui/vite.config.ts` maps `./foo.js` onto `./foo.ts`. Keep
that plugin.

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

`normaliseAreas` scales target areas so the programme exactly fills the
buildable footprint, so the form never has to add up.

## How generation works

1. **Footprint** = plot minus setbacks. Briefs that cannot fit say so
   (`plan.infeasible`) before any search.
2. **Layout**, one of two:
   - `grid` (UI default): rooms grow from seed cells on a 0.3 m grid,
     rectangular then L-shaped, then simulated annealing over cell and
     whole-wall moves (Lopes et al. 2010; Merrell et al. 2010).
   - `split`: recursive area-exact partition around a hall spine
     (Marson & Musse 2010).
3. **Rank** seeded candidates cheaply, refine the best, then build walls,
   doors and windows and rank on real validation.
4. A plan without a hall is tried first; the hall is added only when the door
   rules need it.
5. **Furnish** each room (beam search over positions, scored on clearances,
   room rules and walkways from the door).

Same seed + same brief = same plan. Never break that.

Doors follow Marson & Musse: a door only between allowed room-type pairs; one
common bath, every other bath en suite; one door per bath; reachability
checked through doors, not shared walls.

## Done

| Area | What exists |
|---|---|
| Engine | Both layouts, walls, doors, windows, validation, infeasible briefs, stress harness |
| Furniture | Researched clearances; beam search; Re-furnish cycles good alternatives |
| Editor | Drag furniture, doors, windows, interior walls; typed sizes; undo; save/load |
| Drawing | Dimension chains, door swings, scaled sheet |
| Pain points | Area schedule + CSV; NBC 2016 code check with window fix; DXF / SVG / PDF export |

Also done: plot orientation (road side, north arrow, entry on the road,
front/back fixed) and an optional Vastu mode with a report panel — item 1
below. Vastu gains are modest; see PROGRESS.md. Lock rooms and regenerate
the rest — item 2.

Dropped by the owner (03/11/2026): side-by-side options with named versions,
and the brief-adherence report.

## Next up: variety without losing professionalism (agreed 03/11/2026)

Owner feedback: the same plot (10 × 15 m) gives the same pattern again and
again, and "Regenerate rest" reorganises the unlocked rooms rather than
reshaping them — and sometimes barely changes them.

Why: the same seed gives the same plan by design, and even different seeds
converge because the search keeps the single best-scoring candidate, which
for one plot and programme is nearly always the same arrangement (living on
the road, baths at the back, bedrooms down one side). Regenerate grows the
unlocked rooms from scratch, so it shuffles them; where the locked rooms
leave a tight space only one arrangement fits.

Principle: variety comes from architectural choices, not randomness. Every
variant must be a distinct, defensible plan that passes every check.

| # | Work | Size |
|---|---|---|
| V1 | **Quality gate and "Next variant".** Only plans that validate, keep the entry on the road and score within ~10–15 % of the best qualify. The best is shown first; "Next variant" shows the qualifying plan most different from those already seen (distance by where each room sits), like Re-furnish. Undoable; reproducible from seed + variant index. | S |
| V2 | **Reshape mode for "Regenerate rest".** Two modes: *Reshuffle* (today: a new arrangement of the unlocked rooms) and *Reshape* (keep the arrangement, move walls: start from the current plan on the grid and anneal with locked rooms fixed, steered away from the current shapes, valid plans only). Reshape suits late refinement, reshuffle early exploration. | M |
| V3 | **Layout types.** Named partis an architect would recognise, each steering seeds and adding a few score terms: *linear* (living at the road, dining and kitchen in the middle, bedrooms at the back), *central living*, *split bedrooms* (master apart from the others), *side corridor* (narrow plots), *service core* (kitchen, baths and utility on one side). The plan is labelled with its type, so it can be explained to a client. Same seed + type = same plan. | M–L |

Order: V1, V2, V3. Then the functionality items below, from item 3.

## Next: functionality (researched 03/11/2026)

Focus is the generator and the design workflow, not presentation. In order:

| # | Work | Why | Size |
|---|---|---|---|
| 1 ✓ | **Plot orientation and Vastu.** North arrow and road side in the brief; the entry faces the road. Optional Vastu mode as scored preferences plus a check panel: kitchen south-east, master bedroom south-west, entrance north / east / north-east, no toilet in the north-east. | Indian clients ask for it on almost every house; the generator has no notion of direction today | M |
| 2 ✓ | **Lock rooms and regenerate the rest.** Lock (or hand-edit) rooms; Generate keeps them and lays out only the others. Grid growth starts with locked cells taken. | Today Generate throws away every hand edit; commercial tools (A-Space) work this way | M |
| 3 | **Indian room types.** Pooja, balcony / sit-out, car porch, wash area by the kitchen, store in the form. With sizes, adjacencies, Vastu zones and furniture. | The programme is too Western for Indian briefs | S–M |
| 4 | **Room-connection input.** The user says which rooms must connect (master ↔ its bath, kitchen ↔ dining); the generator must honour it, and says when it cannot. | Every serious tool and method takes an adjacency graph (Finch3D graph rules, GPLAN); ours is a fixed table | M |
| 5 | **Two storeys with a stair.** G+1 is the common Indian house. Stair from NBC (riser ≤ 190 mm, tread ≥ 250 mm for one- or two-family dwellings, width 1.0 m — 0.9 m in some sources; confirm in the code text) aligned on both floors. | Most plots built today are G+1 | L |
| 6 | **A stronger layout core.** Either finish steps B–D of the grid generator (zones first, annealing on a full score, self-repair of failing rooms) or adopt a topology-then-dimensioning method: an adjacency graph to a rectangular dual, then a linear programme for sizes (GPLAN), or an MIQP layout (Wu et al. 2018). | 3BHK and narrow plots still fail validation on most seeds | L |

Also still open from earlier work:

- Code check: read the NBC text for the rules taken from secondary sources
  (light and ventilation, bath ventilator, kitchen width); state bye-law
  presets for setbacks, coverage and FAR; room heights once the brief has them.
- Geometry honesty: exterior walls arrive as collinear pieces; DXF walls
  overlap at junctions.
- Vastu mode can double generation time (it falls back to a plain plan when
  its own search fails); the Web Worker matters more now.
- Generation runs on the main thread (~7 s at preview settings); a Web
  Worker would stop the UI freezing.
- `npm test` fails on Windows (directory passed to `node --test`).

### Sources

- Layout methods: Wu, Fan, Liu, Wonka, *MIQP-based Layout Design for Building
  Interiors*, CGF 2018 ([paper](https://peterwonka.net/Publications/pdfs/2018.EG.Wenming.MIQPFloorplan.pdf));
  GPLAN and dimensioned rectangular floor plans ([summary](https://www.emergentmind.com/topics/gplan),
  [arXiv:1910.00081](https://arxiv.org/pdf/1910.00081)); Lopes et al. 2010;
  Merrell, Schkufza & Koltun 2010, doi:10.1145/1866158.1866203; Marson &
  Musse 2010, doi:10.1155/2010/624817.
- Workflow: [A-Space room locking](https://a-space.gitbook.io/a-space/product-guides/the-interface-guide);
  [Finch3D](https://finch3d.com) graph rules; [constraint-aware layout exploration](https://researchportal.bath.ac.uk/en/publications/constraint-aware-interior-layout-exploration-for-pre-cast-concret/).
- Vastu (blogs; they differ by facing, so rules are preferences, not law):
  [Coohom](https://www.coohom.com/article/vastu-principles-for-indian-house-floor-plans-what-homeowners-should-know),
  [NoBroker](https://www.nobroker.in/blog/home-plan-as-per-vastu-shastra),
  [Godrej](https://www.godrejproperties.com/blog/vastu-tips-home-directions-for-bedroom-kitchen-and-living-area).
- Stairs (secondary; confirm in NBC Part 4):
  [Houseyog](https://www.houseyog.com/blog/?p=2613),
  [Studio Matrx](https://www.studiomatrx.org/guides/staircase-design-india),
  [Infralens](https://infralens.in/handbook/staircase-design).
- NBC 2016 room sizes: [BIS guide to NBC 2016](https://www.bis.gov.in/wp-content/uploads/2022/08/Booklet-Guide-for-Using-NBC-2016.pdf), Part 3 cl. 12.
- Furniture clearances: [Homes & Gardens](https://www.homesandgardens.com/interior-design/bedrooms/an-expert-guide-to-bedroom-clearances-measurements-and-spacing),
  [Arcedior](https://arcedior.com/blog/chair-clearance-behind-dining-tables),
  [Houzz](https://www.houzz.com.sg/ideabooks/109239110),
  [kitchen work triangle](https://en.wikipedia.org/wiki/Kitchen_work_triangle),
  [constrained furniture layouts](https://arxiv.org/pdf/1711.10939).
- Architect pain points (vendor blogs and reviews, directional only):
  [Snaptrude](https://www.snaptrude.com/blog/best-residential-architecture-software-2026),
  [CHI 2025 survey](https://generativeaiandhci.github.io/papers/2025/genaichi2025_6.pdf),
  [Kispo](https://www.kispo.ai/blog/ai-floor-plan-generator-architects-guide).

## Open decisions

- **Licence.** The repository is public with no `LICENSE`, so it is
  all-rights-reserved by default. Pick one before inviting use.
- **Vastu strictness.** Preferences that bias the generator, or rules the
  check panel fails on? Default: preferences, reported as a score.
- **Layout core (item 6).** Finish the grid generator, or replace it with a
  graph-first method. Decide after items 1–4, measured on the stress harness.
- **Variant threshold (V1).** How far below the best a variant may score
  (start at 10–15 %) — set by measuring on the stress harness.
- Room defaults in `brief.ts`, `HALL_DEPTH` and the allowed-pair table are
  plausible values, not verified norms.

## Conventions

- No claim without a harness number; record before/after in PROGRESS.md.
- Never break determinism. The engine stays pure. `validate()` never throws.
- Fix root causes rather than loosening the validator.
- No new runtime dependency without a licence check.
- Commit messages describe behaviour, not files.
