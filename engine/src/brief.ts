import type { Rect } from './geometry.js';

export type RoomType = 'living' | 'dining' | 'kitchen' | 'bedroom' | 'bath' | 'utility' | 'store';

export interface RoomSpec {
  type: RoomType;
  count: number;
  area: number;
  minW: number;
  daylight: boolean;
  windows: number;
}

export interface Brief {
  plot: { w: number; d: number };
  setbacks: { front: number; back: number; left: number; right: number };
  wallThickness: number;
  windowWidth: number;
  rooms: RoomSpec[];
}

export interface Room {
  id: string;
  type: RoomType;
  area: number;
  minW: number;
  daylight: boolean;
  windows: number;
  rect: Rect;
}

/** Starting values only — verify against local building norms before trusting them. */
export const DEFAULTS: Record<RoomType, Omit<RoomSpec, 'type' | 'count'>> = {
  living:  { area: 16, minW: 3.0, daylight: true,  windows: 2 },
  dining:  { area: 10, minW: 2.4, daylight: true,  windows: 1 },
  kitchen: { area: 8,  minW: 2.1, daylight: true,  windows: 1 },
  bedroom: { area: 12, minW: 2.7, daylight: true,  windows: 1 },
  bath:    { area: 4,  minW: 1.5, daylight: false, windows: 0 },
  utility: { area: 3,  minW: 1.2, daylight: true,  windows: 1 },
  store:   { area: 2,  minW: 1.0, daylight: false, windows: 0 },
};

/**
 * Functional zones, after Marson & Musse (2010), "Automatic Real-Time
 * Generation of Floor Plans Based on Squarified Treemaps Algorithm".
 * The footprint is partitioned into zones first, then each zone into rooms.
 */
export type Zone = 'social' | 'service' | 'private';

export const ZONE_OF: Record<RoomType, Zone> = {
  living: 'social',
  dining: 'social',
  kitchen: 'service',
  utility: 'service',
  store: 'service',
  bedroom: 'private',
  bath: 'private',
};

/** Room-type pairs that may share a door. Read as a starting point, not verified norms. */
export const ADJACENCY: [RoomType, RoomType][] = [
  ['living', 'dining'],
  ['dining', 'kitchen'],
  ['living', 'bedroom'],
  ['bedroom', 'bath'],
];

export function footprint(b: Brief): Rect {
  return {
    x: 0,
    y: 0,
    w: b.plot.w - b.setbacks.left - b.setbacks.right,
    h: b.plot.d - b.setbacks.front - b.setbacks.back,
  };
}

export function program(b: Brief): Room[] {
  const rooms: Room[] = [];
  for (const spec of b.rooms) {
    for (let i = 1; i <= spec.count; i++) {
      rooms.push({
        id: `${spec.type}-${i}`,
        type: spec.type,
        area: spec.area,
        minW: spec.minW,
        daylight: spec.daylight,
        windows: spec.windows,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      });
    }
  }
  return rooms;
}

/** Scale target areas so the programme exactly fills the buildable footprint. */
export function normaliseAreas(rooms: Room[], fp: Rect): Room[] {
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const k = (fp.w * fp.h) / total;
  return rooms.map((r) => ({ ...r, area: r.area * k }));
}
