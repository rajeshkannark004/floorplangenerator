import type { Rect } from './geometry.js';
import { type Room, type RoomType, HALL_DEPTH, ADJACENCY } from './brief.js';
import { allowedPair, DOOR_WIDTH, DOOR_CLEARANCE } from './doors.js';
import { type Compass, type VastuRole, vastuRoles, preferredDirection, zoneAt, verdict, VASTU_COST } from './orient.js';

export type Rng = () => number;

/** Cell size in metres: a trade between area precision and speed. */
export const GRID_CELL = 0.3;
/** Rectangular growth will not make a room longer than this, unless it is already worse. */
const MAX_ASPECT = 2;
/** Seeds sampled per room at full effort; the best-placed one wins. */
const SEED_SAMPLES = 48;
/** How far past its target a rectangle may grow to soak up a gap. */
const OVERGROW = 1.25;
/** Cell moves `growLayout` spends on local search at full effort. */
export const REFINE_MOVES = 2400;
/** Annealing temperature, in score points, at the start and end of the local search. */
const ANNEAL_START = 2;
const ANNEAL_END = 0.05;
/** Outside wall a daylight room needs for a window; matches windows.ts. */
const WINDOW_RUN = 1.2;
/** Fixed cost of any room narrower than its minimum width. */
const WIDTH_MISS = 40;
/** The shortest straight stretch of shared wall that can take a door. */
const DOOR_RUN = DOOR_WIDTH + 2 * DOOR_CLEARANCE;
/** Score per point of Vastu cost (see `VASTU_COST`): a room in an avoided zone costs about a bad shape. */
const VASTU_WEIGHT = 2;
/** Cost of a living room with no front wall long enough for the entry door. */
const NO_FRONT_ENTRY = 60;
/** The entry door's run: a 1.0 m door with its corner clearances. */
const ENTRY_RUN = 1.0 + 2 * DOOR_CLEARANCE;

/** Which way the plot faces, and whether to plan for Vastu. */
export interface Orient { facing: Compass; vastu: boolean }

interface Box { c0: number; r0: number; c1: number; r1: number }

/**
 * Seeding order. Living goes first as the hub; every later room then has a
 * room it may open onto already down, which is what lets its seed land next
 * to that room instead of anywhere.
 */
const SEED_ORDER: RoomType[] = ['living', 'dining', 'kitchen', 'bedroom', 'bath', 'utility', 'store', 'hall'];

/** Who a room may open onto. Baths and utilities follow doors.ts, not the pair table alone. */
function mayOpenOnto(a: RoomType, b: RoomType): boolean {
  if (allowedPair(a, b)) return true;
  const pair = (x: RoomType, y: RoomType) => (a === x && b === y) || (a === y && b === x);
  return pair('bath', 'living') || pair('bath', 'dining') || pair('utility', 'dining');
}

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The cells `o` adds to `b`, where `o` is `b` pushed out by one row or column. */
function strip(b: Box, o: Box): [number, number][] {
  const out: [number, number][] = [];
  if (o.c0 < b.c0) for (let r = b.r0; r < b.r1; r++) out.push([o.c0, r]);
  else if (o.c1 > b.c1) for (let r = b.r0; r < b.r1; r++) out.push([b.c1, r]);
  else if (o.r0 < b.r0) for (let c = b.c0; c < b.c1; c++) out.push([c, o.r0]);
  else for (let c = b.c0; c < b.c1; c++) out.push([c, b.r1]);
  return out;
}

/** A layout on the grid, before it is turned into rooms. */
export interface GridPlan {
  fp: Rect;
  cells: number[][];
  /** `gridScore` of the current state; lower is better. */
  score: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  owner: Int32Array;
  target: number[];
  rooms: Room[];
  hall: number;
  orient: Orient | null;
  /** Vastu role per room index, when planning for Vastu. */
  roles: VastuRole[] | null;
}

/**
 * The layout score, computed straight off the grid so a single cell move can
 * be judged without rebuilding rooms, walls and doors. Same terms as
 * `layoutScore` — shape, width, daylight, preferred neighbours, the hall — plus
 * the two things the splitter got for free: area, since growth is not
 * area-exact, and whether doors can join every room to the living room, which
 * needs a straight run of shared wall long enough to hold one.
 */
