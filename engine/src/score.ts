import { type Rect, sharedEdge, touchesBoundary } from './geometry.js';
import type { Room } from './brief.js';
import { ADJACENCY } from './brief.js';

export function adjacencyGraph(rooms: Room[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const r of rooms) adj.set(r.id, []);
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (sharedEdge(rooms[i].rect, rooms[j].rect)) {
        adj.get(rooms[i].id)!.push(rooms[j].id);
        adj.get(rooms[j].id)!.push(rooms[i].id);
      }
    }
  }
  return adj;
}

export function unreachableCount(rooms: Room[], entryType = 'living'): number {
  if (!rooms.length) return 0;
  const entry = rooms.find((r) => r.type === entryType) ?? rooms[0];
  const adj = adjacencyGraph(rooms);
  const seen = new Set<string>([entry.id]);
  const queue = [entry.id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return rooms.length - seen.size;
}

/** Aspect ratio penalty: quadratic in the excess past 1.5, so slivers cost real score. */
export const ASPECT_SOFT = 1.5;
export const ASPECT_WEIGHT = 8;

export function layoutScore(rooms: Room[], fp: Rect, entryType = 'living'): number {
  let s = 0;
  for (const r of rooms) {
    const a = Math.max(r.rect.w, r.rect.h) / Math.min(r.rect.w, r.rect.h);
    s += Math.max(0, a - ASPECT_SOFT) ** 2 * ASPECT_WEIGHT;

    const m = Math.min(r.rect.w, r.rect.h);
    if (m < r.minW) s += (r.minW - m) * 25;
    if (r.daylight && !touchesBoundary(r.rect, fp)) s += 6;
  }

  for (const [p, q] of ADJACENCY) {
    const ps = rooms.filter((r) => r.type === p);
    const qs = rooms.filter((r) => r.type === q);
    if (!ps.length || !qs.length) continue;
    let best = 0;
    for (const x of ps) {
      for (const y of qs) {
        const e = sharedEdge(x.rect, y.rect);
        if (e) best = Math.max(best, e.len);
      }
    }
    s += best >= 1.2 ? -3 : 1.5;
  }

  s += unreachableCount(rooms, entryType) * 25;
  return s;
}
