import { writeFileSync, mkdirSync } from 'node:fs';
import { DEFAULTS, type Brief } from './engine/src/brief.js';
import { generate, renderSVG, validate } from './engine/src/index.js';

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

const plan = generate(brief, 7, 150);
mkdirSync('out', { recursive: true });
writeFileSync('out/plan.svg', renderSVG(plan, brief));

console.log('score   ', plan.score.toFixed(2));
console.log('rooms   ', plan.rooms.map((r) => `${r.id} ${r.rect.w.toFixed(2)}x${r.rect.h.toFixed(2)} @${r.rect.x.toFixed(1)},${r.rect.y.toFixed(1)}`).join('\n         '));
console.log('walls   ', plan.walls.length, 'exterior', plan.walls.filter((w) => w.exterior).length);
console.log('windows ', plan.windows.map((w) => w.roomId).join(', ') || 'none');
console.log('doors   ', plan.doors.map((d) => `${d.a}${d.b ? '↔' + d.b : '↔outside'}${d.entry ? '(entry)' : ''}`).join(', ') || 'none');
console.log('problems', validate(plan.rooms, plan.walls, plan.windows, plan.footprint, brief, plan.doors));
