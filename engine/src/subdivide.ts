import { type Rect, splitRect, aspect } from './geometry.js';
import { type Room, type RoomType, ADJACENCY, ZONE_OF, type Zone, HALL_DEPTH } from './brief.js';
import { layoutScore } from './score.js';

export { ADJACENCY, ZONE_OF } from './brief.js';
export type { Zone } from './brief.js';

export type Rng = () => number;

/**
 * How the footprint is partitioned.
 *
 * 'flat'  — one recursive split over the rooms. Measured better on the 1BHK
 *           sample (see PROGRESS.md): max aspect 1.89, no room over 2.0.
 * 'zoned' — Marson & Musse's two-level split: squarify social/service/private
 *           zones first, then each zone into its rooms. Kept because it is the
 *           published method and it produces more coherent zoning, but it
 *           measured worse on shape: max aspect 2.25, four rooms over 1.8.
 */
export type SplitMode = 'flat' | 'zoned';

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Aspect below which a finished room is considered fine. */
const LEAF_ASPECT = 1.5;
const LEAF_ASPECT_WEIGHT = 8;
/** A block that will be cut again is only stopped from going pathological. */
const BLOCK_ASPECT = 3;
const BLOCK_ASPECT_WEIGHT = 1.5;

/**
 * Cost of one side of a cut. A finished room is judged on its shape; an
 * intermediate block is not, because thin blocks are how small rooms get a
 * usable width. Judging every intermediate region on its shape was what pushed
 * baths to 3.5 x 1.4 — the splitter was avoiding the thin strip that a bath
 * actually wants.
 */
function sideCost(r: Rect, rooms: Room[]): number {
  const a = aspect(r);
  if (rooms.length === 1) {
    const soft = rooms[0].type === 'hall' ? 5 : LEAF_ASPECT;
    let s = Math.max(0, a - soft) ** 2 * LEAF_ASPECT_WEIGHT;
    const m = Math.min(r.w, r.h);
    if (m < rooms[0].minW) s += (rooms[0].minW - m) * 150;
    return s;
  }
  return Math.max(0, a - BLOCK_ASPECT) ** 2 * BLOCK_ASPECT_WEIGHT;
}

function cutCost(rect: Rect, axis: 'x' | 'y', f: number, A: Room[], B: Room[]): number {
  const [ra, rb] = splitRect(rect, axis, f);

  let s = sideCost(ra, A) + sideCost(rb, B);
  s += Math.abs(f - 0.5) * 0.6;

  for (const [p, q] of ADJACENCY) {
    const ap = A.some((r) => r.type === p);
    const aq = A.some((r) => r.type === q);
    const bp = B.some((r) => r.type === p);
    const bq = B.some((r) => r.type === q);
    if ((ap && bq) || (aq && bp)) s += 0.8;
  }
  return s;
}

interface Item {
  area: number;
  rooms: Room[];
}

function zoneGroups(rooms: Room[]): Item[] {
  const byZone = new Map<Zone, Item>();
  for (const r of rooms) {
    const z = ZONE_OF[r.type];
    let g = byZone.get(z);
    if (!g) {
      g = { area: 0, rooms: [] };
      byZone.set(z, g);
    }
    g.area += r.area;
    g.rooms.push(r);
  }
  return [...byZone.values()].sort((a, b) => b.area - a.area);
}

/**
 * What we partition at this level: in 'zoned' mode the zones while the set
 * spans more than one, otherwise the individual rooms.
 */
function unitsOf(rooms: Room[], mode: SplitMode): Item[] {
  if (mode === 'zoned') {
    const zones = new Set(rooms.map((r) => ZONE_OF[r.type]));
    if (zones.size > 1) return zoneGroups(rooms);
  }
  return rooms.map((r) => ({ area: r.area, rooms: [r] }));
}

/**
 * Recursive area-proportional partition. Every room lands on its target area
 * exactly. The search decides which rooms share a block and which axis each
 * block is cut on — both axes are tried, not only the longer one.
 */
