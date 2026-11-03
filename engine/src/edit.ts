import { type Rect, type SharedEdge, EPS } from './geometry.js';
import type { Room } from './brief.js';
import { type WallSeg, buildWalls, exteriorSegmentsOf } from './walls.js';
import type { DoorSeg } from './doors.js';
import { type Furniture, inDoorSwing } from './furniture.js';
import { partsOf, roomSharedEdges, mergeEdges } from './shape.js';
import type { Plan } from './render-svg.js';

/*
 * Hand edits to a generated plan. Every function is pure: it takes a plan and
 * returns a new one (or null when the edit cannot be made), so the editor can
 * keep each step for undo.
 */

/** Rooms are never squeezed narrower than this by dragging a wall. */
export const MIN_PART = 0.9;
/** Openings keep this far from the ends of the wall they sit in. */
export const OPENING_MARGIN = 0.1;
export const MIN_DOOR = 0.6;
export const MAX_DOOR = 1.5;
export const MIN_WINDOW = 0.4;

type Seg = { x1: number; y1: number; x2: number; y2: number };
const vertical = (s: Seg) => Math.abs(s.x1 - s.x2) < EPS;

/** An opening's extent along its wall. */
export function openingRange(s: Seg): [number, number] {
  return vertical(s) ? [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)] : [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
}

function withRange<T extends Seg>(s: T, lo: number, hi: number): T {
  return vertical(s) ? { ...s, y1: lo, y2: hi } : { ...s, x1: lo, x2: hi };
}

const edgeOf = (s: Seg): SharedEdge => {
  const [lo, hi] = openingRange(s);
  return vertical(s) ? { axis: 'v', at: s.x1, lo, hi, len: hi - lo } : { axis: 'h', at: s.y1, lo, hi, len: hi - lo };
};

/** The stretches of wall an opening may slide along: the wall its two rooms share, or its room's outside wall. */
function hostRuns(plan: Plan, s: Seg, a: string, b: string | null): [number, number][] {
  const e = edgeOf(s);
  const room = (id: string) => plan.rooms.find((r) => r.id === id);
  const ra = room(a);
  const rb = b ? room(b) : undefined;
  const edges = ra && rb ? roomSharedEdges(ra, rb) : ra ? mergeEdges(exteriorSegmentsOf(ra, plan.walls).map(edgeOf)) : [];
  return edges.filter((x) => x.axis === e.axis && Math.abs(x.at - e.at) < EPS).map((x) => [x.lo, x.hi]);
}

/** Fit an opening of the asked range into the nearest host run, shrinking it if the run is short. */
function clampInto<T extends Seg>(s: T, lo: number, hi: number, runs: [number, number][], minLen: number): T | null {
  if (!runs.length) return null;
  const mid = (lo + hi) / 2;
  const run = runs.reduce((best, r) => {
    const d = (x: [number, number]) => Math.max(0, x[0] - mid, mid - x[1]);
    return d(r) < d(best) ? r : best;
  });
  const room = run[1] - run[0] - 2 * OPENING_MARGIN;
  if (room < minLen - EPS) return null;
  const len = Math.min(hi - lo, room);
  const from = Math.min(Math.max(mid - len / 2, run[0] + OPENING_MARGIN), run[1] - OPENING_MARGIN - len);
  return withRange(s, from, from + len);
}

/** Slide or resize a door to span [lo, hi] along its wall, kept on the wall its rooms share. */
export function setDoor(plan: Plan, i: number, lo: number, hi: number): Plan {
  const d = plan.doors[i];
  hi = Math.min(Math.max(hi, lo + MIN_DOOR), lo + MAX_DOOR);
  const next = clampInto(d, lo, hi, hostRuns(plan, d, d.a, d.b), MIN_DOOR);
  if (!next) return plan;
  const [a, b] = openingRange(next);
  const doors = plan.doors.slice();
  doors[i] = { ...next, width: b - a };
  return { ...plan, doors };
}

/** Slide or resize a window to span [lo, hi], kept on its room's outside wall. */
export function setWindow(plan: Plan, i: number, lo: number, hi: number): Plan {
  const w = plan.windows[i];
  hi = Math.max(hi, lo + MIN_WINDOW);
  const next = clampInto(w, lo, hi, hostRuns(plan, w, w.roomId, null), MIN_WINDOW);
  if (!next) return plan;
  const windows = plan.windows.slice();
  windows[i] = next;
  return { ...plan, windows };
}

/** An interior wall line that can be dragged: every collinear, touching interior segment at one coordinate. */
export interface WallLine { axis: 'v' | 'h'; at: number; lo: number; hi: number }

export function wallLines(walls: WallSeg[]): WallLine[] {
  return mergeEdges(walls.filter((w) => !w.exterior).map(edgeOf)).map(({ axis, at, lo, hi }) => ({ axis, at, lo, hi }));
}

const bbox = (parts: Rect[]): Rect => {
  const x = Math.min(...parts.map((p) => p.x));
  const y = Math.min(...parts.map((p) => p.y));
  return { x, y, w: Math.max(...parts.map((p) => p.x + p.w)) - x, h: Math.max(...parts.map((p) => p.y + p.h)) - y };
};

