import { writeFileSync, mkdirSync } from 'node:fs';
import { DEFAULTS, type Brief } from './engine/src/brief.js';
import { generate, renderSVG, validate, type Layout } from './engine/src/index.js';

const brief: Brief = {
  plot: { w: 10, d: 15 },
  setbacks: { front: 1.5, back: 1.5, left: 1.5, right: 1.5 },
  wallThickness: 0.23,
  windowWidth: 1.2,
  rooms: [
    { type: 'living', count: 1, ...DEFAULTS.living },
    { type: 'dining', count: 1, ...DEFAULTS.dining },
    { type: 'kitchen', count: 1, ...DEFAULTS.kitchen },
    { type: 'bedroom', count: 2, ...DEFAULTS.bedroom },
    { type: 'bath', count: 2, ...DEFAULTS.bath },
    { type: 'utility', count: 1, ...DEFAULTS.utility },
  ],
};

// seed, attempts, search effort and layout are optional: node dist/demo.js 7 120 0.5 grid
const seed = Number(process.argv[2] ?? 7);
const attempts = Number(process.argv[3] ?? 120);
const effort = Number(process.argv[4] ?? 0.5);
const layout = (process.argv[5] ?? 'split') as Layout;

const started = Date.now();
const plan = generate(brief, seed, attempts, effort, layout);
const elapsed = Date.now() - started;
mkdirSync('out', { recursive: true });
writeFileSync('out/plan.svg', renderSVG(plan, brief));

console.log('score   ', plan.score.toFixed(2));
console.log('rooms   ', plan.rooms.map((r) => `${r.id} ${r.rect.w.toFixed(2)}x${r.rect.h.toFixed(2)} @${r.rect.x.toFixed(1)},${r.rect.y.toFixed(1)}${r.parts && r.parts.length > 1 ? ` (${r.parts.length} parts)` : ''}`).join('\n         '));
console.log('walls   ', plan.walls.length, 'exterior', plan.walls.filter((w) => w.exterior).length);
console.log('windows ', plan.windows.map((w) => w.roomId).join(', ') || 'none');
console.log('doors   ', plan.doors.map((d) => `${d.a}${d.b ? '↔' + d.b : '↔outside'}${d.entry ? '(entry)' : ''}`).join(', ') || 'none');
console.log('problems', validate(plan.rooms, plan.walls, plan.windows, plan.footprint, brief, plan.doors));
console.log('time    ', `${elapsed} ms — seed ${seed}, ${attempts} attempts, effort ${effort}, layout ${layout}`);
