import { type Rect, splitRect, aspect } from './geometry.js';
import type { Room } from './brief.js';

export type Rng = () => number;

export const ADJACENCY: [string, string][] = [
  ['living', 'dining'],
  ['dining', 'kitchen'],
  ['living', 'bedroom'],
  ['bedroom', 'bath'],
];

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

function splitScore(rect: Rect, axis: 'x' | 'y', f: number, A: Room[], B: Room[]): number {
  const [ra, rb] = splitRect(rect, axis, f);
  let s = Math.abs(f - 0.5) * 2;
  s += Math.max(0, aspect(ra) - 2) * 0.6;
  s += Math.max(0, aspect(rb) - 2) * 0.6;

  for (const [p, q] of ADJACENCY) {
    const ap = A.some((r) => r.type === p);
    const aq = A.some((r) => r.type === q);
    const bp = B.some((r) => r.type === p);
    const bq = B.some((r) => r.type === q);
    if ((ap && bq) || (aq && bp)) s += 1.2;
  }

  if (A.length === 1) {
    const m = Math.min(ra.w, ra.h);
    if (m < A[0].minW) s += (A[0].minW - m) * 3;
  }
  if (B.length === 1) {
    const m = Math.min(rb.w, rb.h);
    if (m < B[0].minW) s += (B[0].minW - m) * 3;
  }
  return s;
}

/** Recursive area-proportional partition. Every room lands on its target area. */
export function subdivide(rect: Rect, rooms: Room[], rng: Rng, depth = 0): Room[] {
  if (rooms.length === 1) return [{ ...rooms[0], rect }];

  const total = rooms.reduce((s, r) => s + r.area, 0);
  const axis: 'x' | 'y' = rect.w >= rect.h ? 'x' : 'y';

  let best: { A: Room[]; B: Room[]; f: number } | null = null;
  let bestScore = Infinity;

  const tries = Math.min(48, 8 + rooms.length * 4);
  for (let t = 0; t < tries; t++) {
    const order = shuffle(rooms.slice(), rng);
    let acc = 0;
    for (let i = 0; i < order.length - 1; i++) {
      acc += order[i].area;
      const f = acc / total;
      if (f < 0.28 || f > 0.72) continue;
      const A = order.slice(0, i + 1);
      const B = order.slice(i + 1);
      const sc = splitScore(rect, axis, f, A, B) + rng() * 0.35;
      if (sc < bestScore) {
        bestScore = sc;
        best = { A, B, f };
      }
    }
  }

  if (!best) {
    const sorted = rooms.slice().sort((a, b) => b.area - a.area);
    const half = Math.max(1, Math.floor(sorted.length / 2));
    const A = sorted.slice(0, half);
    const B = sorted.slice(half);
    best = { A, B, f: A.reduce((s, r) => s + r.area, 0) / total };
  }

  const [ra, rb] = splitRect(rect, axis, best.f);
  return [...subdivide(ra, best.A, rng, depth + 1), ...subdivide(rb, best.B, rng, depth + 1)];
}