/**
 * Move an interior wall line to `to`. Every room edge lying on it moves too,
 * so the rooms still tile the footprint; walls are rebuilt, doors in the line
 * ride along, and every opening is refitted to the wall it now sits in.
 * Returns null when a room would get narrower than MIN_PART.
 */
export function moveWall(plan: Plan, line: WallLine, to: number): Plan | null {
  const d = to - line.at;
  if (Math.abs(d) < EPS) return plan;
  const on = (lo: number, hi: number) => Math.min(hi, line.hi) - Math.max(lo, line.lo) > EPS;
  let ok = true;
  const rooms: Room[] = plan.rooms.map((r) => {
    let moved = false;
    const parts = partsOf(r).map((p) => {
      const q = { ...p };
      if (line.axis === 'v' && on(p.y, p.y + p.h)) {
        if (Math.abs(p.x + p.w - line.at) < EPS) { q.w += d; moved = true; }
        else if (Math.abs(p.x - line.at) < EPS) { q.x += d; q.w -= d; moved = true; }
      } else if (line.axis === 'h' && on(p.x, p.x + p.w)) {
        if (Math.abs(p.y + p.h - line.at) < EPS) { q.h += d; moved = true; }
        else if (Math.abs(p.y - line.at) < EPS) { q.y += d; q.h -= d; moved = true; }
      }
      // Grid-grown L-rooms can have legs thinner than MIN_PART to begin with;
      // only a leg the drag narrows is held to it.
      if ((q.w < p.w - EPS && q.w < MIN_PART - EPS) || (q.h < p.h - EPS && q.h < MIN_PART - EPS)) ok = false;
      return q;
    });
    if (!moved) return r;
    return r.parts ? { ...r, parts, rect: bbox(parts) } : { ...r, rect: parts[0] };
  });
  if (!ok) return null;

  const walls = buildWalls(rooms);
  const shifted = plan.doors.map((door) => {
    const e = edgeOf(door);
    if (e.axis !== line.axis || Math.abs(e.at - line.at) > EPS || !on(e.lo, e.hi)) return door;
    return line.axis === 'v' ? { ...door, x1: door.x1 + d, x2: door.x2 + d } : { ...door, y1: door.y1 + d, y2: door.y2 + d };
  });
  let next: Plan = { ...plan, rooms, walls, doors: shifted };
  // Refit openings: a wall that moved may have shortened the run one sits in.
  // One that no longer fits anywhere stays put and the validator reports it.
  next.doors = next.doors.map((door) => {
    const [lo, hi] = openingRange(door);
    const fit = clampInto(door, lo, hi, hostRuns(next, door, door.a, door.b), MIN_DOOR);
    return fit ? { ...fit, width: openingRange(fit)[1] - openingRange(fit)[0] } : door;
  });
  next.windows = next.windows.map((w) => {
    const [lo, hi] = openingRange(w);
    return clampInto(w, lo, hi, hostRuns(next, w, w.roomId, null), MIN_WINDOW) ?? w;
  });
  return next;
}

