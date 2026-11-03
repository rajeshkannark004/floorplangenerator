import { type Rect, rectArea } from './geometry.js';
import type { Room, RoomType } from './brief.js';
import type { DoorSeg } from './doors.js';
import type { WindowSeg } from './windows.js';
import { partsOf } from './shape.js';

export type FurnitureKind =
  | 'bed' | 'bedNS' | 'wardrobe' | 'desk'
  | 'wc' | 'basin' | 'shower'
  | 'sofa' | 'sofaSet' | 'tv' | 'armchair'
  | 'dining4' | 'dining6' | 'sideboard'
  | 'sinkRun' | 'hobRun' | 'fridge' | 'washer';

type Side = 'n' | 's' | 'e' | 'w';

/**
 * A piece of furniture in plan metres. `rect` is its footprint; `facing` is the
 * side its front looks toward (n = -y, as SVG y grows downward). The symbol is
 * drawn in a local frame of `len` along the wall by `depth` out from it.
 */
export interface Furniture {
  kind: FurnitureKind;
  roomId: string;
  rect: Rect;
  facing: Side;
  len: number;
  depth: number;
}

/**
 * Space a piece needs around it, in its local frame (u along the wall, v out
 * from it, back edge at v = 0). Hard zones must be clear floor inside the room;
 * soft zones only earn score when they are.
 */
interface Zone { r: Rect; hard: boolean }
interface Variant { kind: FurnitureKind; len: number; depth: number; zones: Zone[] }
type Role =
  | 'bed' | 'wardrobe' | 'desk' | 'shower' | 'wc' | 'basin' | 'sofa' | 'tv' | 'armchair'
  | 'table' | 'sideboard' | 'sink' | 'hob' | 'fridge' | 'washer';
interface Spec {
  role: Role;
  /** Best first; a smaller variant earns a little less. */
  variants: Variant[];
  /** 'wall' backs onto a wall; 'free' stands anywhere on the floor. */
  mount: 'wall' | 'free';
  /** What placing the piece is worth. Relations and clearances add to it. */
  value: number;
  /** Tall pieces may not stand in front of a window. */
  tall?: boolean;
  /** Pieces of one family may butt against each other and ignore each other's clear zones (a run of counters). */
  family?: string;
}

const front = (c: number, hard = true) => (L: number, D: number): Zone => ({ r: { x: 0, y: D, w: L, h: c }, hard });
const sides = (c: number, hard: boolean, from = 0) => (L: number, D: number): Zone[] => [
  { r: { x: -c, y: from, w: c, h: D - from }, hard },
  { r: { x: L, y: from, w: c, h: D - from }, hard },
];
const ring = (c: number) => (L: number, D: number): Zone[] => [
  { r: { x: -c, y: -c, w: L + 2 * c, h: c }, hard: true },
  { r: { x: -c, y: D, w: L + 2 * c, h: c }, hard: true },
  { r: { x: -c, y: 0, w: c, h: D }, hard: true },
  { r: { x: L, y: 0, w: c, h: D }, hard: true },
];
type ZoneFn = (L: number, D: number) => Zone | Zone[];
const mk = (kind: FurnitureKind, len: number, depth: number, ...zs: ZoneFn[]): Variant =>
  ({ kind, len, depth, zones: zs.flatMap((z) => z(len, depth)) });

/*
 * Clearances are rules of thumb from interior-design guides, not code: 50–60 cm
 * beside and at the foot of a bed, 60 cm in front of a WC with its centre ~40 cm
 * off a side wall, 75–90 cm to pull a dining chair out, a 90 cm kitchen aisle,
 * ~45 cm from sofa to coffee table.
 */
const bed = (kind: 'bed' | 'bedNS', mattress: number) => {
  const L = kind === 'bedNS' ? mattress + 0.9 : mattress;
  return mk(kind, L, 2.0, front(0.5), sides(0.6, false, 0.5));
};

