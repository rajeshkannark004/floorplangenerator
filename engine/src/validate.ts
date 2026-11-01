import { rectArea, EPS } from './geometry.js';
import type { Brief, Room } from './brief.js';
import type { WallSeg } from './walls.js';
import type { WindowSeg } from './windows.js';
import { windowDoorConflicts } from './windows.js';
import { unreachableCount } from './score.js';
import { type DoorSeg, unreachableRoomIds, doorsPerRoom } from './doors.js';

export function validate(
  rooms: Room[],
  walls: WallSeg[],
  windows: WindowSeg[],
  fp: { w: number; h: number },
  brief: Brief,
  doors?: DoorSeg[],
): string[] {
  const problems: string[] = [];

  // An infeasible brief comes back as an empty plan; there is no geometry to
  // check, and generate() already carries the reason.
  if (!rooms.length) return problems;

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

  if (doors) {
    const stuck = unreachableRoomIds(rooms, doors);
    if (stuck.length) problems.push(`no door path from living: ${stuck.join(', ')}`);
    const per = doorsPerRoom(doors);
    for (const r of rooms) {
      if (r.type === 'bath' && (per.get(r.id) ?? 0) > 1) {
        problems.push(`${r.id}: ${per.get(r.id)} doors — a bath takes one`);
      }
    }
  } else {
    const unreachable = unreachableCount(rooms);
    if (unreachable > 0) problems.push(`${unreachable} room(s) unreachable from living`);
  }

  for (const r of rooms) {
    if (!r.daylight) continue;
    if (!windows.some((w) => w.roomId === r.id)) problems.push(`${r.id}: daylight room with no window`);
  }

  for (const c of windowDoorConflicts(windows, doors ?? [])) problems.push(c);

  if (!walls.some((w) => w.exterior)) problems.push('no exterior walls generated');
  if (brief.wallThickness <= 0) problems.push('wall thickness must be positive');

  return problems;
}

export const EPSILON = EPS;
