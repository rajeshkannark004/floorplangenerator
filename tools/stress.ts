import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { DEFAULTS, type Brief, type RoomSpec } from '../engine/src/brief.js';
import { generate, type Layout } from '../engine/src/index.js';
import { validate } from '../engine/src/validate.js';

/**
 * Stress harness. Runs a fixed set of briefs across seeds 1..8 and reports how
 * many plans validate, how long they took, and a tally of every distinct
 * validation message.
 *
 * Usage:
 *   node dist/tools/stress.js --mode preview --briefs 0,1,2
 *   node dist/tools/stress.js --layout=grid   (results kept under preview-grid)
 *   node dist/tools/stress.js --report
 *
 * Results accumulate in stress-results.json so a slow run can be split across
 * several invocations. `--report` prints whatever has been collected.
 */

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Overridable so an expensive brief can be sampled while performance work is pending. */
let seeds: number[] = SEEDS;

const MODES = {
  preview: { attempts: 60, effort: 0.6 },
  cli: { attempts: 120, effort: 0.5 },
} as const;

type Mode = keyof typeof MODES;

const room = (type: RoomSpec['type'], count = 1): RoomSpec => ({
  type,
  count,
  ...DEFAULTS[type],
});

function brief(
  plotW: number,
  plotD: number,
  setback: number,
  rooms: RoomSpec[],
  setbacks?: { front: number; back: number; left: number; right: number },
): Brief {
  return {
    plot: { w: plotW, d: plotD },
    setbacks: setbacks ?? { front: setback, back: setback, left: setback, right: setback },
    wallThickness: 0.23,
    windowWidth: 1.2,
    rooms,
  };
}

export const BRIEFS: { name: string; brief: Brief }[] = [
  {
    name: '1BHK',
    brief: brief(8, 12, 1.5, [room('living'), room('kitchen'), room('bedroom'), room('bath')]),
  },
  {
    name: '2BHK',
    brief: brief(10, 15, 1.5, [
      room('living'),
      room('dining'),
      room('kitchen'),
      room('bedroom', 2),
      room('bath', 2),
      room('utility'),
    ]),
  },
  {
    name: '3BHK',
    brief: brief(12, 18, 1.5, [
      room('living'),
      room('dining'),
      room('kitchen'),
      room('bedroom', 3),
      room('bath', 3),
      room('utility'),
      room('store'),
    ]),
  },
  {
    name: 'narrow',
    brief: brief(6, 20, 1.0, [
      room('living'),
      room('dining'),
      room('kitchen'),
      room('bedroom', 2),
      room('bath'),
    ]),
  },
  {
    name: 'tiny',
    brief: brief(5, 6, 0.5, [room('living'), room('kitchen'), room('bedroom'), room('bath')]),
  },
  {
    name: 'overstuffed',
    brief: brief(8, 10, 1.0, [
      room('living'),
      room('dining'),
      room('kitchen'),
      room('bedroom', 4),
      room('bath', 2),
      room('utility'),
    ]),
  },
];

interface SeedResult {
  ms: number;
  problems: string[];
  /** The brief was rejected as impossible; not the same as a broken plan. */
  infeasible?: boolean;
}

/** mode -> brief -> seed -> result. Per-seed so a slow run can be resumed. */
type Results = Record<string, Record<string, Record<string, SeedResult>>>;

const FILE = 'stress-results.json';

function load(): Results {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Results;
  } catch {
    return {};
  }
}

/** Collapse numbers so the same failure groups together. */
function normalise(message: string): string {
  return message.replace(/[0-9]+(\.[0-9]+)?/g, 'N');
}

function runSeed(b: Brief, seed: number, attempts: number, effort: number, layout: Layout): SeedResult {
  const t0 = Date.now();
  const plan = generate(b, seed, attempts, effort, layout);
  const ms = Date.now() - t0;

  const problems = validate(plan.rooms, plan.walls, plan.windows, plan.footprint, b, plan.doors).map(normalise);
  if (plan.infeasible) problems.unshift(normalise(`infeasible: ${plan.infeasible}`));
  return { ms, problems, infeasible: Boolean(plan.infeasible) };
}

function report(results: Results) {
  for (const key of Object.keys(results)) {
    const table = results[key];
    // Keys are the mode, plus "-<layout>" for anything but the splitter.
    const cfg = MODES[key.split('-')[0] as Mode];
    if (!cfg) continue;
    console.log(`\n=== ${key} (${cfg.attempts} attempts, effort ${cfg.effort}) ===`);
    console.log('brief         valid                  avg ms   failures');
    for (const { name } of BRIEFS) {
      const seeds = table[name];
      if (!seeds) {
        console.log(`${name.padEnd(13)} —       —        (not run)`);
        continue;
      }
      const runs = Object.values(seeds);
      const rejected = runs.filter((r) => r.infeasible).length;
      const valid = runs.filter((r) => !r.infeasible && r.problems.length === 0).length;
      const avg = Math.round(runs.reduce((s, r) => s + r.ms, 0) / runs.length);
      const messages: Record<string, number> = {};
      for (const r of runs) for (const p of r.problems) messages[p] = (messages[p] ?? 0) + 1;
      const failures = Object.entries(messages)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${n}x ${m}`)
        .join('; ');
      const score = rejected ? `${valid}/${runs.length - rejected} (${rejected} infeasible)` : `${valid}/${runs.length}`;
      console.log(`${name.padEnd(13)} ${score.padEnd(22)} ${String(avg).padEnd(8)} ${failures || '—'}`);
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  if (argv.includes('--report')) {
    report(load());
    return;
  }

  const mode = (arg('mode') ?? 'preview') as Mode;
  if (!MODES[mode]) {
    console.error(`unknown mode ${mode}`);
    process.exit(1);
  }
  const cfg = MODES[mode];
  const seedArg = arg('seeds');
  if (seedArg) seeds = seedArg.split(',').map(Number);
  const which = arg('briefs');
  const indices = which ? which.split(',').map(Number) : BRIEFS.map((_, i) => i);

  const layout = (arg('layout') ?? 'split') as Layout;
  const key = layout === 'split' ? mode : `${mode}-${layout}`;

  const results = load();
  results[key] ??= {};

  for (const i of indices) {
    const entry = BRIEFS[i];
    if (!entry) continue;
    results[key][entry.name] ??= {};
    for (const seed of seeds) {
      if (results[key][entry.name][String(seed)]) continue;
      const r = runSeed(entry.brief, seed, cfg.attempts, cfg.effort, layout);
      results[key][entry.name][String(seed)] = r;
      writeFileSync(FILE, JSON.stringify(results, null, 2));
      console.log(`${key} ${entry.name} seed ${seed}: ${r.problems.length ? r.problems.join('; ') : 'clean'} (${r.ms} ms)`);
    }
  }
}

main();
