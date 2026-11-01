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
    // A hall is supposed to be long and thin; judging it like a room would
    // push the corridor into a stubby square that reaches nothing.
    s += r.type === 'hall'
      ? Math.max(0, a - 5) ** 2 * 2
      : Math.max(0, a - ASPECT_SOFT) ** 2 * ASPECT_WEIGHT;

    const m = Math.min(r.rect.w, r.rect.h);
    if (m < r.minW) s += (r.minW - m) * 150;
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

  // A door-valid layout needs somewhere for each door to go. Without a
  // corridor, every bedroom must touch a circulation room and every bath must
  // touch a bedroom or circulation — otherwise the bath becomes the hallway,
  // which is the thing doors.ts refuses to do.
  // The hall is the spine. A room that touches it gets a door to it; a room
  // that does not has to be reached through another room, which is how a
  // living room ends up with three doors.
  const hall = rooms.find((r) => r.type === 'hall');
  if (hall) {
    for (const r of rooms) {
      if (r.id === hall.id) continue;
      s += sharedEdge(r.rect, hall.rect) ? -4 : 3;
    }
  }

  const circulation = rooms.filter((r) => r.type === 'living' || r.type === 'dining' || r.type === 'hall');
  const touchesCirc = (r: Room) => circulation.some((c) => c.id !== r.id && sharedEdge(r.rect, c.rect));
  for (const r of rooms) {
    if (r.type === 'bedroom' && !touchesCirc(r)) s += 8;
    if (r.type === 'bath') {
      const ok =
        rooms.some((o) => o.type === 'hall' && sharedEdge(r.rect, o.rect)) ||
        rooms.some((o) => o.type === 'bedroom' && sharedEdge(r.rect, o.rect));
      if (!ok) s += 10;
    }
  }

  s += unreachableCount(rooms, entryType) * 25;
  return s;
}