const FURNISH: Partial<Record<RoomType, Spec[]>> = {
  bedroom: [
    { role: 'bed', mount: 'wall', value: 5, variants: [bed('bedNS', 1.6), bed('bed', 1.6), bed('bedNS', 1.35), bed('bed', 1.35), bed('bedNS', 0.9), bed('bed', 0.9)] },
    { role: 'wardrobe', mount: 'wall', value: 2, tall: true, variants: [1.8, 1.5, 1.2, 0.9].map((l) => mk('wardrobe', l, 0.6, front(0.7))) },
    { role: 'desk', mount: 'wall', value: 0.6, variants: [1.2, 1.0].map((l) => mk('desk', l, 0.55, front(0.75))) },
  ],
  bath: [
    { role: 'shower', mount: 'wall', value: 3, variants: [mk('shower', 0.9, 0.9, front(0.6)), mk('shower', 0.8, 0.8, front(0.55))] },
    { role: 'wc', mount: 'wall', value: 3, variants: [mk('wc', 0.4, 0.7, front(0.6), sides(0.2, true))] },
    { role: 'basin', mount: 'wall', value: 2, variants: [mk('basin', 0.55, 0.45, front(0.6)), mk('basin', 0.45, 0.4, front(0.55))] },
  ],
  kitchen: [
    { role: 'sink', mount: 'wall', value: 3, family: 'counter', variants: [2.4, 2.1, 1.8, 1.5, 1.2].map((l) => mk('sinkRun', l, 0.6, front(0.9))) },
    { role: 'hob', mount: 'wall', value: 3, family: 'counter', variants: [2.1, 1.8, 1.5, 1.2, 0.9].map((l) => mk('hobRun', l, 0.6, front(0.9))) },
    { role: 'fridge', mount: 'wall', value: 1.5, family: 'counter', tall: true, variants: [mk('fridge', 0.7, 0.7, front(0.9))] },
  ],
  living: [
    {
      role: 'sofa', mount: 'wall', value: 5,
      variants: [mk('sofaSet', 2.2, 1.85, front(0.5)), mk('sofaSet', 1.8, 1.85, front(0.5)), mk('sofa', 2.2, 0.9, front(0.8)), mk('sofa', 1.6, 0.85, front(0.8))],
    },
    { role: 'tv', mount: 'wall', value: 0.5, variants: [mk('tv', 1.6, 0.4, front(0.6)), mk('tv', 1.2, 0.4, front(0.6))] },
    { role: 'armchair', mount: 'free', value: 0.2, variants: [mk('armchair', 0.8, 0.8, front(0.3))] },
  ],
  dining: [
    { role: 'table', mount: 'free', value: 5, variants: [mk('dining6', 2.3, 1.75, ring(0.35)), mk('dining4', 1.75, 1.65, ring(0.35)), mk('dining4', 1.05, 1.65, ring(0.3))] },
    { role: 'sideboard', mount: 'wall', value: 0.4, variants: [mk('sideboard', 1.4, 0.45, front(0.6)), mk('sideboard', 1.0, 0.45, front(0.6))] },
  ],
  utility: [
    { role: 'washer', mount: 'wall', value: 2, variants: [mk('washer', 0.6, 0.6, front(0.6))] },
  ],
};

/** Gap kept between pieces, and between a piece and a door swing. */
const GAP = 0.05;
/** Candidate positions are tried on this grid, in metres. */
const STEP = 0.1;
/** Partial layouts kept per room between pieces. */
const BEAM = 12;
const CELL = 0.1;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const inside = (r: Rect, box: Rect) =>
  r.x >= box.x - 1e-9 && r.y >= box.y - 1e-9 && r.x + r.w <= box.x + box.w + 1e-9 && r.y + r.h <= box.y + box.h + 1e-9;
const holds = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** The square a door leaf sweeps, taken on both sides of the wall. */
export function doorZone(d: DoorSeg): Rect {
  const lo = d.axis === 'v' ? Math.min(d.y1, d.y2) : Math.min(d.x1, d.x2);
  const hi = d.axis === 'v' ? Math.max(d.y1, d.y2) : Math.max(d.x1, d.x2);
  return d.axis === 'v'
    ? { x: d.x1 - d.width, y: lo, w: 2 * d.width, h: hi - lo }
    : { x: lo, y: d.y1 - d.width, w: hi - lo, h: 2 * d.width };
}

