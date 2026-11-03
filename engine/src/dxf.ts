import { EPS } from './geometry.js';
import type { Brief } from './brief.js';
import { labelPoint, roomArea } from './shape.js';
import { symbol, furniturePoint, type Prim, type Furniture } from './furniture.js';
import { type Plan, dimensionChains, doorSwingSide } from './render-svg.js';
import { compassFrame } from './orient.js';

/*
 * AutoCAD R12 ASCII DXF, the version every CAD program reads. Plain LINE, ARC,
 * CIRCLE and TEXT entities on named layers; no blocks, no hatches. Units are
 * millimetres, the usual drawing unit in Indian practice. Plan y grows down
 * and DXF Y grows up, so Y = -y.
 */

const MM = 1000;
const LAYERS: [name: string, colour: number][] = [
  ['WALLS', 7], ['DOORS', 3], ['WINDOWS', 5], ['FURNITURE', 8], ['TEXT', 2], ['DIMS', 1], ['PLOT', 9],
];

type Pt = { x: number; y: number };

class Writer {
  private out: string[] = [];
  pair(code: number, value: string | number) {
    this.out.push(String(code), typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(3)) : value);
  }
  line(layer: string, a: Pt, b: Pt) {
    this.pair(0, 'LINE'); this.pair(8, layer);
    this.pair(10, a.x * MM); this.pair(20, -a.y * MM); this.pair(30, 0);
    this.pair(11, b.x * MM); this.pair(21, -b.y * MM); this.pair(31, 0);
  }
  poly(layer: string, pts: Pt[], closed = true) {
    for (let i = 0; i + 1 < pts.length; i++) this.line(layer, pts[i], pts[i + 1]);
    if (closed && pts.length > 2) this.line(layer, pts[pts.length - 1], pts[0]);
  }
  circle(layer: string, c: Pt, r: number) {
    this.pair(0, 'CIRCLE'); this.pair(8, layer);
    this.pair(10, c.x * MM); this.pair(20, -c.y * MM); this.pair(30, 0); this.pair(40, r * MM);
  }
  /** Arc between two plan angles (degrees, y down), the quarter they span. */
  arc(layer: string, c: Pt, r: number, a0: number, a1: number) {
    // Flipping y mirrors angles; DXF arcs run counter-clockwise from 50 to 51.
    let s = ((-a0 % 360) + 360) % 360;
    let e = ((-a1 % 360) + 360) % 360;
    if ((e - s + 360) % 360 > 180) [s, e] = [e, s];
    this.pair(0, 'ARC'); this.pair(8, layer);
    this.pair(10, c.x * MM); this.pair(20, -c.y * MM); this.pair(30, 0); this.pair(40, r * MM);
    this.pair(50, s); this.pair(51, e);
  }
  text(layer: string, at: Pt, height: number, value: string, rotation = 0) {
    this.pair(0, 'TEXT'); this.pair(8, layer);
    this.pair(10, at.x * MM); this.pair(20, -at.y * MM); this.pair(30, 0);
    this.pair(40, height * MM); this.pair(1, value);
    if (rotation) this.pair(50, rotation);
    // Centred on the insertion point.
    this.pair(72, 1); this.pair(73, 2);
    this.pair(11, at.x * MM); this.pair(21, -at.y * MM); this.pair(31, 0);
  }
  toString() {
    return this.out.join('\r\n') + '\r\n';
  }
}

/** Parts of [lo, hi] not covered by any interval in `cuts`. */
function subtract(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of cuts.slice().sort((p, q) => p[0] - q[0])) {
    if (b <= cur + EPS || a >= hi - EPS) continue;
    if (a > cur + EPS) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < hi - EPS) out.push([cur, hi]);
  return out;
}

