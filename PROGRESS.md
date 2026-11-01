# Progress

Last updated: 01/11/2026

## Where things stand

Stages 0–7 of PLAN.md are done. The engine generates a plan end to end — rooms,
walls, windows, doors — renders an SVG, and the React UI in `ui/` imports the
engine directly with a live preview.

Sample run: 10×15 m plot, 1.5 m setbacks all round → 7×12 m buildable
footprint, 9 rooms (8 plus the hall), 28 wall segments (14 exterior), 7 windows,
9 doors, validation clean, score −24.11 at seed 7 with 120 attempts and effort
0.5, in about 15 s.

Scores are only comparable between runs of the same scoring function. Compare
physical metrics instead, as in the table below.

## Speed

Generation is the expensive part, and it is now tunable: `generate(brief, seed,
attempts, effort)`. Effort scales the spine search and the split search together.

| attempts | effort | time | notes |
|---|---|---|---|
| 150 | 1.0 | ~29 s | the old default, no longer used |
| 120 | 0.5 | ~15 s | `demo.ts` default |
| 40 | 0.35 | ~4 s | UI preview; can return a plan with a min-width violation |

The preview deliberately trades search depth for latency. A low-effort run is a
valid plan or a plan with a reported violation — never a silent bad plan — but it
does mean the UI sometimes shows a problem the CLI would have searched past.

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
  full buildable width, `HALL_DEPTH` (1.2 m) deep, at a position the search picks.
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
- **React UI** (`ui/`). Vite + React + TypeScript. The engine's imports carry
  `.js` extensions for NodeNext, so `vite.config.ts` has a small resolver mapping
  `./foo.js` onto `./foo.ts` — that is what lets the UI import the engine with no
  copy and no build step between them. Form for plot, setbacks, wall and window
  sizes, room counts, seed and attempts; debounced preview; violations listed.

## Known problems

- Full-effort generation is still slow: ~15 s at 120 attempts, ~29 s at 150.
  Ranking on shape first and deriving walls and doors only for the top few
  candidates is the real fix; the effort knob only masks it.
- The UI preview can show a min-width violation at 40 attempts / 0.35 effort.
  Raising the default attempts would hide it at the cost of latency.
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
- The comparison harness that produced the splitter table is not in the repo. It
  should be, before the next scoring change.
- No `LICENSE` file, and the repo is now public. Add one before inviting anyone
  to use it.

## Rejected: zone-first split

Marson & Musse partition into social / service / private zones first, then
squarify each zone. It is implemented in `subdivide.ts` behind
`SplitMode = 'zoned'` and defaulted off, because it measured worse on shape:
constraining the layout into three blocks forces long rooms and cost a min-width
violation. The paper itself notes that the initial zone split can leave rooms
far from square. Keep it available; do not make it the default without a better
zone-level cut.

## Next task

Stage 8 — export and presets: SVG/JSON download, 1BHK/2BHK/3BHK presets, seed
control in the UI. The performance fix above should come before or with it.

## How to run

```
npm install
npx tsc -p tsconfig.json
node dist/demo.js            # seed 7, 120 attempts, effort 0.5
node dist/demo.js 7 40 0.35  # seed, attempts, effort — writes out/plan.svg
```

The UI:

```
cd ui
npm install
npm run dev
```

Note: `npx tsx` and `vite build` do not work in the build sandbox (WASM out of
memory); compile with `tsc` and run the emitted JS.