/**
 * Whether a footprint lands in a door's swing: the quarter disc the leaf sweeps
 * about its hinge, on either side of the wall. The hinge is at the low end of
 * the opening, as `renderSVG` draws it. Testing the disc rather than its
 * bounding square frees the corner beside the latch, which in a small bath is
 * often the only place the WC fits.
 */
export function inDoorSwing(r: Rect, d: DoorSeg, margin = 0): boolean {
  const sq = grow(doorZone(d), margin);
  const x0 = Math.max(r.x, sq.x), x1 = Math.min(r.x + r.w, sq.x + sq.w);
  const y0 = Math.max(r.y, sq.y), y1 = Math.min(r.y + r.h, sq.y + sq.h);
  if (x1 <= x0 + 1e-9 || y1 <= y0 + 1e-9) return false;
  const hx = d.axis === 'v' ? d.x1 : Math.min(d.x1, d.x2);
  const hy = d.axis === 'v' ? Math.min(d.y1, d.y2) : d.y1;
  const nx = Math.min(Math.max(hx, x0), x1);
  const ny = Math.min(Math.max(hy, y0), y1);
  return Math.hypot(nx - hx, ny - hy) < d.width + margin - 1e-9;
}

/** Map a point in a piece's local frame to the plan. Mirrors the transform in `furnitureSVG`. */
function toPlan(f: { rect: Rect; facing: Side }, u: number, v: number) {
  const { x, y, w, h } = f.rect;
  switch (f.facing) {
    case 's': return { x: x + u, y: y + v };
    case 'n': return { x: x + w - u, y: y + h - v };
    case 'e': return { x: x + v, y: y + h - u };
    case 'w': return { x: x + w - v, y: y + u };
  }
}
function rectToPlan(f: { rect: Rect; facing: Side }, r: Rect): Rect {
  const a = toPlan(f, r.x, r.y);
  const b = toPlan(f, r.x + r.w, r.y + r.h);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

interface Placed {
  spec: Spec;
  rank: number;
  v: Variant;
  rect: Rect;
  facing: Side;
  /** The wall it backs onto, and its offset along it; null when free-standing. */
  side: Side | null;
  at: number;
  span: number;
  hard: Rect[];
  soft: Rect[];
}

interface Ctx {
  type: RoomType;
  box: Rect;
  doors: DoorSeg[];
  doorZones: Rect[];
  windowRects: Rect[];
  /** Openings on each side of the room, as [lo, hi] along that side. */
  doorsOn: Record<Side, [number, number][]>;
  windowsOn: Record<Side, [number, number][]>;
}

function candidates(ctx: Ctx, spec: Spec, v: Variant, rank: number): Placed[] {
  const { box } = ctx;
  const out: Placed[] = [];
  const make = (rect: Rect, facing: Side, side: Side | null, at: number, span: number): Placed => {
    const f = { rect, facing };
    return {
      spec, rank, v, rect, facing, side, at, span,
      hard: v.zones.filter((z) => z.hard).map((z) => rectToPlan(f, z.r)),
      soft: v.zones.filter((z) => !z.hard).map((z) => rectToPlan(f, z.r)),
    };
  };
  const steps = (span: number) => {
    if (span < -1e-9) return [];
    const n = Math.floor(span / STEP + 1e-9);
    const all = Array.from({ length: n + 1 }, (_, i) => i * STEP);
    if (span - n * STEP > 1e-9) all.push(span);
    return all;
  };
  const { len: L, depth: D } = v;
  if (spec.mount === 'wall') {
    for (const side of ['n', 's', 'w', 'e'] as const) {
      const run = side === 'n' || side === 's' ? box.w : box.h;
      for (const at of steps(run - L)) {
        const rect =
          side === 'n' ? { x: box.x + at, y: box.y, w: L, h: D } :
          side === 's' ? { x: box.x + at, y: box.y + box.h - D, w: L, h: D } :
          side === 'w' ? { x: box.x, y: box.y + at, w: D, h: L } :
          { x: box.x + box.w - D, y: box.y + at, w: D, h: L };
        out.push(make(rect, OPPOSITE[side], side, at, run - L));
      }
    }
  } else {
    for (const facing of (spec.role === 'armchair' ? ['s', 'n', 'e', 'w'] : ['s', 'e']) as Side[]) {
      const w = facing === 's' || facing === 'n' ? L : D;
      const h = facing === 's' || facing === 'n' ? D : L;
      for (const ax of steps(box.w - w)) {
        for (const ay of steps(box.h - h)) out.push(make({ x: box.x + ax, y: box.y + ay, w, h }, facing, null, 0, 0));
      }
    }
  }
  return out;
}

function fits(ctx: Ctx, placed: Placed[], c: Placed): boolean {
  if (!inside(c.rect, ctx.box)) return false;
  if (c.hard.some((z) => !inside(z, ctx.box))) return false;
  if (ctx.doors.some((d) => inDoorSwing(c.rect, d, GAP))) return false;
  if (c.spec.tall && ctx.windowRects.some((w) => overlaps(c.rect, w))) return false;
  for (const p of placed) {
    const kin = !!c.spec.family && c.spec.family === p.spec.family;
    if (overlaps(c.rect, kin ? p.rect : grow(p.rect, GAP))) return false;
    if (kin) continue;
    if (p.hard.some((z) => overlaps(c.rect, z))) return false;
    if (c.hard.some((z) => overlaps(z, p.rect))) return false;
  }
  return true;
}

/** How much of the run [lo, hi] on `side` an opening covers. */
const covered = (runs: [number, number][], lo: number, hi: number) =>
  runs.some(([a, b]) => a < hi - 1e-9 && b > lo + 1e-9);
/** A wall piece's extent along its own wall, in plan coordinates. */
const along = (p: Placed): [number, number] =>
  p.side === 'n' || p.side === 's' ? [p.rect.x, p.rect.x + p.rect.w] : [p.rect.y, p.rect.y + p.rect.h];
const atCorner = (p: Placed) => p.at < 1e-6 || p.at > p.span - 1e-6;
/** The middle of a piece's front edge: where you stand to use it. */
const usePoint = (p: Placed) => toPlan(p, p.v.len / 2, p.v.depth);

/** Score a layout on what it holds, its clearances and the relations between pieces. Higher is better. */
function score(ctx: Ctx, placed: Placed[]): number {
  let s = 0;
  for (const p of placed) {
    s += p.spec.value * (1 - 0.08 * p.rank);
    for (const z of p.soft) {
      if (inside(z, ctx.box) && !placed.some((q) => q !== p && overlaps(z, q.rect))) s += 0.4;
    }
  }
  const role = (r: Role) => placed.find((p) => p.spec.role === r);

  const bed = role('bed');
  if (bed?.side) {
    // A bed head belongs on a solid wall: not the door wall, and better not under a window.
    if (ctx.doorsOn[bed.side].length) s -= 2.5;
    if (covered(ctx.windowsOn[bed.side], ...along(bed))) s -= 0.8;
    s += 0.6 * (1 - Math.abs(bed.at - bed.span / 2) / Math.max(bed.span / 2, 1e-6));
  }
  const desk = role('desk');
  if (desk?.side && covered(ctx.windowsOn[desk.side], ...along(desk))) s += 1;

  const shower = role('shower');
  if (shower && atCorner(shower)) s += 1;
  const wc = role('wc');
  const basin = role('basin');
  // One wet wall keeps the plumbing short.
  if (wc && basin && wc.side === basin.side) s += 1;
  if (wc && shower && wc.side === shower.side) s += 0.4;

  const sink = role('sink');
  const hob = role('hob');
  const fridge = role('fridge');
  if (sink?.side && covered(ctx.windowsOn[sink.side], ...along(sink))) s += 0.7;
  if (sink && hob) {
    const touching = overlaps(grow(sink.rect, 0.01), hob.rect);
    if (touching && sink.side !== hob.side) s += 1.5;      // an L
    else if (touching) s += 0.8;                           // one straight run
    else if (sink.side === OPPOSITE[hob.side!]) s += 0.6;  // a galley
  }
  if (sink && hob && fridge) {
    // Work triangle: each leg 1.2–2.7 m, the three under 7.9 m.
    const pts = [usePoint(sink), usePoint(hob), usePoint(fridge)];
    const legs = [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[0])];
    s += 1.5;
    for (const l of legs) s -= 0.6 * (Math.max(0, 1.2 - l) + Math.max(0, l - 2.7));
    s -= 0.6 * Math.max(0, legs[0] + legs[1] + legs[2] - 7.9);
  }

  const sofa = role('sofa');
  const tv = role('tv');
  if (sofa?.side && ctx.doorsOn[sofa.side].length) s -= 0.5;
  if (sofa && tv) {
    // The TV faces the sofa across the room, centred on it.
    if (tv.side === OPPOSITE[sofa.side!]) {
      const a = centre(sofa.rect), b = centre(tv.rect);
      const off = sofa.side === 'n' || sofa.side === 's' ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
      s += 2 - 1.2 * off;
    } else s -= 0.5;
  }
  const chair = role('armchair');
  if (chair) {
    // Pulled up to the coffee table, facing it; anywhere else it is clutter.
    const ok = sofa?.v.kind === 'sofaSet' && (() => {
      const table = toPlan(sofa, sofa.v.len / 2, 1.6);
      const c = centre(chair.rect);
      const look = usePoint(chair);
      // Beside the table, turned side-on to the sofa.
      const across = (chair.facing === 'e' || chair.facing === 'w') !== (sofa.facing === 'e' || sofa.facing === 'w');
      return across && dist(c, table) < 1.4 && dist(look, table) < dist(c, table) - 0.2;
    })();
    s += ok ? 1 : -1;
  }

  const table = role('table');
  if (table) s -= 0.4 * dist(centre(table.rect), centre(ctx.box));
  return s;
}