/** The room a point lies in. */
export function roomAt(rooms: Room[], x: number, y: number): Room | undefined {
  return rooms.find((r) => partsOf(r).some((p) => x >= p.x - EPS && x <= p.x + p.w + EPS && y >= p.y - EPS && y <= p.y + p.h + EPS));
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

/**
 * Move a piece so its footprint starts at (x, y), kept inside the room it
 * lands in. Dropping it in another room moves it there.
 */
export function moveFurniture(plan: Plan, i: number, x: number, y: number, wallThickness: number): Plan {
  const list = plan.furniture ?? [];
  const f = list[i];
  const half = wallThickness / 2;
  const room = roomAt(plan.rooms, x + f.rect.w / 2, y + f.rect.h / 2) ?? plan.rooms.find((r) => r.id === f.roomId);
  if (!room) return plan;
  const b = room.rect;
  const nx = Math.min(Math.max(x, b.x + half), b.x + b.w - half - f.rect.w);
  const ny = Math.min(Math.max(y, b.y + half), b.y + b.h - half - f.rect.h);
  const furniture = list.slice();
  furniture[i] = { ...f, roomId: room.id, rect: { ...f.rect, x: nx, y: ny } };
  return { ...plan, furniture };
}

const TURN: Record<Furniture['facing'], Furniture['facing']> = { s: 'w', w: 'n', n: 'e', e: 's' };

/** Turn a piece a quarter turn clockwise about its centre. */
export function rotateFurniture(plan: Plan, i: number, wallThickness: number): Plan {
  const list = plan.furniture ?? [];
  const f = list[i];
  const cx = f.rect.x + f.rect.w / 2;
  const cy = f.rect.y + f.rect.h / 2;
  const furniture = list.slice();
  furniture[i] = { ...f, facing: TURN[f.facing], rect: { x: cx - f.rect.h / 2, y: cy - f.rect.w / 2, w: f.rect.h, h: f.rect.w } };
  const turned = { ...plan, furniture };
  return moveFurniture(turned, i, furniture[i].rect.x, furniture[i].rect.y, wallThickness);
}

export function removeAt<K extends 'furniture' | 'doors' | 'windows'>(plan: Plan, key: K, i: number): Plan {
  const list = ((plan[key] ?? []) as unknown[]).slice();
  list.splice(i, 1);
  return { ...plan, [key]: list };
}

/** Pieces that sit outside their room, on another piece, or in a door swing. */
export function furnitureClashes(plan: Plan, wallThickness: number): Set<number> {
  const out = new Set<number>();
  const list = plan.furniture ?? [];
  const half = wallThickness / 2;
  list.forEach((f, i) => {
    const room = plan.rooms.find((r) => r.id === f.roomId);
    const inRoom = room && partsOf(room).some((p) =>
      f.rect.x >= p.x + half - 1e-6 && f.rect.y >= p.y + half - 1e-6 &&
      f.rect.x + f.rect.w <= p.x + p.w - half + 1e-6 && f.rect.y + f.rect.h <= p.y + p.h - half + 1e-6);
    if (!inRoom) out.add(i);
    if (plan.doors.some((d: DoorSeg) => inDoorSwing(f.rect, d))) out.add(i);
    list.forEach((g, j) => { if (j !== i && overlaps(f.rect, g.rect)) out.add(i); });
  });
  return out;
}


/**
 * After "Regenerate rest": put each locked room back exactly as it was.
 *
 * The generator works on a 0.3 m grid, so a locked room whose walls were
 * dragged off it comes back snapped by up to half a cell. Each such wall is
 * moved back with `moveWall`, which carries the neighbour's edge with it.
 * Then the locked rooms' doors and windows return to where they were, where
 * the same wall still holds them — doors only to the same neighbour — so the
 * room's furniture still fits.
 */
export function restoreLocked(next: Plan, prev: Plan, ids: string[]): Plan {
  let p = next;
  const E = 1e-6;
  for (const id of ids) {
    const old = prev.rooms.find((r) => r.id === id);
    if (!old) continue;
    for (const axis of ['v', 'h'] as const) {
      const wanted = new Set<number>();
      for (const q of partsOf(old)) {
        if (axis === 'v') { wanted.add(q.x); wanted.add(q.x + q.w); } else { wanted.add(q.y); wanted.add(q.y + q.h); }
      }
      for (const want of wanted) {
        const cur = p.rooms.find((r) => r.id === id);
        if (!cur) break;
        // The room's own edge nearest the wanted line, and the span it covers.
        let edge: number | undefined;
        let lo = Infinity;
        let hi = -Infinity;
        for (const q of partsOf(cur)) {
          for (const e of axis === 'v' ? [q.x, q.x + q.w] : [q.y, q.y + q.h]) {
            if (Math.abs(e - want) > 0.31) continue;
            if (edge === undefined || Math.abs(e - want) < Math.abs(edge - want) - E) edge = e;
          }
        }
        if (edge === undefined || Math.abs(edge - want) < E) continue;
        for (const q of partsOf(cur)) {
          const [a, b, s0, s1] = axis === 'v' ? [q.x, q.x + q.w, q.y, q.y + q.h] : [q.y, q.y + q.h, q.x, q.x + q.w];
          if (Math.abs(a - edge) < E || Math.abs(b - edge) < E) { lo = Math.min(lo, s0); hi = Math.max(hi, s1); }
        }
        const line = wallLines(p.walls).find((l) => l.axis === axis && Math.abs(l.at - edge!) < E && Math.min(l.hi, hi) - Math.max(l.lo, lo) > E);
        if (line) p = moveWall(p, line, want) ?? p;
      }
    }
  }

  const locked = new Set(ids);
  const same = (x: { a: string; b: string | null }, y: { a: string; b: string | null }) =>
    (x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a);
  for (const d of prev.doors) {
    if (!locked.has(d.a) && !(d.b && locked.has(d.b))) continue;
    const i = p.doors.findIndex((n) => same(n, d));
    if (i < 0) continue;
    // Try the old opening; setDoor hands back the same plan when no wall the
    // two rooms share can hold it, and then the new door stays.
    const trial = { ...p, doors: p.doors.map((n, k) => (k === i ? { ...n, ...d } : n)) };
    const [lo, hi] = openingRange(d);
    const fitted = setDoor(trial, i, lo, hi);
    if (fitted !== trial) p = fitted;
  }
  for (const id of ids) {
    const olds = prev.windows.filter((w) => w.roomId === id);
    if (!olds.length) continue;
    const others = p.windows.filter((w) => w.roomId !== id);
    let trial: Plan = { ...p, windows: [...others, ...olds] };
    let ok = true;
    for (let k = others.length; k < trial.windows.length && ok; k++) {
      const [lo, hi] = openingRange(trial.windows[k]);
      const fitted = setWindow(trial, k, lo, hi);
      if (fitted === trial) ok = false;
      else trial = fitted;
    }
    if (ok) p = trial;
  }
  return p;
}
