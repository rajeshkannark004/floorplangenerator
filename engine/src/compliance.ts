import type { Brief, Room, RoomType } from './brief.js';
import { minWidth } from './shape.js';
import { carpetArea, areaSchedule } from './schedule.js';
import type { Plan } from './render-svg.js';
import type { WindowSeg } from './windows.js';
import { setWindow } from './edit.js';

/*
 * Checks against Indian norms. Two kinds of source, and every check says which:
 *
 * - 'BIS': the Bureau of Indian Standards' own guide to NBC 2016, which quotes
 *   Part 3 clause 12 (requirements of parts of buildings). Primary enough to
 *   enforce.
 * - 'secondary': figures that several secondary sources attribute to NBC 2016
 *   but that were not read in the code text here (lighting and ventilation
 *   fractions, bathroom ventilators, kitchen width). Reported, flagged as such.
 *
 * Setbacks, ground coverage and FAR are set by the state or city bye-law, not
 * by NBC, so they are checked only against limits the user enters.
 *
 * Areas and widths are clear dimensions inside the walls: the plan's rooms run
 * to wall centrelines, so half a wall comes off every side.
 */

export type Climate = 'hot-dry' | 'warm-humid' | 'composite' | 'temperate' | 'cold';

/** Openable window area as a share of floor area, by climate (secondary sources; NBC 2016 Part 8). */
export const OPENING_SHARE: Record<Climate, number> = {
  'hot-dry': 1 / 10,
  'warm-humid': 1 / 6,
  composite: 1 / 8,
  temperate: 1 / 8,
  cold: 1 / 12,
};

export interface ComplianceOptions {
  climate: Climate;
  /** Window height, metres; the plan only knows widths. */
  windowHeight: number;
  /** Local bye-law limits; a missing one is not checked. */
  limits: {
    coverage?: number; // max ground coverage, fraction
    far?: number;
    front?: number; // min setbacks, metres
    rear?: number;
    side?: number;
  };
}

export const DEFAULT_COMPLIANCE: ComplianceOptions = {
  climate: 'composite',
  windowHeight: 1.2,
  limits: {},
};

export type Status = 'pass' | 'fail' | 'advice';

export interface Check {
  rule: string;
  /** Where the number comes from. */
  ref: string;
  source: 'BIS' | 'secondary' | 'bye-law';
  status: Status;
  /** The room checked, if any. */
  roomId?: string;
  detail: string;
}

/** Rooms people live in: NBC's habitable rooms. Kitchens, baths, stores and halls are not. */
const HABITABLE: RoomType[] = ['living', 'dining', 'bedroom'];

const NBC_CL12 = 'NBC 2016 Part 3, cl. 12 (BIS guide)';
const NBC_LV = 'NBC 2016 Part 8 (secondary sources)';

const fmt = (n: number) => n.toFixed(2);
/** 'bedroom-2' reads 'Bedroom 2'; a room that is the only one of its type drops the number. */
const namer = (rooms: Room[]) => (r: Room) => {
  const base = r.type.charAt(0).toUpperCase() + r.type.slice(1);
  return rooms.filter((q) => q.type === r.type).length > 1 ? `${base} ${r.id.split('-').pop()}` : base;
};

/** Window length on a room's walls, metres. */
const windowRun = (r: Room, windows: WindowSeg[]) =>
  windows.filter((w) => w.roomId === r.id).reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.y2 - w.y1), 0);