/**
 * Walkways: from the door, every piece must be reachable along a path about
 * 50 cm wide. Rewards the open floor left over.
 */
function walkway(ctx: Ctx, placed: Placed[]): number {
  const { box } = ctx;
  const nx = Math.max(1, Math.floor(box.w / CELL));
  const ny = Math.max(1, Math.floor(box.h / CELL));
  const cx = (i: number) => box.x + (i + 0.5) * (box.w / nx);
  const cy = (j: number) => box.y + (j + 0.5) * (box.h / ny);
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) if (placed.some((p) => holds(p.rect, cx(i), cy(j)))) blocked[j * nx + i] = 1;
  }
  // A cell is walkable when nothing solid, wall or furniture, is within R cells.
  const R = 2;
  const walk = new Uint8Array(nx * ny);
  for (let j = R; j < ny - R; j++) {
    for (let i = R; i < nx - R; i++) {
      let free = true;
      for (let dj = -R; dj <= R && free; dj++) for (let di = -R; di <= R; di++) if (blocked[(j + dj) * nx + i + di]) { free = false; break; }
      walk[j * nx + i] = free ? 1 : 0;
    }
  }
  const reach = new Uint8Array(nx * ny);
  const queue: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (walk[j * nx + i] && ctx.doorZones.some((z) => holds(z, cx(i), cy(j)))) { reach[j * nx + i] = 1; queue.push(j * nx + i); }
    }
  }
  if (!queue.length) return placed.length ? -5 : 0;
  while (queue.length) {
    const k = queue.pop()!;
    const i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const m = b * nx + a;
      if (walk[m] && !reach[m]) { reach[m] = 1; queue.push(m); }
    }
  }
  let s = 0;
  for (const p of placed) {
    const access = [...p.hard, ...p.soft];
    if (!access.length) access.push(grow(p.rect, 0.5));
    const ok = access.some((z) => {
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (reach[j * nx + i] && holds(grow(z, CELL), cx(i), cy(j))) return true;
      return false;
    });
    if (!ok) s -= 3;
  }
  let open = 0;
  for (let k = 0; k < reach.length; k++) open += reach[k];
  return s + 1.5 * (open / reach.length);
}

