# Progress

Last updated: 01/11/2026

## Where things stand

Stage 0–5 of PLAN.md are done. The engine generates a plan end to end and
renders an SVG. There is no UI and there are no doors yet.

Sample run: 10×15 m plot, 1.5 m setbacks all round → 7×12 m buildable
footprint, 8 rooms, 25 wall segments (12 exterior), 7 windows, validation clean,
score −11.82 at seed 7 with 600 attempts.

## What works

- Area-exact partition: every room hits its target area, footprint fully tiled.
- Seeded and deterministic: same seed and brief always give the same plan.
- Walls derived from room edges — interior where rooms touch, exterior where
  the edge is uncovered.
- Windows only on exterior walls; every daylight room gets at least one.
- `validate()` reports coverage, minimum dimensions, unreachable rooms and
  daylight rooms without windows.

## Known problems

- Aspect ratio is under-punished. On the sample, Living came out 3.3×5.9 m and
  Bath-2 3.2×1.5 m — both too elongated. The weight in `score.ts` needs raising
  or the penalty made quadratic in the excess.
- The splitter picks the longer axis unconditionally; it never tries the other
  axis, so some candidate space is never explored.
- No doors, so "reachable" currently means "shares a wall", not "you can walk
  through a doorway".
- Exterior wall segments are emitted per room, so a straight run along the plot
  boundary can arrive as several collinear segments. Rendering is fine; a
  future DXF export will want them merged.

## Next task

Stage 6 — doors. Build the room adjacency graph from shared wall segments, take
a spanning tree from the living room so circulation is a tree rather than a
free-for-all, and place each door centred on its shared segment with clearance
from the corners.

## How to run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js      # writes out/plan.svg
```

Note: `npx tsx` does not work in the build sandbox (WASM out of memory); compile
with `tsc` and run the emitted JS.