function gridScore(g: GridPlan): number {
  const { cols, rows, cw, ch, owner, target, rooms, hall } = g;
  const n = rooms.length;
  const count = new Array<number>(n).fill(0);
  const minC = new Array<number>(n).fill(Infinity);
  const maxC = new Array<number>(n).fill(-1);
  const minR = new Array<number>(n).fill(Infinity);
  const maxR = new Array<number>(n).fill(-1);
  // Longest straight run of outside wall: a window needs WINDOW_RUN of it,
  // not just a corner touching the boundary.
  const outside = new Array<number>(n).fill(0);
  // Longest run along the front (road) edge, the bottom row: where the entry goes.
  const front = new Array<number>(n).fill(0);
  const sumC = new Float64Array(n);
  const sumR = new Float64Array(n);
  const width = new Array<number>(n).fill(Infinity);
  const hrun = new Int32Array(cols * rows);
  const vrun = new Int32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; ) {
      const o = owner[r * cols + c];
      let e = c;
      while (e < cols && owner[r * cols + e] === o) e++;
      for (let m = c; m < e; m++) hrun[r * cols + m] = e - c;
      c = e;
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; ) {
      const o = owner[r * cols + c];
      let e = r;
      while (e < rows && owner[e * cols + c] === o) e++;
      for (let m = r; m < e; m++) vrun[m * cols + c] = e - r;
      r = e;
    }
  }
  for (let k = 0; k < owner.length; k++) {
    const o = owner[k];
    if (o < 0) continue;
    const c = k % cols;
    const r = (k - c) / cols;
    count[o]++;
    sumC[o] += c;
    sumR[o] += r;
    if (c < minC[o]) minC[o] = c;
    if (c > maxC[o]) maxC[o] = c;
    if (r < minR[o]) minR[o] = r;
    if (r > maxR[o]) maxR[o] = r;
    const w = Math.min(hrun[k] * cw, vrun[k] * ch);
    if (w < width[o]) width[o] = w;
  }

  const scanEdge = (len: number, cell: (t: number) => number, step: number) => {
    for (let t = 0; t < len; ) {
      const o = owner[cell(t)];
      let e = t;
      while (e < len && owner[cell(e)] === o) e++;
      if (o >= 0) outside[o] = Math.max(outside[o], (e - t) * step);
      t = e;
    }
  };
  scanEdge(cols, (t) => t, cw);
  scanEdge(cols, (t) => (rows - 1) * cols + t, cw);
  for (let t = 0; t < cols; ) {
    const o = owner[(rows - 1) * cols + t];
    let e = t;
    while (e < cols && owner[(rows - 1) * cols + e] === o) e++;
    if (o >= 0) front[o] = Math.max(front[o], (e - t) * cw);
    t = e;
  }
  scanEdge(rows, (t) => t * cols, ch);
  scanEdge(rows, (t) => t * cols + cols - 1, ch);

  // Longest straight run of wall each pair of rooms shares.
  const longest = new Float64Array(n * n);
  const note = (a: number, b: number, len: number) => {
    if (len > longest[a * n + b]) longest[a * n + b] = longest[b * n + a] = len;
  };
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c < cols; ) {
      const a = owner[r * cols + c];
      const b = owner[(r + 1) * cols + c];
      if (a === b || a < 0 || b < 0) { c++; continue; }
      let e = c;
      while (e < cols && owner[r * cols + e] === a && owner[(r + 1) * cols + e] === b) e++;
      note(a, b, (e - c) * cw);
      c = e;
    }
  }
  for (let c = 0; c + 1 < cols; c++) {
    for (let r = 0; r < rows; ) {
      const a = owner[r * cols + c];
      const b = owner[r * cols + c + 1];
      if (a === b || a < 0 || b < 0) { r++; continue; }
      let e = r;
      while (e < rows && owner[e * cols + c] === a && owner[e * cols + c + 1] === b) e++;
      note(a, b, (e - r) * ch);
      r = e;
    }
  }

  let s = 0;
  for (let o = 0; o < n; o++) {
    if (!count[o]) { s += 1000; continue; }
    const bw = maxC[o] - minC[o] + 1;
    const bh = maxR[o] - minR[o] + 1;
    const a = Math.max(bw * cw, bh * ch) / Math.min(bw * cw, bh * ch);
    if (o === hall) {
      s += Math.max(0, a - 5) ** 2 * 2;
    } else {
      s += Math.max(0, a - 1.5) ** 2 * 8;
      s += (1 - count[o] / (bw * bh)) * 6;
      s += (Math.abs(count[o] - target[o]) / target[o]) * 10;
    }
    // A miss is a validation failure however small, so it costs a fixed step
    // on top of the shortfall. On a 0.3 m grid most misses are one cell, and at
    // 150 per metre a 2.94 m living room cost less than a slightly odd shape.
    if (width[o] < rooms[o].minW - 1e-6) s += WIDTH_MISS + (rooms[o].minW - width[o]) * 150;
    if (rooms[o].daylight && outside[o] < WINDOW_RUN - 1e-6) s += outside[o] > 0 ? 20 : 26;
  }

  for (const [p, q] of ADJACENCY) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (rooms[i].type !== p) continue;
      for (let j = 0; j < n; j++) if (rooms[j].type === q) best = Math.max(best, longest[i * n + j]);
    }
    if (best >= 0) s += best >= 1.2 ? -3 : 1.5;
  }
  if (hall >= 0) for (let o = 0; o < n; o++) if (o !== hall) s += longest[o * n + hall] > 0 ? -4 : 3;

  // Walk from the living room through walls long enough for a door.
  const start = Math.max(0, rooms.findIndex((r) => r.type === 'living'));
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const a = queue.pop()!;
    // One-door rooms are dead ends: a path never runs on through a bath, a
    // utility or a store, and a bedroom leads only into its own bath.
    const from = rooms[a].type;
    if (from === 'bath' || from === 'utility' || from === 'store') continue;
    for (let b = 0; b < n; b++) {
      if (seen.has(b) || longest[a * n + b] < DOOR_RUN - 1e-6) continue;
      if (from === 'bedroom' && rooms[b].type !== 'bath') continue;
      if (!mayOpenOnto(from, rooms[b].type)) continue;
      seen.add(b);
      queue.push(b);
    }
  }
  s += (n - seen.size) * 60;

  if (g.orient) {
    // The entry faces the road, so the living room needs a front wall to take it.
    const living = rooms.findIndex((r) => r.type === 'living');
    if (living >= 0 && front[living] < ENTRY_RUN - 1e-6) s += NO_FRONT_ENTRY;
  }
  if (g.orient?.vastu && g.roles) {
    for (let o = 0; o < n; o++) {
      if (!count[o]) continue;
      const x = g.fp.x + (sumC[o] / count[o] + 0.5) * cw;
      const y = g.fp.y + (sumR[o] / count[o] + 0.5) * ch;
      s += VASTU_COST[verdict(g.roles[o], zoneAt(g.fp, g.orient.facing, x, y))] * VASTU_WEIGHT;
    }
  }
  return s;
}

