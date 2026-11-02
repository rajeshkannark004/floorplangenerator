import { type Rect, EPS } from './geometry.js';
import { longestSharedEdge } from './shape.js';
import { type Room, type RoomType, ADJACENCY } from './brief.js';
import { type WallSeg, segLen, exteriorSegmentsOf } from './walls.js';

export type Rng = () => number;

export interface DoorSeg {
  /** The opening, along the wall line. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 'v' = opening in a vertical wall, 'h' = opening in a horizontal wall. */
  axis: 'v' | 'h';
  width: number;
  /** Room on one side. */
  a: string;
  /** Room on the other side, or null for the entry door. */
  b: string | null;
  entry: boolean;
}

export const DOOR_WIDTH = 0.9;
/** Keep an opening this far off the ends of the shared segment. */
export const DOOR_CLEARANCE = 0.15;

/** Rooms whose door partner is assigned explicitly rather than by room type. */
const PAIRED_TYPES = new Set<RoomType>(['bath', 'utility']);

/**
 * How many interior doors a room may have. One is the rule for anything you
 * sit or sleep in; the rooms that carry circulation get two; the hall carries
 * as many as it needs.
 */
export function doorCapacity(type: RoomType): number {
  if (type === 'hall') return Number.POSITIVE_INFINITY;
  if (type === 'living' || type === 'dining' || type === 'kitchen') return 2;
  return 1;
}

const norm = (t: string) => t.toLowerCase();

