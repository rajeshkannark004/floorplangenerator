# Progress

Last updated: 01/11/2026

## Where things stand

Stage 0–5 of PLAN.md are done. The engine generates a plan end to end and
renders an SVG. There is no UI and there are no doors yet.

Sample run: 10×15 m plot, 1.5 m setbacks all round → 7×12 m buildable
footprint, 8 rooms, 25 wall segments (12 exterior), 7 windows, validation clean,
score −9.22 at seed 7 with 600 attempts.

That score is **not** comparable to the −11.82 recorded before the aspect
penalty was retuned — the scale changed, not the plan quality. Compare physical
metrics instead, as in the table below.

## Splitter measurements

25 seeds × 300 attempts on the sample brief, same harness for all three runs.

| splitter | avg max aspect | avg mean aspect | rooms >1.8 | rooms >2.0 | min-width fails |
|---|---|---|---|---|---|
| baseline (longer axis only, blocks scored) | 2.10 | 1.41 | 1.0 | 1.0 | 0 |
| zone-first, per Marson & Musse | 2.25 | 1.70 | 4.0 | 1.0 | 1.0 |
| **current** (both axes, finished rooms only) | **1.89** | 1.54 | 2.0 | **0.0** | 0 |

The current splitter is worse than baseline on mean aspect (1.54 vs 1.41) and
slightly worse on rooms over 1.8. That is deliberate: the trade buys the end of
unusable rooms. Baseline produced a room over 2.0 in *every* plan; current
produces none, and validation now comes back clean.

## What works

- Area-exact partition: every room hits its target area, footprint fully tiled.
- Seeded and deterministic: same seed and brief always give the same plan.
- Cut search tries both axes, not only the longer one.
- Cut cost scores *finished* rooms on shape and only stops intermediate blocks
going pathological. Scoring every intermediate region was what forced baths to
3.5×1.4 m — the splitter was avoiding the thin strip a bath actually wants.
- Walls derived from room edges — interior where rooms touch, exterior where
  the edge is uncovered.
- Windows only on exterior walls; every daylight room gets at least one.
- `validate()` reports coverage, minimum dimensions, unreachable rooms and
  daylight rooms without windows.

## Known problems

- Aspect ratio is better but not solved. On the sample, Living still comes out
  3.3×5.9 m. Exact-area rectangles tiling a fixed footprint have limited
  freedom; squarify is the next lever, not the penalty weight.
- No doors, so "reachable" currently means "shares a wall", not "you can walk
  through a doorway".
- Exterior wall segments are emitted per room, so a straight run along the plot
  boundary can arrive as several collinear segments. Rendering is fine; a
  future DXF export will want them merged.
- The comparison harness that produced the table above is not in the repo. It
  should be, before the next scoring change.

## Rejected: zone-first split

Marson & Musse partition into social / service / private zones first, then
squarify each zone. It is implemented in `subdivide.ts` behind
`SplitMode = 'zoned'` and defaulted off, because it measured worse on shape:
constraining the layout into three blocks forces long rooms (bedrooms came out
5.25×2.78 m) and cost one min-width violation. The paper itself notes that the
initial zone split can leave rooms far from square. Keep it available; do not
make it the default without a better zone-level cut.

## Next task

Stage 6 — doors, per the design in PLAN.md: allowed-adjacency table, doors on
allowed shared segments, connectivity from the entry, corridor as the fallback
for rooms still unreachable.

## How to run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js      # writes out/plan.svg
```

Note: `npx tsx` does not work in the build sandbox (WASM out of memory); compile
with `tsc` and run the emitted JS.
