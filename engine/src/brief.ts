import type { Rect } from './geometry.js';

export type RoomType = 'living' | 'dining' | 'kitchen' | 'bedroom' | 'bath' | 'utility' | 'store' | 'hall';

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
  // A hall is a corridor: it is meant to be long, so it is exempt from the
  // usual aspect penalty. Area is a starting value, like the rest.
  hall:    { area: 4,  minW: 1.0, daylight: false, windows: 0 },
};

/**
 * Functional zones, after Marson & Musse (2010), "Automatic Real-Time
 * Generation of Floor Plans Based on Squarified Treemaps Algorithm".
 * The footprint is partitioned into zones first, then each zone into rooms.
 */
/** Corridor depth in metres. The hall spans the buildable width. */
export const HALL_DEPTH = 1.2;

export type Zone = 'social' | 'service' | 'private';

export const ZONE_OF: Record<RoomType, Zone> = {
  living: 'social',
  dining: 'social',
  kitchen: 'service',
  utility: 'service',
  store: 'service',
  bedroom: 'private',
  bath: 'private',
  hall: 'service',
};

/** Room-type pairs that may share a door. Read as a starting point, not verified norms. */
export const ADJACENCY: [RoomType, RoomType][] = [
  ['living', 'dining'],
  ['dining', 'kitchen'],
  ['living', 'bedroom'],
  ['bedroom', 'bath'],
  ['kitchen', 'utility'],
  ['hall', 'living'],
  ['hall', 'dining'],
  ['hall', 'kitchen'],
  ['hall', 'bedroom'],
  ['hall', 'bath'],
  ['hall', 'utility'],
  ['hall', 'store'],
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

/**
 * Add the circulation spine. Rooms reached only through another room are not
 * habitable, and without a corridor the only way to the far bedroom is through
 * a bath. Injecting a hall as an ordinary room lets the existing partitioner
 * and the existing door rules place it — no separate corridor geometry.
 */
export function withHall(rooms: Room[], fp: Rect): Room[] {
  if (rooms.some((r) => r.type === 'hall')) return rooms;
  const d = DEFAULTS.hall;
  // The hall is a spine: it runs the full width of the buildable area, so its
  // area is set by that width times a corridor depth, not by a fixed number.
  const area = Math.max(d.area, HALL_DEPTH * fp.w);
  return [
    ...rooms,
    { id: 'hall-1', type: 'hall', area, minW: d.minW, daylight: d.daylight, windows: d.windows, rect: { x: 0, y: 0, w: 0, h: 0 } },
  ];
}

/** Scale target areas so the programme exactly fills the buildable footprint. */
export function normaliseAreas(rooms: Room[], fp: Rect): Room[] {
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const k = (fp.w * fp.h) / total;
  return rooms.map((r) => ({ ...r, area: r.area * k }));
}
