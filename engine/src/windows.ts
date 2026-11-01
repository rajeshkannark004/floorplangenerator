import { EPS } from './geometry.js';
import type { Room } from './brief.js';
import { type WallSeg, segLen, exteriorSegmentsOf } from './walls.js';

export interface WindowSeg { x1: number; y1: number; x2: number; y2: number; roomId: string }

const MIN_SEGMENT = 1.2;

/** Windows only ever go on exterior walls, centred on the longest available run. */
export function placeWindows(rooms: Room[], walls: WallSeg[], width: number): WindowSeg[] {
  const out: WindowSeg[] = [];

  for (const room of rooms) {
    if (room.windows <= 0) continue;

    const candidates = exteriorSegmentsOf(room, walls)
      .filter((w) => segLen(w) >= MIN_SEGMENT)
      .sort((a, b) => segLen(b) - segLen(a));

    const n = Math.min(room.windows, candidates.length);
    for (let i = 0; i < n; i++) {
      const w = candidates[i];
      const len = segLen(w);
      const ww = Math.min(width, len * 0.7);
      const vertical = Math.abs(w.x1 - w.x2) < EPS;

      if (vertical) {
        const mid = (w.y1 + w.y2) / 2;
        out.push({ x1: w.x1, y1: mid - ww / 2, x2: w.x1, y2: mid + ww / 2, roomId: room.id });
      } else {
        const mid = (w.x1 + w.x2) / 2;
        out.push({ x1: mid - ww / 2, y1: w.y1, x2: mid + ww / 2, y2: w.y1, roomId: room.id });
      }
    }
  }

  return out;
}