/** Would room `o` stay in one piece without these cells? */
function connectedWithout(g: GridPlan, o: number, removed: number | Set<number>): boolean {
  const { cols, rows, cells } = g;
  const rest = cells[o].filter((x) => (typeof removed === 'number' ? x !== removed : !removed.has(x)));
  if (!rest.length) return false;
  const inRoom = new Set(rest);
  const seen = new Set([rest[0]]);
  const queue = [rest[0]];
  while (queue.length) {
    const x = queue.pop()!;
    const c = x % cols;
    const r = Math.floor(x / cols);
    for (const [dc, dr] of DIRS) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const y = rr * cols + cc;
      if (inRoom.has(y) && !seen.has(y)) {
        seen.add(y);
        queue.push(y);
      }
    }
  }
  return seen.size === rest.length;
}

/** Cell ids -> the fewest row-merged rectangles, in metres. */
function toParts(ids: number[], cols: number, fp: Rect, cw: number, ch: number): Rect[] {
  const xAt = (c: number) => fp.x + c * cw;
  const yAt = (r: number) => fp.y + r * ch;
  const byRow = new Map<number, number[]>();
  for (const k of ids) {
    const r = Math.floor(k / cols);
    let row = byRow.get(r);
    if (!row) byRow.set(r, (row = []));
    row.push(k % cols);
  }

  type Open = { c0: number; c1: number; r0: number };
  const out: Rect[] = [];
  const close = (o: Open, r1: number) =>
    out.push({ x: xAt(o.c0), y: yAt(o.r0), w: xAt(o.c1) - xAt(o.c0), h: yAt(r1) - yAt(o.r0) });

  let open = new Map<string, Open>();
  let prev = -2;
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    if (r !== prev + 1) {
      for (const o of open.values()) close(o, prev + 1);
      open = new Map();
    }
    const cs = byRow.get(r)!.sort((a, b) => a - b);
    const next = new Map<string, Open>();
    let s = 0;
    for (let j = 1; j <= cs.length; j++) {
      if (j < cs.length && cs[j] === cs[j - 1] + 1) continue;
      const c0 = cs[s];
      const c1 = cs[j - 1] + 1;
      const key = `${c0},${c1}`;
      next.set(key, open.get(key) ?? { c0, c1, r0: r });
      open.delete(key);
      s = j;
    }
    for (const o of open.values()) close(o, r);
    open = next;
    prev = r;
  }
  for (const o of open.values()) close(o, prev + 1);
  return out;
}

