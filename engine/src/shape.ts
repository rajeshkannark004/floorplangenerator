import { type Rect, type SharedEdge, sharedEdge, touchesBoundary, rectArea, EPS } from './geometry.js';
import type { Room } from './brief.js';

/**
 * A room is a union of disjoint rectangles. The splitter only ever makes one,
 * so a room without `parts` is just its `rect`; grid growth makes L-shapes and
 * sets `parts`, with `rect` as the bounding box.
 */
export const partsOf = (r: Room): Rect[] => r.parts ?? [r.rect];

export const roomArea = (r: Room): number => partsOf(r).reduce((s, p) => s + rectArea(p), 0);

/** Bounding-box aspect. An L is judged by its envelope; `roomFill` says how much of it is room. */
export const roomAspect = (r: Room): number => Math.max(r.rect.w, r.rect.h) / Math.min(r.rect.w, r.rect.h);

/** Share of the bounding box the room actually covers: 1 for a rectangle. */
export const roomFill = (r: Room): number => (r.parts ? roomArea(r) / rectArea(r.rect) : 1);

export const roomTouchesBoundary = (r: Room, fp: Rect): boolean => partsOf(r).some((p) => touchesBoundary(p, fp));

/** Join collinear pieces that touch or overlap, so one wall reads as one run. */
export function mergeEdges(edges: SharedEdge[]): SharedEdge[] {
  const sorted = edges.slice().sort((a, b) => (a.axis === b.axis ? (Math.abs(a.at - b.at) < EPS ? a.lo - b.lo : a.at - b.at) : a.axis < b.axis ? -1 : 1));
  const out: SharedEdge[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last.axis === e.axis && Math.abs(last.at - e.at) < EPS && e.lo <= last.hi + EPS) {
      last.hi = Math.max(last.hi, e.hi);
      last.len = last.hi - last.lo;
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

/** Every stretch of wall two rooms share. */
export function roomSharedEdges(a: Room, b: Room): SharedEdge[] {
  const raw: SharedEdge[] = [];
  for (const p of partsOf(a)) {
    for (const q of partsOf(b)) {
      const e = sharedEdge(p, q);
      if (e) raw.push(e);
    }
  }
  return mergeEdges(raw);
}

export function longestSharedEdge(a: Room, b: Room): SharedEdge | null {
  let best: SharedEdge | null = null;
  for (const e of roomSharedEdges(a, b)) if (!best || e.len > best.len) best = e;
  return best;
}

export const shares = (a: Room, b: Room): boolean => roomSharedEdges(a, b).length > 0;

/**
 * The narrowest the room gets. At every point take the room's extent across it
 * horizontally and vertically; the smaller is the clear width there, and this
 * is the minimum over the room. For a rectangle that is its short side; for an
 * L it is the thinner arm, and a one-cell notch shows up as the notch.
 */
export function minWidth(r: Room): number {
  const parts = partsOf(r);
  if (parts.length === 1) return Math.min(parts[0].w, parts[0].h);

  const uniq = (vs: number[]) => {
    vs.sort((a, b) => a - b);
    const o: number[] = [];
    for (const v of vs) if (!o.length || v - o[o.length - 1] > EPS) o.push(v);
    return o;
  };
  const xs = uniq(parts.flatMap((p) => [p.x, p.x + p.w]));
  const ys = uniq(parts.flatMap((p) => [p.y, p.y + p.h]));
  const nx = xs.length - 1;
  const ny = ys.length - 1;

  const inside: boolean[][] = [];
  for (let j = 0; j < ny; j++) {
    const row: boolean[] = [];
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      row.push(parts.some((p) => cx > p.x && cx < p.x + p.w && cy > p.y && cy < p.y + p.h));
    }
    inside.push(row);
  }

  const across: number[][] = inside.map((row) => row.map(() => Infinity));
  // Horizontal extent through each cell.
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; ) {
      if (!inside[j][i]) { i++; continue; }
      let k = i;
      while (k < nx && inside[j][k]) k++;
      for (let m = i; m < k; m++) across[j][m] = xs[k] - xs[i];
      i = k;
    }
  }
  // Vertical extent, keeping the smaller of the two.
  let m = Infinity;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; ) {
      if (!inside[j][i]) { j++; continue; }
      let k = j;
      while (k < ny && inside[k][i]) k++;
      for (let q = j; q < k; q++) m = Math.min(m, across[q][i], ys[k] - ys[j]);
      j = k;
    }
  }
  return m;
}

/** Centre of the room's largest part: always inside the room, even for an L. */
export function labelPoint(r: Room): { x: number; y: number } {
  const p = partsOf(r).reduce((a, b) => (rectArea(b) > rectArea(a) ? b : a));
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}