function partition(rect: Rect, rooms: Room[], rng: Rng, mode: SplitMode, effort = 1): Room[] {
  if (rooms.length === 1) return [{ ...rooms[0], rect }];

  const units = unitsOf(rooms, mode);
  if (units.length < 2) return rooms.map((r) => ({ ...r, rect }));

  const total = units.reduce((s, u) => s + u.area, 0);
  let best: { A: Item[]; B: Item[]; axis: 'x' | 'y'; f: number } | null = null;
  let bestScore = Infinity;

  const tries = Math.max(6, Math.round(Math.min(96, 16 + units.length * 10) * effort));
  for (let t = 0; t < tries; t++) {
    const order = shuffle(units.slice(), rng);
    let acc = 0;
    for (let i = 0; i < order.length - 1; i++) {
      acc += order[i].area;
      const f = acc / total;
      if (f < 0.15 || f > 0.85) continue;
      const A = order.slice(0, i + 1);
      const B = order.slice(i + 1);
      const roomsA = A.flatMap((u) => u.rooms);
      const roomsB = B.flatMap((u) => u.rooms);
      for (const axis of ['x', 'y'] as const) {
        const sc = cutCost(rect, axis, f, roomsA, roomsB) + rng() * 0.3;
        if (sc < bestScore) {
          bestScore = sc;
          best = { A, B, axis, f };
        }
      }
    }
  }

  if (!best) {
    const sorted = units.slice().sort((a, b) => b.area - a.area);
    const half = Math.max(1, Math.floor(sorted.length / 2));
    const A = sorted.slice(0, half);
    const B = sorted.slice(half);
    best = {
      A,
      B,
      axis: rect.w >= rect.h ? 'x' : 'y',
      f: A.reduce((s, u) => s + u.area, 0) / total,
    };
  }

  const [ra, rb] = splitRect(rect, best.axis, best.f);
  return [
    ...partition(ra, best.A.flatMap((u) => u.rooms), rng, mode),
    ...partition(rb, best.B.flatMap((u) => u.rooms), rng, mode),
  ];
}

/**
 * Place the hall as a spine across the footprint, then partition the rooms into
 * the blocks above and below it. Letting the ordinary splitter place the hall
 * is what produced a stub tucked beside the utility, with every other room
 * reachable only through the living room.
 */
function spine(rect: Rect, rooms: Room[], hall: Room, rng: Rng, mode: SplitMode, effort = 1): Room[] {
  const others = rooms.filter((r) => r.id !== hall.id);
  if (!others.length) return [{ ...hall, rect }];

  const t = hall.area / rect.w;
  // A strip that would be thinner than a doorway, or would eat most of the
  // plan, is not a corridor — fall back to the ordinary partition.
  if (t < Math.max(hall.minW, HALL_DEPTH * 0.75) || t > rect.h * 0.35) {
    return partition(rect, rooms, rng, mode);
  }

  const freeH = rect.h - t;
  let best: Room[] | null = null;
  let bestScore = Infinity;

  const tries = Math.max(4, Math.round(12 * effort));
  for (let k = 0; k < tries; k++) {
    const order = shuffle(others.slice(), rng);
    let acc = 0;
    for (let i = 0; i < order.length - 1; i++) {
      acc += order[i].area;
      const hA = acc / rect.w;
      if (hA < 1.4 || freeH - hA < 1.4) continue;

      const blockA: Rect = { x: rect.x, y: rect.y, w: rect.w, h: hA };
      const hallRect: Rect = { x: rect.x, y: rect.y + hA, w: rect.w, h: t };
      const blockB: Rect = { x: rect.x, y: rect.y + hA + t, w: rect.w, h: freeH - hA };

      const placed = [
        ...partition(blockA, order.slice(0, i + 1), rng, mode, 0.4 * effort),
        ...partition(blockB, order.slice(i + 1), rng, mode, 0.4 * effort),
        { ...hall, rect: hallRect },
      ];
      const sc = layoutScore(placed, rect);
      if (sc < bestScore) {
        bestScore = sc;
        best = placed;
      }
    }
  }

  return best ?? partition(rect, rooms, rng, mode);
}

export function subdivide(
  rect: Rect,
  rooms: Room[],
  rng: Rng,
  depth = 0,
  mode: SplitMode = 'flat',
  effort = 1,
): Room[] {
  void depth;
  const hall = rooms.find((r) => r.type === 'hall');
  if (!hall) return partition(rect, rooms, rng, mode, effort);
  return spine(rect, rooms, hall, rng, mode, effort);
}

void (0 as unknown as [RoomType, RoomType][]);