function sideRuns(part: Rect, segs: { x1: number; y1: number; x2: number; y2: number }[]): Record<Side, [number, number][]> {
  const out: Record<Side, [number, number][]> = { n: [], s: [], e: [], w: [] };
  const E = 1e-6;
  for (const g of segs) {
    if (Math.abs(g.y1 - g.y2) < E) {
      const lo = Math.max(Math.min(g.x1, g.x2), part.x), hi = Math.min(Math.max(g.x1, g.x2), part.x + part.w);
      if (hi <= lo + E) continue;
      if (Math.abs(g.y1 - part.y) < E) out.n.push([lo, hi]);
      if (Math.abs(g.y1 - part.y - part.h) < E) out.s.push([lo, hi]);
    } else if (Math.abs(g.x1 - g.x2) < E) {
      const lo = Math.max(Math.min(g.y1, g.y2), part.y), hi = Math.min(Math.max(g.y1, g.y2), part.y + part.h);
      if (hi <= lo + E) continue;
      if (Math.abs(g.x1 - part.x) < E) out.w.push([lo, hi]);
      if (Math.abs(g.x1 - part.x - part.w) < E) out.e.push([lo, hi]);
    }
  }
  return out;
}

const keyOf = (placed: Placed[]) =>
  placed.map((p) => `${p.v.kind}${p.facing}${Math.round(p.rect.x / 0.3)},${Math.round(p.rect.y / 0.3)}`).join('|');

