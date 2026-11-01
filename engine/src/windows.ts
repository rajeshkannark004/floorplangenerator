import { EPS } from './geometry.js';
import type { Room } from './brief.js';
import { type WallSeg, segLen, exteriorSegmentsOf } from './walls.js';
import type { DoorSeg } from './doors.js';

export interface WindowSeg { x1: number; y1: number; x2: number; y2: number; roomId: string }

const MIN_SEGMENT = 1.2;

const isVertical = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.abs(s.x1 - s.x2) < EPS;

/** Two runs lie on the same wall line. */
export function sameLine(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  if (isVertical(a) !== isVertical(b)) return false;
  return isVertical(a) ? Math.abs(a.x1 - b.x1) < EPS : Math.abs(a.y1 - b.y1) < EPS;
}

/** The [lo, hi] extent of a run along its own axis. */
export function extent(s: { x1: number; y1: number; x2: number; y2: number }): [number, number] {
  return isVertical(s) ? [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)] : [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
}

function complement(blocked: [number, number][], lo: number, hi: number): [number, number][] {
  if (!blocked.length) return [[lo, hi]];
  const sorted = blocked.slice().sort((a, b) => a[0] - b[0]);
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
 * Windows only ever go on exterior walls, and they slide around any door that
 * already occupies that run. Placing both independently put a window and the
 * entry door on the same stretch of wall.
 */
export function placeWindows(
  rooms: Room[],
  walls: WallSeg[],
  width: number,
  doors: DoorSeg[] = [],
): WindowSeg[] {
  const out: WindowSeg[] = [];

  for (const room of rooms) {
    if (room.windows <= 0) continue;

    const candidates = exteriorSegmentsOf(room, walls)
      .filter((w) => segLen(w) >= MIN_SEGMENT)
      .sort((a, b) => segLen(b) - segLen(a));

    let placed = 0;
    for (const w of candidates) {
      if (placed >= room.windows) break;

      const [lo, hi] = extent(w);
      const blocked = doors
        .filter((d) => sameLine(d, w))
        .map((d) => extent(d) as [number, number]);

      const free = complement(blocked, lo, hi)
        .filter(([a, b]) => b - a >= MIN_SEGMENT * 0.6)
        .sort((a, b) => b[1] - b[0] - (a[1] - a[0]));

      const run = free[0];
      if (!run) continue;

      const runLen = run[1] - run[0];
      const ww = Math.min(width, runLen * 0.8);
      const mid = (run[0] + run[1]) / 2;

      if (isVertical(w)) {
        out.push({ x1: w.x1, y1: mid - ww / 2, x2: w.x1, y2: mid + ww / 2, roomId: room.id });
      } else {
        out.push({ x1: mid - ww / 2, y1: w.y1, x2: mid + ww / 2, y2: w.y1, roomId: room.id });
      }
      placed++;
    }
  }

  return out;
}

/** Any window sharing wall space with a door. */
export function windowDoorConflicts(windows: WindowSeg[], doors: DoorSeg[]): string[] {
  const clashes: string[] = [];
  for (const win of windows) {
    const [a, b] = extent(win);
    for (const d of doors) {
      if (!sameLine(win, d)) continue;
      const [c, e] = extent(d);
      if (Math.min(b, e) - Math.max(a, c) > EPS) {
        clashes.push(`${win.roomId}: window overlaps a door on the same wall`);
        break;
      }
    }
  }
  return clashes;
}
