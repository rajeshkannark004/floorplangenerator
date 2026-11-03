# Floorplan generator

Constraint-driven 2D floor-plan generator. Give it a plot, setbacks and a room
programme; it lays out rooms, a circulation hall, walls, doors, windows and
furniture, renders an SVG sheet, and lets you edit the result by drag and drop.

The engine is pure TypeScript — no DOM, no I/O, no runtime dependencies — so it
runs the same in Node and in the browser. The React UI imports it directly.

## Status

Rooms, hall, walls, windows, doors, furniture, an SVG sheet and a drag-and-drop
editor all work, and the 2BHK demo brief validates clean. **It is not yet robust**: most
other briefs fail the validator, which is what the audit plan in
[PLAN.md](PLAN.md) is working through. [PROGRESS.md](PROGRESS.md) carries the
measured numbers rather than claims.

## Run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js            # seed 7, 120 attempts, effort 0.5 -> out/plan.svg
node dist/demo.js 7 40 0.35  # seed, attempts, effort
```

## Test

```
npm test      # compile, then 22 tests on node:test
              # on Windows: npx tsc -p tsconfig.json && node --test dist/tests/engine.test.js
npm run stress  # the six-brief stress harness
```

The harness runs each brief across seeds 1–8 and reports how many plans
validate, average time, and a tally of every distinct validation message:

```
node dist/tools/stress.js --mode=preview --briefs=0,1,2
node dist/tools/stress.js --seeds=1,2,3,4 --briefs=2
node dist/tools/stress.js --report
```

Results accumulate per seed in `stress-results.json` (gitignored), so a slow
run can be split across invocations.

## UI

```
cd ui
npm install
npm run dev
```

A form for plot, setbacks, wall and window sizes, room counts, seed, attempts
and layout; press Generate. The plan is then editable:

- drag furniture (R rotates, Del deletes; red means it clashes)
- slide doors and windows along their wall, drag their end dots to resize
- drag an interior wall to resize the rooms either side
- select a wall to type the room size either side; select a door or window to
  type its width
- Re-furnish: each click shows the next good furniture arrangement
- Undo / Redo (Ctrl+Z / Ctrl+Y), Save / Load as JSON
- export DXF (millimetres, for AutoCAD and other CAD tools), SVG, or print to
  scale (1:50 / 1:100 / 1:200) and save as PDF

Dimension lines run round the plan and update as you edit. Under the sheet:
validation problems, and an area schedule (carpet and built-up area in m² and
sq ft, ground coverage, FAR) with CSV download.

## How it works

1. `brief.ts` — normalises the room programme so target areas fill the buildable
   footprint, and holds the room defaults, zones and allowed door pairs.
2. `subdivide.ts` — places the hall as a spine across the footprint, then
   partitions the rooms into the blocks either side of it. Each split's ratio is
   the area share of the rooms on one side, so rooms land on their target areas
   exactly; only *which* rooms go where is free.
3. `score.ts` — ranks candidates on aspect ratio, minimum dimensions, daylight
   access, preferred adjacencies and hall adjacency.
4. `index.ts` — generates N seeded candidates, keeps the best, then derives
   walls, doors and windows.
5. `validate.ts` — reports coverage, minimum dimensions, unreachable rooms, door
   capacity, missing entry, and windows against the spec.
6. `furniture.ts` — furnishes each room with a beam search over positions,
   scored on clearances, room-specific rules and walkways from the door.
7. `edit.ts` — the pure edit operations behind the UI editor.
8. `schedule.ts` and `dxf.ts` — the area schedule and the DXF export.

Same seed plus same brief always produces the same plan.

## Known limits

- Most briefs other than the 2BHK demo fail validation today. See
  [PROGRESS.md](PROGRESS.md) for the per-brief numbers.
- Generation is slow: roughly 15 s for 120 attempts. The UI preview runs fewer
  attempts at lower effort and can surface violations the CLI would search past.
- `HALL_DEPTH`, the room defaults and the furniture clearances are plausible
  values, **not** verified building norms. Indian norms (NBC 2016) are next.
- No licence file yet.
