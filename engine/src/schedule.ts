import { rectArea, sharedEdge } from './geometry.js';
import type { Brief, Room } from './brief.js';
import { partsOf, roomArea } from './shape.js';
import type { Plan } from './render-svg.js';

/** Square feet in a square metre. Indian practice quotes both. */
export const SQFT_PER_M2 = 10.7639;

export interface ScheduleRow {
  id: string;
  name: string;
  type: Room['type'];
  /** Bounding size at wall centrelines, metres. */
  w: number;
  h: number;
  /** Area to wall centrelines, m². */
  area: number;
  /** Clear floor inside the walls, m². */
  carpet: number;
}

export interface Schedule {
  rows: ScheduleRow[];
  /** Sum of the rooms' clear floor, m². */
  carpet: number;
  /** Outer face of the outside walls, m² (single storey). */
  builtUp: number;
  plot: number;
  /** builtUp / plot. */
  coverage: number;
  /** builtUp / plot, the same as coverage for one storey. */
  far: number;
  /** carpet / builtUp: how much of what is built is usable floor. */
  efficiency: number;
}

/** Length of a room's outline: its parts' perimeters less the edges they share. */
function perimeter(r: Room): number {
  const parts = partsOf(r);
  let p = parts.reduce((s, q) => s + 2 * (q.w + q.h), 0);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) p -= 2 * (sharedEdge(parts[i], parts[j])?.len ?? 0);
  }
  return p;
}

/**
 * Clear floor of a room whose outline runs along wall centrelines. Every wall
 * takes t/2 off the room along the outline; a rectilinear outline always has
 * four more convex corners than concave ones, and each convex corner was
 * taken twice, so (t/2)² × 4 = t² is added back.
 */
export function carpetArea(r: Room, t: number): number {
  return roomArea(r) - (perimeter(r) * t) / 2 + t * t;
}

/** The area statement for a plan: per room, then totals. */
export function areaSchedule(plan: Plan, brief: Brief): Schedule {
  const t = brief.wallThickness;
  const count = new Map<string, number>();
  for (const r of plan.rooms) count.set(r.type, (count.get(r.type) ?? 0) + 1);
  const seen = new Map<string, number>();
  const rows = plan.rooms.map((r): ScheduleRow => {
    const n = (seen.get(r.type) ?? 0) + 1;
    seen.set(r.type, n);
    const base = r.type.charAt(0).toUpperCase() + r.type.slice(1);
    return {
      id: r.id,
      name: (count.get(r.type) ?? 0) > 1 ? `${base} ${n}` : base,
      type: r.type,
      w: r.rect.w,
      h: r.rect.h,
      area: roomArea(r),
      carpet: carpetArea(r, t),
    };
  });
  const fp = plan.footprint;
  const carpet = rows.reduce((s, r) => s + r.carpet, 0);
  const builtUp = (fp.w + t) * (fp.h + t);
  const plot = rectArea({ x: 0, y: 0, w: brief.plot.w, h: brief.plot.d });
  return {
    rows,
    carpet,
    builtUp,
    plot,
    coverage: builtUp / plot,
    far: builtUp / plot,
    efficiency: builtUp > 0 ? carpet / builtUp : 0,
  };
}

/** The schedule as CSV, metres and square feet side by side. */
export function scheduleCSV(s: Schedule): string {
  const f = (n: number, d = 2) => n.toFixed(d);
  const lines = ['Room,Width (m),Depth (m),Area (m²),Carpet (m²),Carpet (sq ft)'];
  for (const r of s.rows) lines.push([r.name, f(r.w), f(r.h), f(r.area), f(r.carpet), f(r.carpet * SQFT_PER_M2, 0)].join(','));
  lines.push('');
  lines.push(`Total carpet,,,,${f(s.carpet)},${f(s.carpet * SQFT_PER_M2, 0)}`);
  lines.push(`Built-up,,,,${f(s.builtUp)},${f(s.builtUp * SQFT_PER_M2, 0)}`);
  lines.push(`Plot,,,,${f(s.plot)},${f(s.plot * SQFT_PER_M2, 0)}`);
  lines.push(`Ground coverage,,,,${f(s.coverage * 100, 1)}%,`);
  lines.push(`FAR,,,,${f(s.far)},`);
  lines.push(`Efficiency (carpet / built-up),,,,${f(s.efficiency * 100, 1)}%,`);
  return lines.join('\r\n') + '\r\n';
}
