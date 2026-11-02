import { type SharedEdge, sharedEdge, EPS } from './geometry.js';
import type { Room } from './brief.js';
import { partsOf, roomSharedEdges, mergeEdges } from './shape.js';

export interface WallSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  exterior: boolean;
  /** For an exterior run, the room it bounds. */
  roomId?: string;
}

const segOf = (e: SharedEdge, exterior: boolean): WallSeg =>
  e.axis === 'v'
    ? { x1: e.at, y1: e.lo, x2: e.at, y2: e.hi, exterior }
    : { x1: e.lo, y1: e.at, x2: e.hi, y2: e.at, exterior };

export const segLen = (w: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(w.x2 - w.x1, w.y2 - w.y1);

function complement(covered: [number, number][], lo: number, hi: number): [number, number][] {
  // Clamp to the run, as windows.ts does. An interval that reaches outside
  // [lo, hi] would otherwise widen the "uncovered" gap and emit an exterior
  // wall segment running past the room it belongs to.
  const clipped = covered
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as [number, number])
    .filter(([a, b]) => b - a > EPS)
    .sort((a, b) => a[0] - b[0]);

  if (!clipped.length) return [[lo, hi]];
  const sorted = clipped;
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of sorted) {
    if (a > cur + EPS) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < hi - EPS) out.push([cur, hi]);
  return out;
}

/**
 * Interior walls come from shared room edges; exterior walls are the uncovered
 * leftovers. A room made of several parts has seams between them; a seam is
 * covered by the sibling part, so it is not a wall. Each room's exterior
 * pieces are merged, so a straight run reads as one segment across its seams.
 */
export function buildWalls(rooms: Room[]): WallSeg[] {
  const segs: WallSeg[] = [];

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      for (const e of roomSharedEdges(rooms[i], rooms[j])) segs.push(segOf(e, false));
    }
  }

  for (const r of rooms) {
    const runs: SharedEdge[] = [];
    for (const rect of partsOf(r)) {
      const edges = [
        { axis: 'v' as const, at: rect.x, lo: rect.y, hi: rect.y + rect.h },
        { axis: 'v' as const, at: rect.x + rect.w, lo: rect.y, hi: rect.y + rect.h },
        { axis: 'h' as const, at: rect.y, lo: rect.x, hi: rect.x + rect.w },
        { axis: 'h' as const, at: rect.y + rect.h, lo: rect.x, hi: rect.x + rect.w },
      ];

      for (const ed of edges) {
        const covered: [number, number][] = [];
        for (const o of rooms) {
          for (const q of partsOf(o)) {
            if (q === rect) continue;
            const e = sharedEdge(rect, q);
            if (!e) continue;
            if (e.axis === ed.axis && Math.abs(e.at - ed.at) < EPS) covered.push([e.lo, e.hi]);
          }
        }
        for (const [lo, hi] of complement(covered, ed.lo, ed.hi)) {
          runs.push({ axis: ed.axis, at: ed.at, lo, hi, len: hi - lo });
        }
      }
    }
    for (const e of mergeEdges(runs)) segs.push({ ...segOf(e, true), roomId: r.id });
  }

  return segs;
}

export function exteriorSegmentsOf(room: Room, walls: WallSeg[]): WallSeg[] {
  const r = room.rect;
  return walls.filter((w) => {
    if (!w.exterior) return false;
    if (w.roomId !== undefined) return w.roomId === room.id;
    const vertical = Math.abs(w.x1 - w.x2) < EPS;
    if (vertical) {
      const onX = Math.abs(w.x1 - r.x) < EPS || Math.abs(w.x1 - (r.x + r.w)) < EPS;
      const lo = Math.min(w.y1, w.y2);
      const hi = Math.max(w.y1, w.y2);
      return onX && lo >= r.y - EPS && hi <= r.y + r.h + EPS;
    }
    const onY = Math.abs(w.y1 - r.y) < EPS || Math.abs(w.y1 - (r.y + r.h)) < EPS;
    const lo = Math.min(w.x1, w.x2);
    const hi = Math.max(w.x1, w.x2);
    return onY && lo >= r.x - EPS && hi <= r.x + r.w + EPS;
  });
}
