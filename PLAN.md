# Floorplan Generator — plan

A constraint-driven 2D floor-plan generator. You describe the plot and the room
programme; it produces a layout, walls, windows and an SVG sheet.

## Scope

In: rectangular plots, setbacks, rooms with target areas and minimum dimensions,
interior/exterior walls, windows on exterior walls, SVG output.

Not in (for now): L-shaped or irregular plots, corridors, doors, staircases,
furniture, 3D, PDF/DXF export, any server-side component.

## Architecture

The engine is pure TypeScript — no DOM, no React, no dependencies, no I/O. It
takes a `Brief` and returns a `Plan`. That is what makes it testable headlessly
and portable to the browser unchanged.

```
engine/src/geometry.ts    rect maths, shared edges, boundary tests
engine/src/brief.ts       Brief/Room types, room defaults, area normalisation
engine/src/subdivide.ts   seeded recursive partitioner
engine/src/score.ts       layout scoring + reachability
engine/src/walls.ts       interior walls from shared edges, exterior from leftovers
engine/src/windows.ts     window placement on exterior walls only
engine/src/validate.ts    rule checks, returns a list of violations
engine/src/render-svg.ts  Plan -> SVG string
engine/src/index.ts       generate(brief, seed, attempts)
demo.ts                   CLI: writes out/plan.svg
```

The React UI (not built yet) will live in `ui/` and import the engine directly.

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
2. **Partition**: recursively split the footprint rectangle by its longer axis.
   The split ratio is the area share of the rooms on one side, so every room
   lands on its target area *exactly*. The only freedom is *which* rooms go
   where — and that is what the search optimises.
3. **Score** each candidate: aspect ratio, minimum dimensions, daylight rooms
   touching the boundary, preferred adjacencies (living–dining, dining–kitchen,
   living–bedroom, bedroom–bath), and reachability from the living room.
4. **Keep the best** of N seeded candidates.
5. **Derive** walls, then windows, then validate.

Same seed + same brief = same plan. Never break that; it is what makes the
engine tunable.

## Roadmap

| Stage | Work | Done when |
|---|---|---|
| 0 | Geometry, brief, partitioner | Rooms fill the footprint exactly, tests pass |
| 1 | Scoring + seeded search | Best-of-N beats a random candidate on every metric |
| 2 | Walls | Interior from shared edges, exterior from uncovered leftovers |
| 3 | Windows | Only on exterior walls, every daylight room covered |
| 4 | Validator | Returns violations, never throws |
| 5 | SVG renderer | Readable plan sheet with labels and dimensions |
| 6 | Doors | Adjacency graph, spanning tree from entry, doors on shared segments |
| 7 | React UI | Form + live preview, engine imported directly |
| 8 | Export + presets | SVG/JSON download, 1BHK/2BHK/3BHK presets, seed control |

Stages 0–5 are done. 6 onwards is the remaining work.

## Open decisions

- Corridors: v0 connects rooms directly through shared walls. Adding a corridor
  changes the partitioner, so decide before stage 6.
- Room defaults in `brief.ts` are plausible starting values, **not** verified
  building norms. Check against the applicable local rules before trusting them.
- Whether the UI renders SVG or draws to canvas — SVG for now, since it is
  exportable as-is.

## Conventions

- No new runtime dependency without a licence check.
- The engine stays free of DOM and I/O.
- `validate()` always runs; violations are returned, never thrown.
- Commit messages describe behaviour, not files.