/** Is this pair of room types allowed to share a door? Symmetric. */
export function allowedPair(x: RoomType, y: RoomType): boolean {
  const a = norm(x);
  const b = norm(y);
  return ADJACENCY.some(([p, q]) => (norm(p) === a && norm(q) === b) || (norm(p) === b && norm(q) === a));
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Centre an opening of `width` on [lo, hi], keeping `clearance` off both ends.
 * Returns null when the run is too short to hold a door.
 */
function opening(lo: number, hi: number, width: number, rng: Rng): [number, number] | null {
  const run = hi - lo;
  if (run < width + 2 * DOOR_CLEARANCE) return null;

  // Doors sit beside a corner, not in the middle of the wall. Centring every
  // opening put them all at the midpoint of their run, which read as a row of
  // doors marching down the middle of the plan. The corner is chosen by the
  // seeded rng, so it varies by seed but a seed always reproduces it.
  const slack = run - width - 2 * DOOR_CLEARANCE;
  const inset = DOOR_CLEARANCE + rng() * Math.min(0.45, slack);
  const atLow = rng() < 0.5;
  const a = atLow ? lo + inset : hi - inset - width;
  return [a, a + width];
}

export type BathRole = 'ensuite' | 'common';

export interface BathAssignment {
  bathId: string;
  role: BathRole;
  /** The bedroom this bath belongs to, or null for a common bath. */
  partnerId: string | null;
}

/**
 * Give every bath a role. A bath is never just "a bath": it is either en suite
 * to one specific bedroom, or common and opening onto circulation.
 *
 * How many of each comes from the counts, not from chance: a house keeps one
 * common bath, and every bath beyond that is en suite. So 1 bath / 2 bedrooms
 * is a single common bath, 2 baths / 2 bedrooms is one of each, 3 baths /
 * 3 bedrooms is one common and two en suite.
 *
 * Which bath plays which role, and which bedroom an en suite belongs to, is
 * drawn from the seeded rng — so it varies between seeds but a seed always
 * reproduces the same pairing.
 */
export function assignBaths(rooms: Room[], rng: Rng): BathAssignment[] {
  const baths = rooms.filter((r) => r.type === 'bath');
  const bedrooms = rooms.filter((r) => r.type === 'bedroom');
  if (!baths.length) return [];

  const commonCount = Math.min(baths.length, Math.max(1, baths.length - Math.max(0, bedrooms.length - 1)));
  const shuffledBaths = shuffle(baths.slice(), rng);
  const common = shuffledBaths.slice(0, commonCount);
  const ensuite = shuffledBaths.slice(commonCount);
  const shuffledBedrooms = shuffle(bedrooms.slice(), rng);

  const out: BathAssignment[] = [];
  for (const b of common) out.push({ bathId: b.id, role: 'common', partnerId: null });
  ensuite.forEach((b, i) => {
    const partner = shuffledBedrooms.length ? shuffledBedrooms[i % shuffledBedrooms.length] : null;
    out.push({ bathId: b.id, role: 'ensuite', partnerId: partner ? partner.id : null });
  });
  return out;
}

/**
 * Doors, per Marson & Musse: an opening only where two rooms share an edge
 * *and* the pair is allowed to connect. Baths and the utility room get an
 * assigned partner instead of the room-type table, so a bath opens into one
 * specific bedroom — or onto circulation if it is the common one — and never
 * into both bedrooms at once.
 */
export function placeDoors(rooms: Room[], walls: WallSeg[], fp: Rect, rng: Rng = Math.random): DoorSeg[] {
  const out: DoorSeg[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>(rooms.map((r) => [r.id, 0]));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');

  const assignments = assignBaths(rooms, rng);
  const bathPartner = new Map<string, string>();
  for (const a of assignments) if (a.partnerId) bathPartner.set(a.bathId, a.partnerId);

  const addDoor = (a: Room, b: Room): boolean => {
    const k = pairKey(a.id, b.id);
    if (seen.has(k)) return false;
    const e = longestSharedEdge(a, b);
    if (!e) return false;
    const span = opening(e.lo, e.hi, DOOR_WIDTH, rng);
    if (!span) return false;
    seen.add(k);
    degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
    degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
    out.push(
      e.axis === 'v'
        ? { x1: e.at, y1: span[0], x2: e.at, y2: span[1], axis: 'v', width: DOOR_WIDTH, a: a.id, b: b.id, entry: false }
        : { x1: span[0], y1: e.at, x2: span[1], y2: e.at, axis: 'h', width: DOOR_WIDTH, a: a.id, b: b.id, entry: false },
    );
    return true;
  };

  /**
   * Can these two rooms share a door at all? A bath or utility room is governed
   * by its own rule alone — requiring the *other* room's type pair to allow it
   * too is what made bath-to-living impossible, since the table lists
   * bedroom-bath but not living-bath.
   */
  const canPair = (a: Room, b: Room): boolean => {
    const special = a.type === 'bath' || a.type === 'utility' ? a : b.type === 'bath' || b.type === 'utility' ? b : null;
    if (!special) return allowedPair(a.type, b.type);
    const other = special.id === a.id ? b : a;
    if (special.type === 'bath') {
      const partner = bathPartner.get(special.id);
      return Boolean((partner && other.id === partner) || other.type === 'hall' || other.type === 'dining' || other.type === 'living');
    }
    return other.type === 'kitchen' || other.type === 'hall' || other.type === 'dining';
  };

  /** Lower is better. The hall is always the preferred thing to open onto. */
  const partnerRank = (room: Room, other: Room): number => {
    if (room.type === 'bath') {
      if (bathPartner.get(room.id) === other.id) return 0;
      if (other.type === 'hall') return 1;
      if (other.type === 'dining') return 2;
      return 3;
    }
    if (room.type === 'utility') {
      if (other.type === 'kitchen') return 0;
      if (other.type === 'hall') return 1;
      return 2;
    }
    if (other.type === 'hall') return 0;
    if (other.type === 'living' || other.type === 'dining') return 1;
    return 2;
  };

  // 1. Ordinary doors, straight from the type table.
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const ra = rooms[i];
      const rb = rooms[j];
      if (PAIRED_TYPES.has(ra.type) || PAIRED_TYPES.has(rb.type)) continue;
      if (!allowedPair(ra.type, rb.type)) continue;
      addDoor(ra, rb);
    }
  }

  // 2. One door per bath, into the room its role says it belongs to. Order
  // matters: own bedroom, then hall, then dining, then living.
  const bathFallback = [
    ...rooms.filter((r) => r.type === 'hall'),
    ...rooms.filter((r) => r.type === 'dining'),
    ...rooms.filter((r) => r.type === 'living'),
  ];
  // A partner has to share enough wall to hold a door. Taking the first room
  // that merely touched left a bath with no door at all when that touch was a
  // sliver, even though the next room in line had a full wall to offer.
  const fits = (a: Room, b: Room) => (longestSharedEdge(a, b)?.len ?? 0) >= DOOR_WIDTH + 2 * DOOR_CLEARANCE;
  const pickPartner = (room: Room, order: (Room | undefined)[]): Room | null => {
    for (const c of order) {
      if (c && c.id !== room.id && fits(room, c)) return c;
    }
    return null;
  };
  for (const asg of assignments) {
    const bath = byId.get(asg.bathId);
    if (!bath) continue;
    const preferred = asg.role === 'ensuite' && asg.partnerId ? byId.get(asg.partnerId) : undefined;
    // An en suite opens onto its own bedroom if it can, else onto whichever
    // bedroom it does share a wall with. The partner is drawn before the
    // layout is known, so insisting on it alone left baths with no door.
    // A common bath that touches no circulation opens into a bedroom rather
    // than having no door at all — it becomes en suite in all but name.
    const bedrooms = rooms.filter((r) => r.type === 'bedroom' && r !== preferred);
    const order = asg.role === 'ensuite' ? [preferred, ...bedrooms, ...bathFallback] : [...bathFallback, ...bedrooms];
    const partner = pickPartner(bath, order);
    if (partner) addDoor(bath, partner);
  }

  // 3. Utility opens onto the kitchen, else onto the hall or dining.
  for (const u of rooms.filter((r) => r.type === 'utility')) {
    const partner = pickPartner(
      u,
      rooms.filter((r) => r.type === 'kitchen' || r.type === 'hall' || r.type === 'dining'),
    );
    if (partner) addDoor(u, partner);
  }

  const living = rooms.find((r) => r.type === 'living') ?? rooms[0];

  // Entry: the longest exterior run on the living room, preferring the front
  // (lowest y) elevation.
  if (living) {
    const runs = exteriorSegmentsOf(living, walls)
      .filter((w) => segLen(w) >= 1.0 + 2 * DOOR_CLEARANCE)
      .sort((p, q) => {
        const pFront = Math.abs(Math.min(p.y1, p.y2) - fp.y) < EPS ? 1 : 0;
        const qFront = Math.abs(Math.min(q.y1, q.y2) - fp.y) < EPS ? 1 : 0;
        if (pFront !== qFront) return qFront - pFront;
        return segLen(q) - segLen(p);
      });
    const w = runs[0];
    if (w) {
      const vertical = Math.abs(w.x1 - w.x2) < EPS;
      const span = opening(
        vertical ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2),
        vertical ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2),
        1.0,
        rng,
      );
      if (span) {
        out.push(
          vertical
            ? { x1: w.x1, y1: span[0], x2: w.x1, y2: span[1], axis: 'v', width: 1.0, a: living.id, b: null, entry: true }
            : { x1: span[0], y1: w.y1, x2: span[1], y2: w.y1, axis: 'h', width: 1.0, a: living.id, b: null, entry: true },
        );
      }
    }
  }

  return out;
}