function furniturePrims(w: Writer, f: Furniture) {
  const P = (u: number, v: number) => furniturePoint(f, u, v);
  for (const p of symbol(f.kind, f.len, f.depth) as Prim[]) {
    if (p.t === 'rect') w.poly('FURNITURE', [P(p.x, p.y), P(p.x + p.w, p.y), P(p.x + p.w, p.y + p.h), P(p.x, p.y + p.h)]);
    else if (p.t === 'line') w.line('FURNITURE', P(p.x1, p.y1), P(p.x2, p.y2));
    else if (p.t === 'circle') w.circle('FURNITURE', P(p.cx, p.cy), p.r);
    else {
      const pts: Pt[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        pts.push(P(p.cx + p.rx * Math.cos(a), p.cy + p.ry * Math.sin(a)));
      }
      w.poly('FURNITURE', pts);
    }
  }
}

/** The plan as an R12 DXF drawing in millimetres. */
export function planDXF(plan: Plan, brief: Brief): string {
  const w = new Writer();
  const t = brief.wallThickness;

  w.pair(0, 'SECTION'); w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER'); w.pair(1, 'AC1009');
  w.pair(9, '$INSUNITS'); w.pair(70, 4);
  w.pair(0, 'ENDSEC');

  w.pair(0, 'SECTION'); w.pair(2, 'TABLES');
  w.pair(0, 'TABLE'); w.pair(2, 'LTYPE'); w.pair(70, 1);
  w.pair(0, 'LTYPE'); w.pair(2, 'CONTINUOUS'); w.pair(70, 0); w.pair(3, 'Solid line'); w.pair(72, 65); w.pair(73, 0); w.pair(40, 0);
  w.pair(0, 'ENDTAB');
  w.pair(0, 'TABLE'); w.pair(2, 'LAYER'); w.pair(70, LAYERS.length);
  for (const [name, colour] of LAYERS) {
    w.pair(0, 'LAYER'); w.pair(2, name); w.pair(70, 0); w.pair(62, colour); w.pair(6, 'CONTINUOUS');
  }
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');

  w.pair(0, 'SECTION'); w.pair(2, 'ENTITIES');

  // plot boundary
  const sb = brief.setbacks;
  w.poly('PLOT', [
    { x: -sb.left, y: -sb.back }, { x: brief.plot.w - sb.left, y: -sb.back },
    { x: brief.plot.w - sb.left, y: brief.plot.d - sb.back }, { x: -sb.left, y: brief.plot.d - sb.back },
  ]);

  // walls: outline each run, broken at its openings
  const openings = [...plan.doors, ...plan.windows];
  for (const seg of plan.walls) {
    const v = Math.abs(seg.x1 - seg.x2) < EPS;
    const at = v ? seg.x1 : seg.y1;
    const lo = v ? Math.min(seg.y1, seg.y2) : Math.min(seg.x1, seg.x2);
    const hi = v ? Math.max(seg.y1, seg.y2) : Math.max(seg.x1, seg.x2);
    const cuts = openings
      .filter((o) => (Math.abs(o.x1 - o.x2) < EPS) === v && Math.abs((v ? o.x1 : o.y1) - at) < EPS)
      .map((o): [number, number] => (v ? [Math.min(o.y1, o.y2), Math.max(o.y1, o.y2)] : [Math.min(o.x1, o.x2), Math.max(o.x1, o.x2)]));
    const half = (seg.exterior ? t : t * 0.75) / 2;
    for (const [a, b] of subtract(lo, hi, cuts)) {
      // Run the outline half a wall past each end so corners close.
      const a2 = a - (Math.abs(a - lo) < EPS ? half : 0);
      const b2 = b + (Math.abs(b - hi) < EPS ? half : 0);
      w.poly('WALLS', v
        ? [{ x: at - half, y: a2 }, { x: at + half, y: a2 }, { x: at + half, y: b2 }, { x: at - half, y: b2 }]
        : [{ x: a2, y: at - half }, { x: b2, y: at - half }, { x: b2, y: at + half }, { x: a2, y: at + half }]);
    }
  }

  // doors: leaf and swing, as on the sheet
  for (const d of plan.doors) {
    const side = doorSwingSide(plan, d);
    if (!side) continue;
    if (d.axis === 'v') {
      const hinge = { x: d.x1, y: Math.min(d.y1, d.y2) };
      w.line('DOORS', hinge, { x: hinge.x + side * d.width, y: hinge.y });
      w.arc('DOORS', hinge, d.width, side === 1 ? 0 : 180, 90);
    } else {
      const hinge = { x: Math.min(d.x1, d.x2), y: d.y1 };
      w.line('DOORS', hinge, { x: hinge.x, y: hinge.y + side * d.width });
      w.arc('DOORS', hinge, d.width, side === 1 ? 90 : 270, side === 1 ? 0 : 360);
    }
  }

  // windows: three glazing lines and the jambs
  for (const win of plan.windows) {
    const v = Math.abs(win.x1 - win.x2) < EPS;
    const lo = v ? Math.min(win.y1, win.y2) : Math.min(win.x1, win.x2);
    const hi = v ? Math.max(win.y1, win.y2) : Math.max(win.x1, win.x2);
    const at = v ? win.x1 : win.y1;
    const P = (along: number, across: number): Pt => (v ? { x: across, y: along } : { x: along, y: across });
    for (const o of [-t / 2, 0, t / 2]) w.line('WINDOWS', P(lo, at + o), P(hi, at + o));
    w.line('WINDOWS', P(lo, at - t / 2), P(lo, at + t / 2));
    w.line('WINDOWS', P(hi, at - t / 2), P(hi, at + t / 2));
  }

  for (const f of plan.furniture ?? []) furniturePrims(w, f);

  // room names and areas
  for (const r of plan.rooms) {
    const at = labelPoint(r);
    const name = r.type.charAt(0).toUpperCase() + r.type.slice(1);
    w.text('TEXT', { x: at.x, y: at.y - 0.15 }, 0.2, name);
    w.text('TEXT', { x: at.x, y: at.y + 0.15 }, 0.14, `${roomArea(r).toFixed(2)} m2`);
  }

  // dimensions, as lines and text so every program shows the same thing
  const fp = plan.footprint;
  const half = t / 2;
  for (const c of dimensionChains(plan)) {
    const horizontal = c.side === 'n' || c.side === 's';
    const out = half + c.offset;
    const at = c.side === 'n' || c.side === 'w' ? -out : (horizontal ? fp.h : fp.w) + out;
    const P = (along: number, across: number): Pt => (horizontal ? { x: along, y: across } : { x: across, y: along });
    w.line('DIMS', P(c.marks[0], at), P(c.marks[c.marks.length - 1], at));
    for (const m of c.marks) {
      w.line('DIMS', P(m, at - 0.08), P(m, at + 0.08));
      const k = 0.06;
      w.line('DIMS', horizontal ? { x: m - k, y: at + k } : { x: at - k, y: m + k }, horizontal ? { x: m + k, y: at - k } : { x: at + k, y: m - k });
    }
    for (let i = 1; i < c.marks.length; i++) {
      const len = c.marks[i] - c.marks[i - 1];
      if (len < 0.4) continue;
      const mid = (c.marks[i] + c.marks[i - 1]) / 2;
      w.text('DIMS', P(mid, at - 0.12), 0.12, String(Math.round(len * MM)), horizontal ? 0 : 90);
    }
  }

  // north arrow beyond the top-right corner of the plot, and the road
  const facing = brief.orientation?.facing;
  if (facing) {
    const { north } = compassFrame(facing);
    const c = { x: brief.plot.w - sb.left + 1, y: -sb.back - 1 };
    const r = 0.6;
    const tip = { x: c.x + north.x * r, y: c.y + north.y * r };
    const tail = { x: c.x - north.x * r, y: c.y - north.y * r };
    const side = { x: -north.y * 0.2, y: north.x * 0.2 };
    w.circle('TEXT', c, r + 0.1);
    w.poly('TEXT', [tip, { x: tail.x + side.x, y: tail.y + side.y }, { x: tail.x - side.x, y: tail.y - side.y }]);
    w.text('TEXT', { x: c.x + north.x * (r + 0.35), y: c.y + north.y * (r + 0.35) }, 0.25, 'N');
    w.text('TEXT', { x: fp.w / 2, y: fp.h + sb.front + 0.4 }, 0.25, `ROAD (${facing}-FACING)`);
  }

  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');
  return w.toString();
}
