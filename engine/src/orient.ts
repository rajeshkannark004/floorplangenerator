import type { Rect } from './geometry.js';
import type { Brief, Room, RoomType } from './brief.js';
import { partsOf } from './shape.js';
import type { DoorSeg } from './doors.js';

/*
 * Orientation and Vastu.
 *
 * The sheet is drawn with the road at the bottom: y = 0 is the back of the
 * plot and y = fp.h the front, where `setbacks.front` lies. `facing` is the
 * compass side the road is on — an "east-facing plot" has its road on the east
 * — so the bottom of the sheet points `facing`, and north is wherever that
 * puts it.
 *
 * Vastu rules come from blogs and builders' guides, which agree on the main
 * placements and differ in detail. They are preferences that bias the
 * generator and a score the panel reports, never validation failures.
 */

export type Compass = 'N' | 'E' | 'S' | 'W';
export type CompassZone = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'C';

const ANGLE: Record<Compass, number> = { N: 0, E: 90, S: 180, W: 270 };

/** Unit vectors for compass north and east in plan coordinates (x right, y down). */
export function compassFrame(facing: Compass) {
  const f = (ANGLE[facing] * Math.PI) / 180;
  const north = { x: Math.sin(f), y: Math.cos(f) };
  // East is north turned a quarter clockwise on screen: (x, y) -> (-y, x).
  const east = { x: -north.y, y: north.x };
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { north: { x: r(north.x), y: r(north.y) }, east: { x: r(east.x), y: r(east.y) } };
}

/** The compass zone of a point: the footprint cut into thirds each way. */
export function zoneAt(fp: Rect, facing: Compass, x: number, y: number): CompassZone {
  const { north, east } = compassFrame(facing);
  const dx = (x - (fp.x + fp.w / 2)) / (fp.w / 2);
  const dy = (y - (fp.y + fp.h / 2)) / (fp.h / 2);
  const n = dx * north.x + dy * north.y;
  const e = dx * east.x + dy * east.y;
  const ns = n > 1 / 3 ? 'N' : n < -1 / 3 ? 'S' : '';
  const ew = e > 1 / 3 ? 'E' : e < -1 / 3 ? 'W' : '';
  return ((ns + ew) || 'C') as CompassZone;
}

/** Compass side of a sheet edge: 'top' is the back of the plot, 'bottom' the road. */
export function sheetSideCompass(facing: Compass, side: 'top' | 'right' | 'bottom' | 'left'): Compass {
  const offset = { top: 180, right: 270, bottom: 0, left: 90 }[side];
  const a = (ANGLE[facing] + offset) % 360;
  return (['N', 'E', 'S', 'W'] as const)[a / 90];
}

/** Area-weighted centre of a room. */
export function roomCentre(r: Room) {
  let a = 0, x = 0, y = 0;
  for (const p of partsOf(r)) {
    const pa = p.w * p.h;
    a += pa;
    x += (p.x + p.w / 2) * pa;
    y += (p.y + p.h / 2) * pa;
  }
  return { x: x / a, y: y / a };
}

/** The Vastu role of a room: the largest bedroom is the master. */
export type VastuRole = Exclude<RoomType, 'bedroom'> | 'master' | 'bedroom';

export function vastuRoles(rooms: Room[]): Map<string, VastuRole> {
  const beds = rooms.filter((r) => r.type === 'bedroom');
  const master = beds.reduce<Room | null>((m, r) => (!m || r.area > m.area + 1e-9 ? r : m), null);
  return new Map(rooms.map((r) => [r.id, r === master ? 'master' : (r.type as VastuRole)]));
}

/** Preferred, acceptable and avoided zones per role. */
interface Pref { good: CompassZone[]; ok: CompassZone[]; avoid: CompassZone[]; why: string }
export const VASTU: Partial<Record<VastuRole, Pref>> = {
  kitchen: { good: ['SE'], ok: ['NW', 'E'], avoid: ['NE', 'SW', 'N', 'C'], why: 'fire zone is the south-east' },
  master: { good: ['SW'], ok: ['S', 'W'], avoid: ['NE', 'SE', 'C'], why: 'south-west is the zone of stability for the head of the house' },
  bedroom: { good: ['W', 'NW', 'S'], ok: ['N', 'E', 'SW'], avoid: ['SE', 'C'], why: 'west and north-west suit other bedrooms' },
  living: { good: ['N', 'E', 'NE'], ok: ['NW', 'W', 'C'], avoid: ['SW'], why: 'north and east bring light into the social rooms' },
  dining: { good: ['W', 'E'], ok: ['N', 'S', 'NW', 'C'], avoid: [], why: 'west or east, near the kitchen' },
  bath: { good: ['NW', 'W'], ok: ['S', 'SE', 'E'], avoid: ['NE', 'SW', 'C'], why: 'never in the north-east or the centre' },
  utility: { good: ['NW', 'SE'], ok: ['W', 'S'], avoid: ['NE'], why: 'north-west or south-east service zone' },
  store: { good: ['SW', 'NW'], ok: ['S', 'W'], avoid: ['NE'], why: 'heavy storage in the south-west' },
};
/** Entrance sides. */
export const ENTRANCE: { good: Compass[]; avoid: Compass[] } = { good: ['N', 'E'], avoid: ['S', 'W'] };