/**
 * Furnish every room that has a furniture list. Each room is searched as a
 * whole: a beam of partial layouts grows piece by piece, every candidate
 * position scored on clearances and on how its pieces relate (bed off the
 * door wall, TV facing the sofa, sink–hob–fridge triangle), and the finalists
 * are re-ranked on walkways from the door. Deterministic: the same plan always
 * gets the same furniture, and a piece that fits nowhere is left out.
 */
export function placeFurniture(
  plan: { rooms: Room[]; doors: DoorSeg[]; windows: WindowSeg[] },
  wallThickness: number,
): Furniture[] {
  const out: Furniture[] = [];
  const half = wallThickness / 2;
  const doors = plan.doors ?? [];
  const windowRects = plan.windows.map((w) => grow({
    x: Math.min(w.x1, w.x2), y: Math.min(w.y1, w.y2), w: Math.abs(w.x2 - w.x1), h: Math.abs(w.y2 - w.y1),
  }, half + 0.1));

  for (const room of plan.rooms) {
    const specs = FURNISH[room.type];
    if (!specs) continue;
    // An L-shaped room is furnished in its largest leg.
    const part = partsOf(room).reduce((a, b) => (rectArea(b) > rectArea(a) ? b : a));
    const box: Rect = { x: part.x + half, y: part.y + half, w: part.w - 2 * half, h: part.h - 2 * half };
    const near = doors.filter((d) => overlaps(doorZone(d), box));
    const ctx: Ctx = {
      type: room.type,
      box,
      doors: near,
      doorZones: near.map(doorZone),
      windowRects,
      doorsOn: sideRuns(part, doors),
      windowsOn: sideRuns(part, plan.windows),
    };

    let beam: { placed: Placed[]; s: number }[] = [{ placed: [], s: 0 }];
    for (const spec of specs) {
      const next = new Map<string, { placed: Placed[]; s: number }>();
      const keep = (placed: Placed[]) => {
        const s = score(ctx, placed);
        const k = keyOf(placed);
        const was = next.get(k);
        if (!was || s > was.s) next.set(k, { placed, s });
      };
      for (const st of beam) {
        keep(st.placed);
        spec.variants.forEach((v, rank) => {
          for (const c of candidates(ctx, spec, v, rank)) if (fits(ctx, st.placed, c)) keep([...st.placed, c]);
        });
      }
      beam = [...next.entries()]
        .sort((a, b) => b[1].s - a[1].s || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, BEAM)
        .map(([, st]) => st);
    }

    let best: Placed[] = [];
    let bestScore = -Infinity;
    for (const st of beam) {
      const total = st.s + walkway(ctx, st.placed);
      if (total > bestScore + 1e-9) { best = st.placed; bestScore = total; }
    }
    for (const p of best) {
      out.push({ kind: p.v.kind, roomId: room.id, rect: p.rect, facing: p.facing, len: p.v.len, depth: p.v.depth });
    }
  }
  return out;
}

/**
 * A symbol is a list of drawing primitives in the piece's local frame, so the
 * SVG sheet and the DXF export draw the same thing.
 */
