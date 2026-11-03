import type { Brief, Room } from './brief.js';
import type { WallSeg } from './walls.js';
import type { WindowSeg } from './windows.js';
import type { DoorSeg } from './doors.js';
import type { Rect } from './geometry.js';
import { partsOf, labelPoint, roomArea } from './shape.js';
import { type Furniture, placeFurniture, furnitureSVG } from './furniture.js';
import { compassFrame, zoneAt } from './orient.js';

export interface Plan {
  rooms: Room[];
  walls: WallSeg[];
  windows: WindowSeg[];
  doors: DoorSeg[];
  footprint: { x: number; y: number; w: number; h: number };
  score: number;
  seed: number;
  /** Placed furniture. When absent, `renderSVG` places it on the fly; the editor stores it so edits stick. */
  furniture?: Furniture[];
  /** Ids of rooms the user locked: "Regenerate rest" keeps them as they are. */
  locked?: string[];
  /** Set when the brief cannot be built at all; the plan is then not a plan. */
  infeasible?: string;
}

const COLORS: Record<string, string> = {
  living: '#eef3ea', dining: '#f6f1e6', kitchen: '#eaeef4', bedroom: '#f4ecec',
  bath: '#e9f0f1', utility: '#f0eee9', store: '#f1f1f1', hall: '#efede6',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Quarter-circle swing, sampled explicitly. SVG arc flags depend on the sweep
 * direction of each particular pair of endpoints, and getting one flag wrong
 * silently bulges the swing through the wall — a polyline cannot do that.
 * Angles: 0 = +x (right), 90 = +y (down, since SVG y grows downward).
 */
function swingPath(cx: number, cy: number, rad: number, a0: number, a1: number, steps = 14): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((a0 + (a1 - a0) * (i / steps)) * Math.PI) / 180;
    pts.push(`${(cx + rad * Math.cos(t)).toFixed(2)} ${(cy + rad * Math.sin(t)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
}


/** Where plan metres land on the page. Shared with the editor so its handles sit on the drawing. */
export function sheetFrame(brief: Brief, scale = 46, margin = 60) {
  const ox = margin + brief.setbacks.left * scale;
  const oy = margin + brief.setbacks.back * scale;
  return {
    W: brief.plot.w * scale + margin * 2,
    H: brief.plot.d * scale + margin * 2,
    scale,
    px: (x: number) => ox + x * scale,
    py: (y: number) => oy + y * scale,
  };
}

/** One run of dimensions along a side of the footprint. */
export interface DimChain {
  side: 'n' | 's' | 'e' | 'w';
  /** Marks along the side, in plan metres, sorted. */
  marks: number[];
  /** How far out from the footprint edge the line sits, metres. */
  offset: number;
}

/**
 * Dimension chains as a draughtsman would put them: on every side, a chain
 * through each wall that meets that side, and an overall dimension further out
 * on the top and left. Marks are at wall centrelines.
 */
export function dimensionChains(plan: Plan): DimChain[] {
  const fp = plan.footprint;
  const E = 1e-6;
  const marks = (side: DimChain['side']) => {
    const out = new Set<number>(side === 'n' || side === 's' ? [0, fp.w] : [0, fp.h]);
    for (const r of plan.rooms) {
      for (const p of partsOf(r)) {
        if (side === 'n' && Math.abs(p.y) < E) { out.add(p.x); out.add(p.x + p.w); }
        if (side === 's' && Math.abs(p.y + p.h - fp.h) < E) { out.add(p.x); out.add(p.x + p.w); }
        if (side === 'w' && Math.abs(p.x) < E) { out.add(p.y); out.add(p.y + p.h); }
        if (side === 'e' && Math.abs(p.x + p.w - fp.w) < E) { out.add(p.y); out.add(p.y + p.h); }
      }
    }
    const sorted = [...out].sort((a, b) => a - b);
    return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > 1e-4);
  };
  const chains: DimChain[] = (['n', 's', 'w', 'e'] as const).map((side) => ({ side, marks: marks(side), offset: 0.45 }));
  chains.push({ side: 'n', marks: [0, fp.w], offset: 0.9 }, { side: 'w', marks: [0, fp.h], offset: 0.9 });
  return chains;
}

/**
 * Which way a door leaf swings across its wall: +1 toward +x (a vertical
 * opening) or +y (a horizontal one), -1 the other way, 0 when neither room is
 * known. The swing goes into the room the door serves, and the hinge sits at
 * the low end of the opening.
 */
export function doorSwingSide(plan: Plan, d: DoorSeg): 1 | -1 | 0 {
  const roomById = new Map(plan.rooms.map((r) => [r.id, r]));
  // The part of a room the door opens into. For an L the bounding-box centre
  // can sit on the wrong side of the door line; the part holding the door cannot.
  const anchor = (room: Room): Rect => {
    const mx = (d.x1 + d.x2) / 2;
    const my = (d.y1 + d.y2) / 2;
    return (
      partsOf(room).find((p) => mx >= p.x - 1e-6 && mx <= p.x + p.w + 1e-6 && my >= p.y - 1e-6 && my <= p.y + p.h + 1e-6) ??
      room.rect
    );
  };
  const ra = roomById.get(d.a);
  const rb = d.b ? roomById.get(d.b) : undefined;
  // Swing into the room, never into the corridor. Falling back to "the
  // smaller room" alone sent every hall door swinging back out into the hall,
  // because the hall is smaller than the bedrooms it serves.
  const smaller = (x: typeof ra, y: typeof rb) =>
    !y ? x : !x ? y : x.rect.w * x.rect.h <= y.rect.w * y.rect.h ? x : y;
  let target = ra && rb ? smaller(ra, rb) : ra ?? rb;
  if (ra?.type === 'hall' && rb) target = rb;
  else if (rb?.type === 'hall' && ra) target = ra;
  if (!target) return 0;
  const home = anchor(target);
  if (d.axis === 'v') return home.x + home.w / 2 > d.x1 ? 1 : -1;
  return home.y + home.h / 2 > d.y1 ? 1 : -1;
}

export function renderSVG(plan: Plan, brief: Brief, scale = 46, margin = 60, furnish = true, dimensions = true): string {
  const fp = plan.footprint;
  const plotW = brief.plot.w;
  const plotD = brief.plot.d;
  const { W, H, px, py } = sheetFrame(brief, scale, margin);
  const t = brief.wallThickness * scale;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="Helvetica, Arial, sans-serif">`);
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // plot boundary
  parts.push(`<rect x="${px(-brief.setbacks.left).toFixed(1)}" y="${py(-brief.setbacks.back).toFixed(1)}" width="${(plotW * scale).toFixed(1)}" height="${(plotD * scale).toFixed(1)}" fill="none" stroke="#c9c9c9" stroke-width="1" stroke-dasharray="6 5"/>`);

  // rooms, part by part — an L is two or more rectangles
  for (const r of plan.rooms) {
    for (const p of partsOf(r)) {
      parts.push(`<rect x="${px(p.x).toFixed(1)}" y="${py(p.y).toFixed(1)}" width="${(p.w * scale).toFixed(1)}" height="${(p.h * scale).toFixed(1)}" fill="${COLORS[r.type] ?? '#f4f4f4'}" stroke="${COLORS[r.type] ?? '#f4f4f4'}" stroke-width="0.6"/>`);
    }
  }

  // furniture, under the walls so a piece never reads as sitting on one
  if (furnish) {
    for (const f of plan.furniture ?? placeFurniture(plan, brief.wallThickness)) parts.push(furnitureSVG(f, px, py, scale));
  }

  // walls: one path per thickness. Separate lines each anti-alias their own
  // edges, so where several meet the edges stack and the junction prints as
  // a dark pillar; one path is painted once.
  for (const exterior of [false, true]) {
    const d = plan.walls
      .filter((w) => w.exterior === exterior)
      .map((w) => `M ${px(w.x1).toFixed(1)} ${py(w.y1).toFixed(1)} L ${px(w.x2).toFixed(1)} ${py(w.y2).toFixed(1)}`)
      .join(' ');
    if (d) parts.push(`<path d="${d}" fill="none" stroke="#23272b" stroke-width="${(exterior ? t : t * 0.75).toFixed(2)}" stroke-linecap="square"/>`);
  }

  // doors: knock the wall out, then draw the leaf and its swing. The swing
  // goes into the room the door serves, and the hinge sits at the low end of
  // the opening — swinging every leaf to +x/+y swept half of them through the
  // wall they sit in.
  for (const d of plan.doors ?? []) {
    const rad = d.width * scale;
    const ink = d.entry ? '#7a4a1f' : '#23272b';
    const side = doorSwingSide(plan, d);
    if (!side) continue;

    if (d.axis === 'v') {
      const x = px(d.x1);
      const yTop = py(Math.min(d.y1, d.y2));
      const yBot = py(Math.max(d.y1, d.y2));
      const a0 = side === 1 ? 0 : 180;
      parts.push(`<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="#ffffff" stroke-width="${(t + 1).toFixed(2)}"/>`);
      parts.push(`<line x1="${x}" y1="${yTop}" x2="${(x + side * rad).toFixed(2)}" y2="${yTop}" stroke="${ink}" stroke-width="1.2"/>`);
      parts.push(`<path d="${swingPath(x, yTop, rad, a0, 90)}" fill="none" stroke="#9aa3ab" stroke-width="0.8"/>`);
    } else {
      const y = py(d.y1);
      const xL = px(Math.min(d.x1, d.x2));
      const xR = px(Math.max(d.x1, d.x2));
      const a0 = side === 1 ? 90 : 270;
      const a1 = side === 1 ? 0 : 360;
      parts.push(`<line x1="${xL}" y1="${y}" x2="${xR}" y2="${y}" stroke="#ffffff" stroke-width="${(t + 1).toFixed(2)}"/>`);
      parts.push(`<line x1="${xL}" y1="${y}" x2="${xL}" y2="${(y + side * rad).toFixed(2)}" stroke="${ink}" stroke-width="1.2"/>`);
      parts.push(`<path d="${swingPath(xL, y, rad, a0, a1)}" fill="none" stroke="#9aa3ab" stroke-width="0.8"/>`);
    }
  }

  // windows: knock out the wall, then draw the frame
  for (const win of plan.windows) {
    const vertical = Math.abs(win.x1 - win.x2) < 1e-6;
    if (vertical) {
      const y1 = py(Math.min(win.y1, win.y2));
      const y2 = py(Math.max(win.y1, win.y2));
      const x = px(win.x1);
      parts.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#ffffff" stroke-width="${(t + 1).toFixed(2)}"/>`);
      for (const d of [-t / 3, 0, t / 3]) {
        parts.push(`<line x1="${(x + d).toFixed(2)}" y1="${y1}" x2="${(x + d).toFixed(2)}" y2="${y2}" stroke="#4a7fa5" stroke-width="1.2"/>`);
      }
    } else {
      const x1 = px(Math.min(win.x1, win.x2));
      const x2 = px(Math.max(win.x1, win.x2));
      const y = py(win.y1);
      parts.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#ffffff" stroke-width="${(t + 1).toFixed(2)}"/>`);
      for (const d of [-t / 3, 0, t / 3]) {
        parts.push(`<line x1="${x1}" y1="${(y + d).toFixed(2)}" x2="${x2}" y2="${(y + d).toFixed(2)}" stroke="#4a7fa5" stroke-width="1.2"/>`);
      }
    }
  }

  // dimensions, outside the walls
  if (dimensions && plan.rooms.length) {
    const ink = '#8a6d3b';
    const half = brief.wallThickness / 2;
    const tick = 4;
    for (const c of dimensionChains(plan)) {
      const out = half + c.offset;
      const horizontal = c.side === 'n' || c.side === 's';
      // Position of the dimension line across the side, in plan metres.
      const at = c.side === 'n' ? -out : c.side === 's' ? fp.h + out : c.side === 'w' ? -out : fp.w + out;
      const P = (along: number, across: number) => (horizontal ? [px(along), py(across)] : [px(across), py(along)]);
      const [ax, ay] = P(c.marks[0], at);
      const [bx, by] = P(c.marks[c.marks.length - 1], at);
      parts.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${ink}" stroke-width="0.7"/>`);
      const face = c.side === 'n' ? -half : c.side === 's' ? fp.h + half : c.side === 'w' ? -half : fp.w + half;
      for (const m of c.marks) {
        const [x, y] = P(m, at);
        const [fx0, fy0] = P(m, face + (at > face ? 0.08 : -0.08));
        const [fx1, fy1] = P(m, at + (at > face ? 0.08 : -0.08));
        parts.push(`<line x1="${fx0.toFixed(1)}" y1="${fy0.toFixed(1)}" x2="${fx1.toFixed(1)}" y2="${fy1.toFixed(1)}" stroke="${ink}" stroke-width="0.4"/>`);
        parts.push(`<line x1="${(x - tick).toFixed(1)}" y1="${(y + tick).toFixed(1)}" x2="${(x + tick).toFixed(1)}" y2="${(y - tick).toFixed(1)}" stroke="${ink}" stroke-width="1"/>`);
      }
      for (let i = 1; i < c.marks.length; i++) {
        const len = c.marks[i] - c.marks[i - 1];
        if (len * scale < 18) continue;
        const [x, y] = P((c.marks[i] + c.marks[i - 1]) / 2, at);
        const label = len.toFixed(2);
        parts.push(horizontal
          ? `<text x="${x.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="${ink}">${label}</text>`
          : `<text x="${(x - 3).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="9" fill="${ink}" transform="rotate(-90 ${(x - 3).toFixed(1)} ${y.toFixed(1)})">${label}</text>`);
      }
    }
  }

  // labels
  for (const r of plan.rooms) {
    const at = labelPoint(r);
    const cx = px(at.x);
    const cy = py(at.y);
    const name = r.type.charAt(0).toUpperCase() + r.type.slice(1);
    const size = partsOf(r).length > 1 ? `${roomArea(r).toFixed(1)} m²` : `${r.rect.w.toFixed(1)}×${r.rect.h.toFixed(1)} m`;
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="#23272b" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(name)}</text>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 11).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6b7280" stroke="#ffffff" stroke-width="3" paint-order="stroke">${size}</text>`);
  }

  // orientation: a north arrow, the road, and with Vastu the compass zones
  const facing = brief.orientation?.facing;
  if (facing) {
    if (brief.vastu) {
      const zone = '#b08d57';
      for (const k of [1, 2]) {
        const x = px((fp.w * k) / 3);
        const y = py((fp.h * k) / 3);
        parts.push(`<line x1="${x.toFixed(1)}" y1="${py(0).toFixed(1)}" x2="${x.toFixed(1)}" y2="${py(fp.h).toFixed(1)}" stroke="${zone}" stroke-width="0.8" stroke-dasharray="3 4"/>`);
        parts.push(`<line x1="${px(0).toFixed(1)}" y1="${y.toFixed(1)}" x2="${px(fp.w).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${zone}" stroke-width="0.8" stroke-dasharray="3 4"/>`);
      }
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const cx = (fp.w * (i + 0.5)) / 3;
          const cy = (fp.h * (j + 0.5)) / 3;
          const name = zoneAt(fp, facing, cx, cy);
          parts.push(`<text x="${(px((fp.w * i) / 3) + 4).toFixed(1)}" y="${(py((fp.h * j) / 3) + 12).toFixed(1)}" font-size="9" fill="${zone}" font-weight="bold">${name === 'C' ? 'Centre' : name}</text>`);
        }
      }
    }
    const { north } = compassFrame(facing);
    const ax = W - 40;
    const ay = 40;
    const r = 15;
    const tip = { x: ax + north.x * r, y: ay + north.y * r };
    const tail = { x: ax - north.x * r * 0.6, y: ay - north.y * r * 0.6 };
    const side = { x: -north.y * 5, y: north.x * 5 };
    parts.push(`<circle cx="${ax}" cy="${ay}" r="${r + 4}" fill="none" stroke="#23272b" stroke-width="0.8"/>`);
    parts.push(`<path d="M ${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L ${(tail.x + side.x).toFixed(1)} ${(tail.y + side.y).toFixed(1)} L ${ax} ${ay} Z" fill="#23272b"/>`);
    parts.push(`<path d="M ${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L ${(tail.x - side.x).toFixed(1)} ${(tail.y - side.y).toFixed(1)} L ${ax} ${ay} Z" fill="#ffffff" stroke="#23272b" stroke-width="0.8"/>`);
    const lx = ax + north.x * (r + 12);
    const ly = ay + north.y * (r + 12) + 4;
    parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="bold" fill="#23272b">N</text>`);
    const roadY = py(fp.h + brief.setbacks.front) + 14;
    parts.push(`<text x="${px(fp.w / 2).toFixed(1)}" y="${roadY.toFixed(1)}" text-anchor="middle" font-size="10" letter-spacing="2" fill="#6b7280">ROAD · ${facing}-FACING</text>`);
  }

  // title block
  parts.push(`<text x="${margin}" y="${(H - 30).toFixed(0)}" font-size="12" fill="#23272b">Plot ${plotW}×${plotD} m · buildable ${fp.w}×${fp.h} m · seed ${plan.seed}</text>`);
  parts.push(`<text x="${margin}" y="${(H - 14).toFixed(0)}" font-size="10" fill="#6b7280">${plan.rooms.length} rooms · ${plan.walls.length} wall segments · ${plan.windows.length} windows · ${(plan.doors ?? []).length} doors · score ${plan.score.toFixed(2)}</text>`);
  parts.push('</svg>');

  return parts.join('\n');
}
