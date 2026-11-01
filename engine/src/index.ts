import { type Brief, footprint, program, normaliseAreas, withHall } from './brief.js';
import { subdivide, mulberry32 } from './subdivide.js';
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

/** Generate `attempts` seeded candidates and keep the best-scoring one. */
export function generate(brief: Brief, seed = 1, attempts = 400, effort = 1): Plan {
  const fp = footprint(brief);
  let best: Plan | null = null;

  for (let i = 0; i < attempts; i++) {
    const rng = mulberry32(seed * 100003 + i);
    const rooms = subdivide(fp, normaliseAreas(withHall(program(brief), fp), fp), rng, 0, 'flat', effort);
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
    const score = layoutScore(rooms, fp) + stuck * 60 + overload * 15;

    if (!best || score < best.score) {
      best = { rooms, walls, windows: [], doors, footprint: fp, score, seed };
    }
  }

  const plan = best!;
  plan.windows = placeWindows(plan.rooms, plan.walls, brief.windowWidth, plan.doors);
  return plan;
}

export { validate };