export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const rect = (x: number, y: number, w: number, h: number, rx = 0): Prim => ({ t: 'rect', x, y, w, h, rx });
const line = (x1: number, y1: number, x2: number, y2: number, dashed = false): Prim => ({ t: 'line', x1, y1, x2, y2, dashed });
const ellipse = (cx: number, cy: number, rx: number, ry: number): Prim => ({ t: 'ellipse', cx, cy, rx, ry });
const circle = (cx: number, cy: number, r: number): Prim => ({ t: 'circle', cx, cy, r });

/** Chairs around a table `tw` by `th` whose top-left is at (tx, ty). */
function chairs(tx: number, ty: number, tw: number, th: number, perSide: number, ends: boolean): Prim[] {
  const c = 0.42, out: Prim[] = [];
  for (let i = 0; i < perSide; i++) {
    const x = tx + (tw / perSide) * (i + 0.5) - c / 2;
    out.push(rect(x, ty - c + 0.08, c, c - 0.08, 0.05), rect(x, ty + th, c, c - 0.08, 0.05));
  }
  if (ends) {
    const y = ty + th / 2 - c / 2;
    out.push(rect(tx - c + 0.08, y, c - 0.08, c, 0.05), rect(tx + tw, y, c - 0.08, c, 0.05));
  }
  return out;
}

function bedSymbol(x: number, L: number, D: number): Prim[] {
  const two = L > 1.2;
  const pw = two ? (L - 0.3) / 2 : L - 0.2;
  const pillows = two ? [rect(x + 0.1, 0.1, pw, 0.4, 0.06), rect(x + 0.2 + pw, 0.1, pw, 0.4, 0.06)] : [rect(x + 0.1, 0.1, pw, 0.4, 0.06)];
  return [rect(x, 0, L, D), ...pillows, line(x, 0.65, x + L, 0.65), line(x + L * 0.55, 0.65, x + L, 0.95)];
}

const counter = (L: number, D: number): Prim[] => [rect(0, 0, L, D), line(0, D - 0.05, L, D - 0.05)];

/** The symbol in its local frame: `len` along the wall, `depth` out, back edge at y = 0. */
export function symbol(kind: FurnitureKind, L: number, D: number): Prim[] {
  switch (kind) {
    case 'bed':
      return bedSymbol(0, L, D);
    case 'bedNS':
      return [rect(0, 0, 0.42, 0.42, 0.03), rect(L - 0.42, 0, 0.42, 0.42, 0.03), circle(0.21, 0.21, 0.1), circle(L - 0.21, 0.21, 0.1), ...bedSymbol(0.45, L - 0.9, D)];
    case 'wardrobe':
      return [rect(0, 0, L, D), line(0.05, D / 2, L - 0.05, D / 2, true), line(L / 2, D - 0.04, L / 2, D)];
    case 'desk':
      return [rect(0, 0, L, D), rect(L / 2 - 0.22, D + 0.05, 0.44, 0.42, 0.06), line(L / 2 - 0.18, D + 0.4, L / 2 + 0.18, D + 0.4)];
    case 'wc':
      return [rect(0, 0, L, 0.2, 0.03), ellipse(L / 2, 0.2 + (D - 0.2) / 2, L / 2 - 0.02, (D - 0.2) / 2), ellipse(L / 2, 0.2 + (D - 0.2) / 2, L / 2 - 0.08, (D - 0.2) / 2 - 0.07)];
    case 'basin':
      return [rect(0, 0, L, D, 0.04), ellipse(L / 2, D / 2 + 0.02, L / 2 - 0.08, D / 2 - 0.08), circle(L / 2, 0.08, 0.025)];
    case 'shower':
      return [rect(0, 0, L, D), line(0, 0, L, D), line(L, 0, 0, D), circle(L / 2, D / 2, 0.05)];
    case 'sofa':
    case 'sofaSet':
    case 'armchair': {
      const sd = kind === 'sofaSet' ? 0.9 : D;
      const arm = kind === 'armchair' ? 0.15 : 0.2, back = 0.22;
      const seats = kind === 'armchair' ? 1 : L > 1.8 ? 3 : 2, sw = (L - 2 * arm) / seats;
      const s = [rect(0, 0, L, sd, 0.06), rect(arm, back, L - 2 * arm, sd - back)];
      for (let i = 1; i < seats; i++) s.push(line(arm + sw * i, back, arm + sw * i, sd));
      if (kind === 'sofaSet') s.push(rect(L / 2 - 0.55, sd + 0.45, 1.1, D - sd - 0.45, 0.05));
      return s;
    }
    case 'tv':
      return [rect(0, 0, L, D), rect(L * 0.15, 0.12, L * 0.7, 0.06)];
    case 'dining6':
    case 'dining4': {
      const tw = kind === 'dining6' ? 1.6 : L > 1.5 ? 1.2 : 0.9, th = 0.9;
      const tx = (L - tw) / 2, ty = (D - th) / 2;
      return [rect(tx, ty, tw, th, 0.04), ...chairs(tx, ty, tw, th, kind === 'dining6' ? 2 : L > 1.5 ? 2 : 1, kind === 'dining6' || L <= 1.5)];
    }
    case 'sideboard':
      return [rect(0, 0, L, D), line(L / 3, 0, L / 3, D), line((2 * L) / 3, 0, (2 * L) / 3, D)];
    case 'sinkRun': {
      const sx = L / 2;
      return [...counter(L, D), rect(sx - 0.25, 0.1, 0.5, 0.38, 0.05), circle(sx, 0.29, 0.03), circle(sx, 0.06, 0.02)];
    }
    case 'hobRun': {
      const hx = L / 2;
      return [...counter(L, D), rect(hx - 0.3, 0.05, 0.6, 0.5, 0.02),
        ...[[-0.14, 0.17], [0.14, 0.17], [-0.14, 0.42], [0.14, 0.42]].map(([dx, y]) => circle(hx + dx, y, 0.08))];
    }
    case 'fridge':
      return [rect(0, 0, L, D), rect(0.06, 0.06, L - 0.12, D - 0.2, 0.02), line(L * 0.3, D - 0.08, L * 0.7, D - 0.08)];
    case 'washer':
      return [rect(0, 0, L, D), circle(L / 2, D / 2 + 0.03, Math.min(L, D) / 2 - 0.08), line(0.05, 0.1, L - 0.05, 0.1)];
  }
}