/**
 * Lay the rooms out by growth on a grid, after Lopes et al. (2010), "A
 * Constrained Growth Method for Procedural Floor Plan Generation".
 *
 * Each room starts from a seed cell and grows: first as a rectangle, a row or
 * column at a time, until it reaches its area or runs into a neighbour; then,
 * if it is still short, into an L along the longest free stretch beside it;
 * finally any cell nobody claimed goes to the neighbour furthest short of its
 * area. Unlike the splitter, walls do not have to line up across the plan,
 * which is what made every layout read as a treemap.
 *
 * Rooms come back with `parts` set and `rect` as their bounding box. Every
 * random choice comes from `rng`, so a seed always reproduces its plan.
 */
export function growLayout(fp: Rect, rooms: Room[], rng: Rng, effort = 1, orient: Orient | null = null): Room[] {
  const g = growGrid(fp, rooms, rng, effort, orient);
  refineGrid(g, rng, Math.round(REFINE_MOVES * effort));
  return gridRooms(g);
}

/**
 * Steps 1-6 of `growLayout`: seed, grow, fill and tidy, without the local
 * search. Cheap enough to run for every attempt, so candidates can be ranked
 * on `score` and only the best few refined.
 */
export function growGrid(fp: Rect, rooms: Room[], rng: Rng, effort = 1, orient: Orient | null = null): GridPlan {
  const cols = Math.max(1, Math.round(fp.w / GRID_CELL));
  const rows = Math.max(1, Math.round(fp.h / GRID_CELL));
  const cw = fp.w / cols;
  const ch = fp.h / rows;
  const owner = new Int32Array(cols * rows).fill(-1);
  const cells: number[][] = rooms.map(() => []);
  const box: (Box | null)[] = rooms.map(() => null);
  const at = (c: number, r: number) => r * cols + c;
  const isFree = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && owner[at(c, r)] === -1;
  const claim = (i: number, c: number, r: number) => {
    owner[at(c, r)] = i;
    cells[i].push(at(c, r));
  };

  // The hall, if any, is a full-width strip, as in the splitter's spine. Zones
  // and a hall that only goes where it is needed are the next step.
  const hall = rooms.findIndex((r) => r.type === 'hall');
  if (hall >= 0) {
    const depth = Math.min(rows, Math.max(1, Math.round(HALL_DEPTH / ch)));
    const margin = Math.ceil(1.4 / ch);
    const lo = margin;
    const hi = rows - depth - margin;
    const r0 = hi >= lo ? lo + Math.floor(rng() * (hi - lo + 1)) : Math.floor((rows - depth) / 2);
    for (let r = r0; r < r0 + depth; r++) for (let c = 0; c < cols; c++) claim(hall, c, r);
    box[hall] = { c0: 0, r0, c1: cols, r1: r0 + depth };
  }

  // Targets in cells, scaled so the rooms fill whatever the hall leaves.
  const others = rooms.map((_, i) => i).filter((i) => i !== hall);
  const free0 = cols * rows - (hall >= 0 ? cells[hall].length : 0);
  const sumArea = others.reduce((s, i) => s + rooms[i].area, 0);
  const target = rooms.map((r, i) => (i === hall ? cells[i].length : Math.max(1, Math.round((r.area / sumArea) * free0))));
  const roles = orient?.vastu ? (() => { const m = vastuRoles(rooms); return rooms.map((r) => m.get(r.id)!); })() : null;
  const plan: GridPlan = { fp, cells, score: 0, cols, rows, cw, ch, owner, target, rooms, hall, orient, roles };

  // 1. Seeds. Sample a few free cells per room and keep the best one: away
  // from the seeds already down (up to the room's own size — further gains
  // nothing), about one room-width from a room it may open onto so the two
  // end up sharing a wall, beside the hall if it may open onto that, and
  // towards the boundary if it needs daylight.
  const seeds: { i: number; x: number; y: number; reach: number }[] = [];
  const samples = Math.max(8, Math.round(SEED_SAMPLES * effort));
  const rank = (i: number) => SEED_ORDER.indexOf(rooms[i].type);
  const order = shuffle(others.slice(), rng).sort((a, b) => rank(a) - rank(b));
  const hallBox = hall >= 0 ? box[hall] : null;
  for (const i of order) {
    const reach = Math.sqrt(target[i] * cw * ch);
    const toHall = hallBox && mayOpenOnto(rooms[i].type, 'hall');
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < samples; k++) {
      const c = Math.floor(rng() * cols);
      const r = Math.floor(rng() * rows);
      if (!isFree(c, r)) continue;
      const x = (c + 0.5) * cw;
      const y = (r + 0.5) * ch;
      // Two seeds closer than half their combined size will fight over the
      // same floor, and the smaller one loses — that is how living ended up
      // 2.4 m wide between rooms that had all grown into it.
      let crowd = 0;
      let link = Infinity;
      for (const sd of seeds) {
        const dist = Math.hypot(x - sd.x, y - sd.y);
        const room = (reach + sd.reach) / 2;
        crowd += Math.max(0, room - dist);
        if (mayOpenOnto(rooms[i].type, rooms[sd.i].type)) link = Math.min(link, Math.abs(dist - room));
      }
      let s = -2 * crowd;
      if (link < Infinity) s -= link;
      if (toHall) s -= 0.5 * Math.max(0, Math.abs(y - ((hallBox.r0 + hallBox.r1) / 2) * ch) - ((hallBox.r1 - hallBox.r0) / 2) * ch);
      if (rooms[i].daylight) s -= 0.5 * Math.min(x, y, fp.w - x, fp.h - y);
      // The living room, which takes the entry, starts near the road.
      if (orient && rooms[i].type === 'living') s -= 0.5 * (fp.h - y);
      // Vastu: start each room towards its preferred compass zone.
      // The living room keeps to the road for the entry, so its zone only
      // decides which end of the road front it takes (the y part is dropped).
      const raw = roles ? preferredDirection(roles[i], orient!.facing) : null;
      const dir = raw && rooms[i].type === 'living' ? { x: Math.sign(raw.x), y: 0 } : raw;
      if (dir) s += 0.6 * ((x - fp.w / 2) * dir.x + (y - fp.h / 2) * dir.y);
      s += rng() * 0.1;
      if (s > bestScore) {
        bestScore = s;
        best = at(c, r);
      }
    }
    if (best < 0) best = owner.indexOf(-1);
    if (best < 0) continue;
    const c = best % cols;
    const r = Math.floor(best / cols);
    claim(i, c, r);
    box[i] = { c0: c, r0: r, c1: c + 1, r1: r + 1 };
    seeds.push({ i, x: (c + 0.5) * cw, y: (r + 0.5) * ch, reach });
  }

  const closer = (i: number, add: number) =>
    Math.abs(cells[i].length + add - target[i]) < Math.abs(cells[i].length - target[i]);
  const aspectOf = (b: Box) => {
    const w = (b.c1 - b.c0) * cw;
    const h = (b.r1 - b.r0) * ch;
    return Math.max(w, h) / Math.min(w, h);
  };
  // Neediest first, so one room cannot take the whole plan before the rest start.
  const byNeed = () =>
    others
      .filter((i) => box[i])
      .sort((a, b) => (target[b] - cells[b].length) / target[b] - (target[a] - cells[a].length) / target[a]);

  // 2. Rectangular growth, one row or column per room per pass. Each room
  // grows the way that keeps it squarest. The first round stops at the target
  // area; the second lets rooms run up to OVERGROW of it, so gaps between them
  // are taken by whole rows and columns rather than left for the L and fill
  // steps, which is where narrow bumps come from.
  const growRects = (fits: (i: number, add: number) => boolean) => {
    for (let grew = true; grew; ) {
      grew = false;
      for (const i of byNeed()) {
        const b = box[i]!;
        let pick: Box | null = null;
        let pickScore = Infinity;
        for (const o of [{ ...b, c0: b.c0 - 1 }, { ...b, c1: b.c1 + 1 }, { ...b, r0: b.r0 - 1 }, { ...b, r1: b.r1 + 1 }]) {
          const add = strip(b, o);
          if (!add.every(([c, r]) => isFree(c, r)) || !fits(i, add.length)) continue;
          const a = aspectOf(o);
          if (a > MAX_ASPECT && a >= aspectOf(b)) continue;
          const s = a + rng() * 1e-3;
          if (s < pickScore) {
            pickScore = s;
            pick = o;
          }
        }
        if (pick) {
          for (const [c, r] of strip(b, pick)) claim(i, c, r);
          box[i] = pick;
          grew = true;
        }
      }
    }
  };
  growRects(closer);
  growRects((i, add) => cells[i].length + add <= target[i] * OVERGROW);

  // 3. L-growth for rooms still short: take the longest free stretch that
  // runs along one side of the room, trimmed if it would overshoot.
  for (let grew = true; grew; ) {
    grew = false;
    for (const i of byNeed()) {
      const need = target[i] - cells[i].length;
      if (need <= 0) continue;
      let run: [number, number][] = [];
      for (const [dc, dr] of DIRS) {
        const lines = new Map<number, number[]>();
        for (const k of cells[i]) {
          const c = (k % cols) + dc;
          const r = Math.floor(k / cols) + dr;
          if (!isFree(c, r)) continue;
          const line = dc ? c : r;
          let ps = lines.get(line);
          if (!ps) lines.set(line, (ps = []));
          ps.push(dc ? r : c);
        }
        for (const [line, ps] of lines) {
          ps.sort((a, b) => a - b);
          let s = 0;
          for (let j = 1; j <= ps.length; j++) {
            if (j < ps.length && ps[j] === ps[j - 1] + 1) continue;
            if (j - s > run.length) run = ps.slice(s, j).map((p) => (dc ? [line, p] : [p, line]));
            s = j;
          }
        }
      }
      // A run shorter than the room's minimum width would be a bump nobody can use.
      const minRun = Math.ceil((rooms[i].minW - 1e-6) / Math.min(cw, ch));
      if (run.length < Math.min(minRun, need)) continue;
      if (!closer(i, run.length)) run = rng() < 0.5 ? run.slice(0, need) : run.slice(run.length - need);
      for (const [c, r] of run) claim(i, c, r);
      grew = true;
    }
  }

  // 4. Leftovers, a ring at a time, to the touching room furthest short of
  // its area. The hall stays a corridor: it takes a cell only when nothing
  // else touches it.
  for (;;) {
    const wave: [number, number][] = [];
    for (let k = 0; k < owner.length; k++) {
      if (owner[k] !== -1) continue;
      const c = k % cols;
      const r = Math.floor(k / cols);
      const contacts = new Map<number, number>();
      for (const [dc, dr] of DIRS) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const o = owner[at(cc, rr)];
        if (o >= 0) contacts.set(o, (contacts.get(o) ?? 0) + 1);
      }
      let pick = -1;
      let pickKey = -Infinity;
      for (const [o, n] of contacts) {
        // Need dominates contact: a pocket is floor some room is short of, not
        // a prize for whoever happens to wrap around it.
        const key = (o === hall ? -1e6 : 0) + ((target[o] - cells[o].length) / target[o]) * 4 + n * 0.5;
        if (key > pickKey) {
          pickKey = key;
          pick = o;
        }
      }
      if (pick >= 0) wave.push([k, pick]);
    }
    if (!wave.length) break;
    for (const [k, o] of wave) {
      owner[k] = o;
      cells[o].push(k);
    }
  }

  // 5. Smooth. Leftover filling leaves one-cell spurs and notches — a 0.3 m
  // tongue of living room poking between two bedrooms. A cell that touches its
  // own room on at most one side goes to the neighbour it touches most, when
  // that neighbour holds it on two sides or more. Peeling such a cell never
  // splits its room, and repeating peels a thin arm back to its root.
  for (let pass = 0, moved = true; moved && pass < 40; pass++) {
    moved = false;
    for (let k = 0; k < owner.length; k++) {
      const o = owner[k];
      if (o === hall || cells[o].length <= 1) continue;
      const c = k % cols;
      const r = Math.floor(k / cols);
      let own = 0;
      const contacts = new Map<number, number>();
      for (const [dc, dr] of DIRS) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const n = owner[at(cc, rr)];
        if (n === o) own++;
        else if (n !== hall) contacts.set(n, (contacts.get(n) ?? 0) + 1);
      }
      if (own > 1) continue;
      let pick = -1;
      let most = 1;
      for (const [n, m] of contacts) {
        if (m > most) {
          most = m;
          pick = n;
        }
      }
      if (pick < 0) continue;
      owner[k] = pick;
      cells[o].splice(cells[o].indexOf(k), 1);
      cells[pick].push(k);
      moved = true;
    }
  }

  // 6. Thin bumps. A cell where the room is narrower than its minimum width
  // *and* narrower than the room gets elsewhere is a tongue or a bump; it goes
  // to the neighbour it touches most, as long as the room it leaves stays in
  // one piece and keeps most of its area. A room that is narrow all over is
  // left alone — peeling it just eats it a cell at a time.
  const MIN_KEEP = 0.75;
  const runAt = (o: number, c: number, r: number, dc: number, dr: number) => {
    let n = 1;
    for (let cc = c + dc, rr = r + dr; cc >= 0 && rr >= 0 && cc < cols && rr < rows && owner[at(cc, rr)] === o; cc += dc, rr += dr) n++;
    for (let cc = c - dc, rr = r - dr; cc >= 0 && rr >= 0 && cc < cols && rr < rows && owner[at(cc, rr)] === o; cc -= dc, rr -= dr) n++;
    return n;
  };
  for (let pass = 0, moved = true; moved && pass < 12; pass++) {
    moved = false;
    const maxH = rooms.map(() => 0);
    const maxV = rooms.map(() => 0);
    for (let k = 0; k < owner.length; k++) {
      const o = owner[k];
      if (o < 0) continue;
      maxH[o] = Math.max(maxH[o], runAt(o, k % cols, Math.floor(k / cols), 1, 0));
      maxV[o] = Math.max(maxV[o], runAt(o, k % cols, Math.floor(k / cols), 0, 1));
    }
    for (let k = 0; k < owner.length; k++) {
      const o = owner[k];
      if (o === hall || cells[o].length <= target[o] * MIN_KEEP) continue;
      const c = k % cols;
      const r = Math.floor(k / cols);
      const h = runAt(o, c, r, 1, 0);
      const v = runAt(o, c, r, 0, 1);
      const minW = rooms[o].minW - 1e-6;
      const bump = (h * cw < minW && h < maxH[o]) || (v * ch < minW && v < maxV[o]);
      if (!bump) continue;
      const contacts = new Map<number, number>();
      for (const [dc, dr] of DIRS) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const n = owner[at(cc, rr)];
        if (n !== o && n !== hall) contacts.set(n, (contacts.get(n) ?? 0) + 1);
      }
      let pick = -1;
      let most = 0;
      for (const [n, m] of contacts) {
        if (m > most) {
          most = m;
          pick = n;
        }
      }
      if (pick < 0 || !connectedWithout(plan, o, k)) continue;
      owner[k] = pick;
      cells[o].splice(cells[o].indexOf(k), 1);
      cells[pick].push(k);
      moved = true;
    }
  }

  plan.score = gridScore(plan);
  return plan;
}

