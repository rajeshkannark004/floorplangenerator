import { type Brief, footprint, program, normaliseAreas } from './brief.js';
import { subdivide, mulberry32 } from './subdivide.js';
import { layoutScore } from './score.js';
import { buildWalls } from './walls.js';
import { placeWindows } from './windows.js';
import { validate } from './validate.js';
import type { Plan } from './render-svg.js';

export * from './render-svg.js';
export * from './brief.js';
export * from './walls.js';
export * from './windows.js';
export * from './score.js';

/** Generate `attempts` seeded candidates and keep the best-scoring one. */
export function generate(brief: Brief, seed = 1, attempts = 400): Plan {
  const fp = footprint(brief);
  let best: Plan | null = null;

  for (let i = 0; i < attempts; i++) {
    const rng = mulberry32(seed * 100003 + i);
    const rooms = subdivide(fp, normaliseAreas(program(brief), fp), rng);
    const score = layoutScore(rooms, fp);
    if (!best || score < best.score) {
      best = { rooms, walls: [], windows: [], footprint: fp, score, seed };
    }
  }

  const plan = best!;
  plan.walls = buildWalls(plan.rooms);
  plan.windows = placeWindows(plan.rooms, plan.walls, brief.windowWidth);
  return plan;
}

export { validate };