/** Map a point in a piece's local frame to plan metres. */
export const furniturePoint = (f: Furniture, u: number, v: number) => toPlan(f, u, v);

const fx = (x: number) => +x.toFixed(3);

function primSVG(p: Prim): string {
  switch (p.t) {
    case 'rect':
      return `<rect x="${fx(p.x)}" y="${fx(p.y)}" width="${fx(p.w)}" height="${fx(p.h)}"${p.rx ? ` rx="${fx(p.rx)}"` : ''}/>`;
    case 'line':
      return `<line x1="${fx(p.x1)}" y1="${fx(p.y1)}" x2="${fx(p.x2)}" y2="${fx(p.y2)}"${p.dashed ? ' stroke-dasharray="0.08 0.05"' : ''}/>`;
    case 'circle':
      return `<circle cx="${fx(p.cx)}" cy="${fx(p.cy)}" r="${fx(p.r)}"/>`;
    case 'ellipse':
      return `<ellipse cx="${fx(p.cx)}" cy="${fx(p.cy)}" rx="${fx(p.rx)}" ry="${fx(p.ry)}"/>`;
  }
}

/**
 * SVG for one piece. `px`/`py` map plan metres to the page; `scale` is pixels
 * per metre, so the symbol is drawn in metres and the group scales it.
 */
export function furnitureSVG(f: Furniture, px: (x: number) => number, py: (y: number) => number, scale: number): string {
  const { x, y, w, h } = f.rect;
  const [tx, ty, rot] =
    f.facing === 's' ? [x, y, 0] :
    f.facing === 'n' ? [x + w, y + h, 180] :
    f.facing === 'e' ? [x, y + h, -90] :
    [x + w, y, 90];
  return `<g transform="translate(${px(tx).toFixed(2)} ${py(ty).toFixed(2)}) scale(${scale}) rotate(${rot})" fill="#ffffff" stroke="#6b7280" stroke-width="${fx(0.8 / scale)}">${symbol(f.kind, f.len, f.depth).map(primSVG).join('')}</g>`;
}