/**
 * Step 7, local search. Hand one boundary cell, or a whole stretch of wall,
 * to the neighbour across it, and keep the move if the plan scores no worse.
 * This is what fixes the near misses growth leaves behind (a living room one
 * cell short of 3 m, a bath whose wall to the hall is one cell short of a
 * door) rather than throwing the candidate away and hoping the next seed is
 * luckier.
 */
export function refineGrid(g: GridPlan, rng: Rng, moves: number, startTemp = ANNEAL_START): void {
  const { cols, rows, owner, cells, hall } = g;
  const at = (c: number, r: number) => r * cols + c;
  let current = gridScore(g);
  // Simulated annealing: early on a worse move is sometimes kept, so the
  // search can walk through a dip (narrow the kitchen to widen the living
  // room) instead of stopping at the first local optimum. The best state seen
  // is kept and restored at the end.
  let best = current;
  let bestOwner = owner.slice();
  let temp = startTemp;
  const cool = moves > 1 ? Math.pow(Math.min(ANNEAL_END, startTemp) / startTemp, 1 / moves) : 1;
  const accept = (next: number) => next <= current || rng() < Math.exp((current - next) / temp);
  const keep = (next: number) => {
    current = next;
    if (current < best) {
      best = current;
      bestOwner = owner.slice();
    }
  };
  /**
   * Shift the wall between two rooms by one cell: the whole straight stretch
   * where `a` faces `b` across direction (dc, dr) moves into one of them. A
   * room only gets wider a row or a column at a time, so single-cell moves
   * alone can never take a 2.4 m living room to 3 m without passing through
   * worse plans first.
   */
  const shiftWall = (k: number, dc: number, dr: number): boolean => {
    const a = owner[k];
    const b = owner[k + dr * cols + dc];
    const pc = dr ? 1 : 0;
    const pr = dc ? 1 : 0;
    const c0 = k % cols;
    const r0 = Math.floor(k / cols);
    const sideA: number[] = [];
    const sideB: number[] = [];
    for (const sgn of [1, -1]) {
      for (let t = sgn === 1 ? 0 : 1; ; t++) {
        const c = c0 + sgn * t * pc;
        const r = r0 + sgn * t * pr;
        const cb = c + dc;
        const rb = r + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows || cb < 0 || rb < 0 || cb >= cols || rb >= rows) break;
        if (owner[at(c, r)] !== a || owner[at(cb, rb)] !== b) break;
        sideA.push(at(c, r));
        sideB.push(at(cb, rb));
      }
    }
    const [loser, gainer, moved] = rng() < 0.5 ? [b, a, sideB] : [a, b, sideA];
    if (cells[loser].length <= moved.length || !connectedWithout(g, loser, new Set(moved))) return false;
    for (const x of moved) owner[x] = gainer;
    const next = gridScore(g);
    if (accept(next)) {
      keep(next);
      const gone = new Set(moved);
      cells[loser] = cells[loser].filter((x) => !gone.has(x));
      cells[gainer].push(...moved);
      return true;
    }
    for (const x of moved) owner[x] = loser;
    return false;
  };

  for (let t = 0; t < moves; t++, temp *= cool) {
    let k = -1;
    let to = -1;
    let dir: [number, number] = [0, 0];
    for (let tries = 0; tries < 20 && k < 0; tries++) {
      const x = Math.floor(rng() * owner.length);
      const [dc, dr] = DIRS[Math.floor(rng() * 4)];
      const cc = (x % cols) + dc;
      const rr = Math.floor(x / cols) + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const from = owner[x];
      const n = owner[at(cc, rr)];
      if (from === hall || n === hall || n === from) continue;
      k = x;
      to = n;
      dir = [dc, dr];
    }
    if (k < 0) continue;
    if (rng() < 0.5) {
      shiftWall(k, dir[0], dir[1]);
      continue;
    }
    const from = owner[k];
    if (cells[from].length <= 1 || !connectedWithout(g, from, k)) continue;
    owner[k] = to;
    const next = gridScore(g);
    if (accept(next)) {
      keep(next);
      cells[from].splice(cells[from].indexOf(k), 1);
      cells[to].push(k);
    } else {
      owner[k] = from;
    }
  }
  owner.set(bestOwner);
  for (const list of cells) list.length = 0;
  for (let k = 0; k < owner.length; k++) if (owner[k] >= 0) cells[owner[k]].push(k);
  g.score = best;
}

/** The grid plan as rooms: each a union of rectangles, `rect` its bounding box. */
export function gridRooms(g: GridPlan): Room[] {
  const { fp, rooms, cells, cols, cw, ch, target } = g;
  return rooms.map((room, i) => {
    const parts = toParts(cells[i], cols, fp, cw, ch);
    if (!parts.length) return { ...room, rect: { x: fp.x, y: fp.y, w: 0, h: 0 }, parts };
    const x0 = Math.min(...parts.map((p) => p.x));
    const y0 = Math.min(...parts.map((p) => p.y));
    const x1 = Math.max(...parts.map((p) => p.x + p.w));
    const y1 = Math.max(...parts.map((p) => p.y + p.h));
    return { ...room, area: target[i] * cw * ch, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, parts };
  });
}
