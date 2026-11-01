# Progress

Last updated: 01/11/2026

## Where things stand

Stages 0–6 of PLAN.md are done. The engine generates a plan end to end — rooms,
walls, windows, doors — and renders an SVG. There is no UI yet.

Sample run: 10×15 m plot, 1.5 m setbacks all round → 7×12 m buildable
footprint, 9 rooms (8 plus the hall), 28 wall segments (14 exterior), 7 windows,
9 doors, validation clean, score −24.11 at seed 7 with 150 attempts.

Scores are only comparable between runs of the same scoring function. Compare
physical metrics instead, as in the table below.

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
full buildable width, 1.2 m deep (`HALL_DEPTH`), at a position the search picks.
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

## Known problems

- **Generation got slow.** 150 attempts takes about 32 s, because the spine
search partitions two blocks per candidate and every candidate now builds walls
and doors so the ranking can score real door feasibility. 600 attempts is no
longer usable. The fix is to rank on shape first and derive walls and doors only
for the top few candidates.
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
- The comparison harness that produced the table above is not in the repo. It
should be, before the next scoring change.

## Rejected: zone-first split

Marson & Musse partition into social / service / private zones first, then
squarify each zone. It is implemented in `subdivide.ts` behind
`SplitMode = 'zoned'` and defaulted off, because it measured worse on shape:
constraining the layout into three blocks forces long rooms and cost a min-width
violation. The paper itself notes that the initial zone split can leave rooms
far from square. Keep it available; do not make it the default without a better
zone-level cut.

## Next task

Stage 7 — the React UI: form plus live preview, engine imported directly. Worth
running the performance fix above first, since 32 s per plan will not feel good
in a browser.

## How to run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js      # writes out/plan.svg
```

Note: `npx tsx` does not work in the build sandbox (WASM out of memory); compile
with `tsc` and run the emitted JS.