export function checkCompliance(plan: Plan, brief: Brief, opts: ComplianceOptions = DEFAULT_COMPLIANCE): Check[] {
  const out: Check[] = [];
  if (!plan.rooms.length) return out;
  const t = brief.wallThickness;
  const clear = (r: Room) => ({ area: carpetArea(r, t), width: minWidth(r) - t });
  const name = namer(plan.rooms);

  // Habitable rooms: one at 9.5 m² × 2.4 m, every other at 7.5 m² × 2.1 m.
  // The largest is held to the first standard.
  const habitable = plan.rooms.filter((r) => HABITABLE.includes(r.type)).sort((a, b) => clear(b).area - clear(a).area);
  habitable.forEach((r, i) => {
    const c = clear(r);
    const [area, width] = i === 0 ? [9.5, 2.4] : [7.5, 2.1];
    const ok = c.area >= area - 1e-6 && c.width >= width - 1e-6;
    out.push({
      rule: `Habitable room ${i === 0 ? '(largest)' : ''} ≥ ${area} m², ≥ ${width} m wide`.replace('  ', ' '),
      ref: NBC_CL12,
      source: 'BIS',
      status: ok ? 'pass' : 'fail',
      roomId: r.id,
      detail: `${name(r)}: ${fmt(c.area)} m², ${fmt(c.width)} m clear`,
    });
  });

  for (const r of plan.rooms.filter((r) => r.type === 'bath')) {
    const c = clear(r);
    out.push({
      rule: 'Toilet with WC ≥ 2.8 m²',
      ref: NBC_CL12,
      source: 'BIS',
      status: c.area >= 2.8 - 1e-6 ? 'pass' : 'fail',
      roomId: r.id,
      detail: `${name(r)}: ${fmt(c.area)} m²`,
    });
  }

  for (const r of plan.rooms.filter((r) => r.type === 'kitchen')) {
    const c = clear(r);
    out.push({
      rule: 'Kitchen ≥ 5 m² (separate dining)',
      ref: NBC_CL12,
      source: 'BIS',
      status: c.area >= 5 - 1e-6 ? 'pass' : 'fail',
      roomId: r.id,
      detail: `${name(r)}: ${fmt(c.area)} m²`,
    });
    out.push({
      rule: 'Kitchen ≥ 1.8 m wide',
      ref: 'NBC 2016 Part 3 (secondary sources)',
      source: 'secondary',
      status: c.width >= 1.8 - 1e-6 ? 'pass' : 'advice',
      roomId: r.id,
      detail: `${name(r)}: ${fmt(c.width)} m clear`,
    });
  }

  // Light and ventilation: window area against floor area, habitable rooms and kitchens.
  const share = OPENING_SHARE[opts.climate];
  for (const r of plan.rooms.filter((r) => HABITABLE.includes(r.type) || r.type === 'kitchen')) {
    const need = carpetArea(r, t) * share;
    const have = windowRun(r, plan.windows) * opts.windowHeight;
    out.push({
      rule: `Window area ≥ 1/${Math.round(1 / share)} of floor (${opts.climate})`,
      ref: NBC_LV,
      source: 'secondary',
      status: have >= need - 1e-6 ? 'pass' : 'fail',
      roomId: r.id,
      detail: `${name(r)}: ${fmt(have)} m² of windows, needs ${fmt(need)} m²`,
    });
  }
  for (const r of plan.rooms.filter((r) => r.type === 'bath')) {
    const have = windowRun(r, plan.windows) * opts.windowHeight;
    out.push({
      rule: 'Bath ventilator ≥ 0.3 m² to open air, or mechanical exhaust',
      ref: NBC_LV,
      source: 'secondary',
      status: have >= 0.3 - 1e-6 ? 'pass' : 'advice',
      roomId: r.id,
      detail: have > 0 ? `${name(r)}: ${fmt(have)} m² window` : `${name(r)}: no outside wall window — provide a ventilator to a shaft or an exhaust fan`,
    });
  }

  // Bye-law limits, only those entered.
  const s = areaSchedule(plan, brief);
  const L = opts.limits;
  if (L.coverage !== undefined) {
    out.push({
      rule: `Ground coverage ≤ ${(L.coverage * 100).toFixed(1)}%`,
      ref: 'Local bye-law (entered)',
      source: 'bye-law',
      status: s.coverage <= L.coverage + 1e-9 ? 'pass' : 'fail',
      detail: `${(s.coverage * 100).toFixed(1)}% (${fmt(s.builtUp)} of ${fmt(s.plot)} m²)`,
    });
  }
  if (L.far !== undefined) {
    out.push({
      rule: `FAR ≤ ${L.far}`,
      ref: 'Local bye-law (entered)',
      source: 'bye-law',
      status: s.far <= L.far + 1e-9 ? 'pass' : 'fail',
      detail: `${fmt(s.far)} (single storey)`,
    });
  }
  const sb = brief.setbacks;
  const setback = (label: string, need: number | undefined, have: number[]) => {
    if (need === undefined) return;
    const least = Math.min(...have);
    out.push({
      rule: `${label} setback ≥ ${need} m`,
      ref: 'Local bye-law (entered)',
      source: 'bye-law',
      // Setbacks run to the wall's outer face, half a wall out from the plan's centreline.
      status: least - t / 2 >= need - 1e-6 ? 'pass' : 'fail',
      detail: `${fmt(least - t / 2)} m to the outer wall face`,
    });
  };
  setback('Front', L.front, [sb.front]);
  setback('Rear', L.rear, [sb.back]);
  setback('Side', L.side, [sb.left, sb.right]);

  return out;
}

/**
 * Widen the windows of every room short of window area until it meets the
 * light-and-ventilation share, each window grown about its centre and held to
 * its wall by `setWindow`. A room whose walls cannot take enough glazing is
 * left as wide as they allow, and the check keeps reporting it.
 */
export function fixWindows(plan: Plan, brief: Brief, opts: ComplianceOptions = DEFAULT_COMPLIANCE): Plan {
  const share = OPENING_SHARE[opts.climate];
  let next = plan;
  for (const r of plan.rooms.filter((r) => HABITABLE.includes(r.type) || r.type === 'kitchen')) {
    const need = (carpetArea(r, brief.wallThickness) * share) / opts.windowHeight;
    const idx = next.windows.map((w, i) => (w.roomId === r.id ? i : -1)).filter((i) => i >= 0);
    const have = windowRun(r, next.windows);
    if (!idx.length || have >= need - 1e-6) continue;
    // Spread the shortfall over the room's windows, a little extra for rounding.
    const grow = (need - have) / idx.length + 0.01;
    for (const i of idx) {
      const w = next.windows[i];
      const v = Math.abs(w.x1 - w.x2) < 1e-9;
      const lo = v ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
      const hi = v ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
      next = setWindow(next, i, lo - grow / 2, hi + grow / 2);
    }
  }
  return next;
}