/** Door count per room id, used to keep any one room from becoming a hallway. */
export function doorDegrees(doors: DoorSeg[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const d of doors) {
    if (!d.b) continue;
    n.set(d.a, (n.get(d.a) ?? 0) + 1);
    n.set(d.b, (n.get(d.b) ?? 0) + 1);
  }
  return n;
}

function doorGraph(rooms: Room[], doors: DoorSeg[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const r of rooms) adj.set(r.id, []);
  for (const d of doors) {
    if (!d.b) continue;
    adj.get(d.a)?.push(d.b);
    adj.get(d.b)?.push(d.a);
  }
  return adj;
}

function reachableFrom(rooms: Room[], doors: DoorSeg[], entryType = 'living'): Set<string> {
  const seen = new Set<string>();
  if (!rooms.length) return seen;
  const entry = rooms.find((r) => r.type === entryType) ?? rooms[0];
  const adj = doorGraph(rooms, doors);
  seen.add(entry.id);
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
  return seen;
}

/** Rooms you can actually walk to, starting from the living room and passing through doors. */
export function unreachableThroughDoors(rooms: Room[], doors: DoorSeg[], entryType = 'living'): number {
  if (!rooms.length) return 0;
  return rooms.length - reachableFrom(rooms, doors, entryType).size;
}

/** Ids of the rooms with no door path from the living room. */
export function unreachableRoomIds(rooms: Room[], doors: DoorSeg[], entryType = 'living'): string[] {
  if (!rooms.length) return [];
  const seen = reachableFrom(rooms, doors, entryType);
  return rooms.filter((r) => !seen.has(r.id)).map((r) => r.id);
}

/** Interior doors per room id. */
export function doorsPerRoom(doors: DoorSeg[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const d of doors) {
    if (!d.b) continue;
    n.set(d.a, (n.get(d.a) ?? 0) + 1);
    n.set(d.b, (n.get(d.b) ?? 0) + 1);
  }
  return n;
}
