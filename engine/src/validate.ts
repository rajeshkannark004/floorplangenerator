import { rectArea, EPS } from './geometry.js';
import type { Brief, Room } from './brief.js';
import type { WallSeg } from './walls.js';
import type { WindowSeg } from './windows.js';
import { unreachableCount } from './score.js';

export function validate(
  rooms: Room[],
  walls: WallSeg[],
  windows: WindowSeg[],
  fp: { w: number; h: number },
  brief: Brief,
): string[] {
  const problems: string[] = [];

  const covered = rooms.reduce((s, r) => s + rectArea(r.rect), 0);
  if (Math.abs(covered - fp.w * fp.h) > 0.01) {
    problems.push(`coverage ${covered.toFixed(2)} m² vs footprint ${(fp.w * fp.h).toFixed(2)} m²`);
  }

  for (const r of rooms) {
    const m = Math.min(r.rect.w, r.rect.h);
    if (m < r.minW - 0.01) {
      problems.push(`${r.id}: min dimension ${m.toFixed(2)} m < ${r.minW} m`);
    }
  }

  const unreachable = unreachableCount(rooms);
  if (unreachable > 0) problems.push(`${unreachable} room(s) unreachable from living`);

  for (const r of rooms) {
    if (!r.daylight) continue;
    if (!windows.some((w) => w.roomId === r.id)) problems.push(`${r.id}: daylight room with no window`);
  }

  if (!walls.some((w) => w.exterior)) problems.push('no exterior walls generated');
  if (brief.wallThickness <= 0) problems.push('wall thickness must be positive');

  return problems;
}

export const EPSILON = EPS;
