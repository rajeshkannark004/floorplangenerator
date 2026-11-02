import type { Brief, Room } from './brief.js';
import type { WallSeg } from './walls.js';
import type { WindowSeg } from './windows.js';
import type { DoorSeg } from './doors.js';
import type { Rect } from './geometry.js';
import { partsOf, labelPoint, roomArea } from './shape.js';

export interface Plan {
  rooms: Room[];
  walls: WallSeg[];
  windows: WindowSeg[];
  doors: DoorSeg[];
  footprint: { x: number; y: number; w: number; h: number };
  score: number;
  seed: number;
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


export function renderSVG(plan: Plan, brief: Brief, scale = 46, margin = 60): string {
  const fp = plan.footprint;
  const plotW = brief.plot.w;
  const plotD = brief.plot.d;
  const W = plotW * scale + margin * 2;
  const H = plotD * scale + margin * 2;
  const ox = margin + brief.setbacks.left * scale;
  const oy = margin + brief.setbacks.back * scale;
  const t = brief.wallThickness * scale;

  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + y * scale;

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

  // walls
  for (const w of plan.walls) {
    const sw = (w.exterior ? t : t * 0.75).toFixed(2);
    parts.push(`<line x1="${px(w.x1).toFixed(1)}" y1="${py(w.y1).toFixed(1)}" x2="${px(w.x2).toFixed(1)}" y2="${py(w.y2).toFixed(1)}" stroke="#23272b" stroke-width="${sw}" stroke-linecap="square"/>`);
  }

  // doors: knock the wall out, then draw the leaf and its swing. The swing
  // goes into the room the door serves, and the hinge sits at the low end of
  // the opening — swinging every leaf to +x/+y swept half of them through the
  // wall they sit in.
  const roomById = new Map(plan.rooms.map((r) => [r.id, r]));
  // The part of a room the door opens into. For an L the bounding-box centre
  // can sit on the wrong side of the door line; the part holding the door cannot.
  const anchor = (room: Room, d: DoorSeg): Rect => {
    const mx = (d.x1 + d.x2) / 2;
    const my = (d.y1 + d.y2) / 2;
    return (
      partsOf(room).find((p) => mx >= p.x - 1e-6 && mx <= p.x + p.w + 1e-6 && my >= p.y - 1e-6 && my <= p.y + p.h + 1e-6) ??
      room.rect
    );
  };
  for (const d of plan.doors ?? []) {
    const rad = d.width * scale;
    const ink = d.entry ? '#7a4a1f' : '#23272b';
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
    if (!target) continue;

    if (d.axis === 'v') {
      const x = px(d.x1);
      const yTop = py(Math.min(d.y1, d.y2));
      const yBot = py(Math.max(d.y1, d.y2));
      const home = anchor(target, d);
      const side = home.x + home.w / 2 > d.x1 ? 1 : -1;
      const a0 = side === 1 ? 0 : 180;
      parts.push(`<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="#ffffff" stroke-width="${(t + 1).toFixed(2)}"/>`);
      parts.push(`<line x1="${x}" y1="${yTop}" x2="${(x + side * rad).toFixed(2)}" y2="${yTop}" stroke="${ink}" stroke-width="1.2"/>`);
      parts.push(`<path d="${swingPath(x, yTop, rad, a0, 90)}" fill="none" stroke="#9aa3ab" stroke-width="0.8"/>`);
    } else {
      const y = py(d.y1);
      const xL = px(Math.min(d.x1, d.x2));
      const xR = px(Math.max(d.x1, d.x2));
      const home = anchor(target, d);
      const side = home.y + home.h / 2 > d.y1 ? 1 : -1;
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

  // labels
  for (const r of plan.rooms) {
    const at = labelPoint(r);
    const cx = px(at.x);
    const cy = py(at.y);
    const name = r.type.charAt(0).toUpperCase() + r.type.slice(1);
    const size = partsOf(r).length > 1 ? `${roomArea(r).toFixed(1)} m²` : `${r.rect.w.toFixed(1)}×${r.rect.h.toFixed(1)} m`;
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="#23272b">${esc(name)}</text>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 11).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6b7280">${size}</text>`);
  }

  // title block
  parts.push(`<text x="${margin}" y="${(H - 30).toFixed(0)}" font-size="12" fill="#23272b">Plot ${plotW}×${plotD} m · buildable ${fp.w}×${fp.h} m · seed ${plan.seed}</text>`);
  parts.push(`<text x="${margin}" y="${(H - 14).toFixed(0)}" font-size="10" fill="#6b7280">${plan.rooms.length} rooms · ${plan.walls.length} wall segments · ${plan.windows.length} windows · ${(plan.doors ?? []).length} doors · score ${plan.score.toFixed(2)}</text>`);
  parts.push('</svg>');

  return parts.join('\n');
}
