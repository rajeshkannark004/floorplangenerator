# Floorplan generator

Constraint-driven 2D floor-plan generator. Give it a plot, setbacks and a room
programme; it lays out rooms, walls and windows and renders an SVG.

The engine is pure TypeScript with no DOM and no dependencies, so it runs the
same in the browser and in Node.

## Status

v0 — rooms, walls, windows. Doors and the React UI are not built yet.

## Run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js      # writes out/plan.svg
```

## How it works

1. `brief.ts` — normalises the room programme so target areas exactly fill the
   buildable footprint.
2. `subdivide.ts` — recursively splits the footprint; each split's ratio equals
   the area share of the rooms on one side, so rooms land on their target areas
   exactly. Only *which* rooms go where is free.
3. `score.ts` — ranks candidates on aspect ratio, minimum dimensions, daylight
   access, preferred adjacencies and reachability.
4. `index.ts` — generates N seeded candidates, keeps the best, then derives
   walls and windows.

Same seed plus same brief always produces the same plan.
