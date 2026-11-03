import { type Brief, footprint, program, normaliseAreas, withHall, type Room } from './brief.js';
import type { Rect } from './geometry.js';
import { subdivide, mulberry32 } from './subdivide.js';
import { growGrid, refineGrid, gridRooms, type GridPlan } from './grid.js';
import { roomArea } from './shape.js';
import { layoutScore } from './score.js';
import { buildWalls } from './walls.js';
import { placeWindows } from './windows.js';
import { placeDoors, unreachableThroughDoors, doorDegrees, doorCapacity } from './doors.js';
import { validate } from './validate.js';
import type { Plan } from './render-svg.js';

export * from './render-svg.js';
export * from './brief.js';
export * from './walls.js';
export * from './windows.js';
export * from './doors.js';
export * from './score.js';
export * from './shape.js';
export * from './furniture.js';
export * from './edit.js';
export { GRID_CELL } from './grid.js';

/**
 * How rooms are laid out. 'split' is the original area-exact recursive
 * splitter; 'grid' grows rooms from seeds on a grid and can make L-shapes.
 */
export type Layout = 'split' | 'grid';

/**
 * A brief can be impossible before any search runs: the rooms need more floor
 * area than the setbacks leave, or a room's minimum width does not fit the
 * footprint at all. Say so plainly rather than returning a broken plan.
 */
function infeasibleReason(brief: Brief, fp: Rect): string | null {
  // Counts the rooms the brief asks for, not the hall. The hall is optional and
  // only added when the door rules need it, so charging it here would reject
  // briefs that fit perfectly well without circulation.
  const need = brief.rooms.reduce((s, spec) => s + spec.area * spec.count, 0);
  const have = fp.w * fp.h;

  if (need > have + 1e-9) {
    return `programme needs ${need.toFixed(1)} m² but only ${have.toFixed(1)} m² is buildable`;
  }

  const narrowest = Math.min(fp.w, fp.h);
  const tooWide = brief.rooms.find((spec) => spec.minW > narrowest + 1e-9);
  if (tooWide) {
    return `${tooWide.type} needs ${tooWide.minW} m clear, but the buildable area is only ${narrowest.toFixed(1)} m across`;
  }

  return null;
}

function problemsOf(plan: Plan, brief: Brief): string[] {
  return validate(plan.rooms, plan.walls, plan.windows, plan.footprint, brief, plan.doors);
}

/** Ranking cost of each validation problem a candidate has. */
const PROBLEM_WEIGHT = 100;
/** Grid candidates that get the expensive local search; the rest are ranked and dropped. */
const GRID_FINALISTS = 24;
/** Local-search moves per finalist at full effort. */
const GRID_REFINE_MOVES = 4200;

/** The best of `attempts` seeded candidates, optionally with a circulation spine. */
function search(brief: Brief, fp: Rect, seed: number, attempts: number, effort: number, useHall: boolean, layout: Layout): Plan | null {
  const rooms0: Room[] = useHall ? withHall(program(brief), fp) : program(brief);
  const targets = normaliseAreas(rooms0, fp);
  let best: Plan | null = null;

  const consider = (rooms: Room[], i: number) => {
    // Grid growth can starve a room of cells on a crowded plan; that is not a candidate.
    if (rooms.some((r) => roomArea(r) <= 0)) return;
    const walls = buildWalls(rooms);
    const doors = placeDoors(rooms, walls, fp, mulberry32(seed * 7919 + i));

    // Rank on whether doors can actually be placed, not on a proxy for it.
    // A layout that scores well on shape but leaves a bedroom reachable only
    // through a bath is not a plan.
    const stuck = unreachableThroughDoors(rooms, doors);
    // A room with three doors is a corridor whether you called it one or not.
    // The hall is exempt; it is the one room meant to be busy.
    const degrees = doorDegrees(doors);
    let overload = 0;
    for (const r of rooms) {
      if (r.type === 'hall') continue;
      overload += Math.max(0, (degrees.get(r.id) ?? 0) - doorCapacity(r.type));
    }
    // Rank on the real checks too. Windows are cheap to place, and a plan the
    // validator rejects should never beat one it accepts on shape alone.
    const windows = placeWindows(rooms, walls, brief.windowWidth, doors);
    const problems = validate(rooms, walls, windows, fp, brief, doors).length;
    const score = layoutScore(rooms, fp) + stuck * 60 + overload * 15 + problems * PROBLEM_WEIGHT;

    if (!best || score < best.score) {
      best = { rooms, walls, windows, doors, footprint: fp, score, seed };
    }
  };

  if (layout === 'grid') {
    // Rank cheap first: grow every attempt, score it on the grid, and spend
    // the local search and the walls-and-doors build only on the finalists.
    // Each finalist keeps its own rng, so a seed still reproduces its plan.
    const pool: { g: GridPlan; rng: () => number; i: number }[] = [];
    for (let i = 0; i < attempts; i++) {
      const rng = mulberry32(seed * 100003 + i);
      pool.push({ g: growGrid(fp, targets, rng, effort), rng, i });
    }
    pool.sort((a, b) => a.g.score - b.g.score || a.i - b.i);
    for (const { g, rng, i } of pool.slice(0, GRID_FINALISTS)) {
      refineGrid(g, rng, Math.round(GRID_REFINE_MOVES * effort));
      consider(gridRooms(g), i);
    }
  } else {
    for (let i = 0; i < attempts; i++) {
      consider(subdivide(fp, targets, mulberry32(seed * 100003 + i), 0, 'flat', effort), i);
    }
  }

  return best;
}

/**
 * Generate `attempts` seeded candidates and keep the best-scoring one.
 *
 * The hall is not assumed. A small programme can often work without one, and
 * forcing a corridor into a 1BHK is what squeezed every room below its minimum
 * width. Try the plain programme first; fall back to the spine only when the
 * door rules cannot be satisfied without it.
 */
export function generate(brief: Brief, seed = 1, attempts = 400, effort = 1, layout: Layout = 'split'): Plan {
  const fp = footprint(brief);

  const reason = infeasibleReason(brief, fp);
  if (reason) {
    return { rooms: [], walls: [], windows: [], doors: [], footprint: fp, score: 0, seed, infeasible: reason };
  }

  const plain = search(brief, fp, seed, attempts, effort, false, layout);
  const plainProblems = plain ? problemsOf(plain, brief) : [];
  if (plain && !plainProblems.length) return plain;

  const spined = search(brief, fp, seed, attempts, effort, true, layout);
  const spinedProblems = spined ? problemsOf(spined, brief) : [];
  if (spined && !spinedProblems.length) return spined;

  if (plain && spined) return plainProblems.length <= spinedProblems.length ? plain : spined;
  const any = plain ?? spined;
  if (any) return any;
  return { rooms: [], walls: [], windows: [], doors: [], footprint: fp, score: 0, seed, infeasible: 'no candidate layout gave every room space' };
}

export { validate };