export type Verdict = 'good' | 'ok' | 'neutral' | 'avoid';
export function verdict(role: VastuRole, zone: CompassZone): Verdict {
  const p = VASTU[role];
  if (!p) return 'neutral';
  return p.good.includes(zone) ? 'good' : p.ok.includes(zone) ? 'ok' : p.avoid.includes(zone) ? 'avoid' : 'neutral';
}

/** Penalty per verdict, for the generator's ranking. */
export const VASTU_COST: Record<Verdict, number> = { good: 0, ok: 1, neutral: 2, avoid: 6 };

/**
 * Roles whose seed is pulled towards their zone. Only the placements Vastu is
 * firm about; pulling dining or a second bedroom too tore the plan apart and
 * left rooms with no door path.
 */
const PULLED: VastuRole[] = ['kitchen', 'master', 'living', 'bath'];

/** The direction (plan vector, unit) a role would like its room to sit in, or null. */
export function preferredDirection(role: VastuRole, facing: Compass): { x: number; y: number } | null {
  if (!PULLED.includes(role)) return null;
  const z = role === 'bath' ? 'NW' : role === 'living' ? 'NE' : VASTU[role]?.good[0];
  if (!z || z === 'C') return null;
  const { north, east } = compassFrame(facing);
  let x = 0, y = 0;
  if (z.includes('N')) { x += north.x; y += north.y; }
  if (z.includes('S')) { x -= north.x; y -= north.y; }
  if (z.includes('E')) { x += east.x; y += east.y; }
  if (z.includes('W')) { x -= east.x; y -= east.y; }
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** Vastu cost of a set of rooms: lower is better. Used to rank candidates. */
export function vastuCost(rooms: Room[], fp: Rect, facing: Compass): number {
  const roles = vastuRoles(rooms);
  let s = 0;
  for (const r of rooms) {
    const c = roomCentre(r);
    s += VASTU_COST[verdict(roles.get(r.id)!, zoneAt(fp, facing, c.x, c.y))];
  }
  return s;
}

export interface VastuItem {
  label: string;
  roomId?: string;
  zone: string;
  verdict: Verdict;
  note: string;
}

/** The compass side an entry door sits on. */
export function doorCompass(fp: Rect, facing: Compass, d: DoorSeg): Compass {
  const E = 1e-6;
  const side =
    d.axis === 'h' ? (Math.abs(d.y1 - fp.y) < E ? 'top' : 'bottom') : Math.abs(d.x1 - fp.x) < E ? 'left' : 'right';
  return sheetSideCompass(facing, side);
}

const ROLE_NAME: Record<VastuRole, string> = {
  master: 'Master bedroom', bedroom: 'Bedroom', living: 'Living', dining: 'Dining', kitchen: 'Kitchen',
  bath: 'Bath', utility: 'Utility', store: 'Store', hall: 'Hall',
};

/** The Vastu report for a plan: every room's zone and verdict, and the entrance. Score is 0–100. */
export function vastuReport(plan: { rooms: Room[]; doors: DoorSeg[]; footprint: Rect }, facing: Compass) {
  const roles = vastuRoles(plan.rooms);
  const items: VastuItem[] = [];
  const counts = new Map<string, number>();
  for (const r of plan.rooms) counts.set(roles.get(r.id)!, (counts.get(roles.get(r.id)!) ?? 0) + 1);
  for (const r of plan.rooms) {
    const role = roles.get(r.id)!;
    if (!VASTU[role]) continue;
    const c = roomCentre(r);
    const zone = zoneAt(plan.footprint, facing, c.x, c.y);
    const v = verdict(role, zone);
    const n = (counts.get(role) ?? 0) > 1 ? ` ${r.id.split('-').pop()}` : '';
    items.push({
      label: ROLE_NAME[role] + n,
      roomId: r.id,
      zone,
      verdict: v,
      note: v === 'good' ? VASTU[role]!.why : `best in ${VASTU[role]!.good.join(' / ')}${v === 'avoid' ? `; avoid ${VASTU[role]!.avoid.join(', ')}` : ''}`,
    });
  }
  const entry = plan.doors.find((d) => d.entry);
  if (entry) {
    const side = doorCompass(plan.footprint, facing, entry);
    const v: Verdict = ENTRANCE.good.includes(side) ? 'good' : ENTRANCE.avoid.includes(side) ? 'avoid' : 'ok';
    items.push({
      label: 'Entrance',
      zone: side,
      verdict: v,
      note: v === 'good' ? 'north or east entrance' : 'north or east is preferred; with the road on this side, a Vastu consultant may advise the door position',
    });
  }
  const points: Record<Verdict, number> = { good: 1, ok: 0.6, neutral: 0.4, avoid: 0 };
  const score = items.length ? Math.round((100 * items.reduce((s, i) => s + points[i.verdict], 0)) / items.length) : 0;
  return { items, score };
}

/** The orientation a brief asks for, if any. */
export const facingOf = (b: Brief): Compass | null => b.orientation?.facing ?? null;
