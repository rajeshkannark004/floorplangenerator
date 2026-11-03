import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, footprint, normaliseAreas, program, withHall, type Brief } from '../engine/src/brief.js';
import { sharedEdge, splitRect, rectArea, type Rect } from '../engine/src/geometry.js';
import { generate } from '../engine/src/index.js';
import { validate } from '../engine/src/validate.js';
import { sameLine, extent } from '../engine/src/windows.js';
import { segLen } from '../engine/src/walls.js';
import { partsOf, minWidth } from '../engine/src/shape.js';
import { placeFurniture, inDoorSwing } from '../engine/src/furniture.js';
import { setDoor, setWindow, moveWall, wallLines, openingRange, rotateFurniture, MIN_PART } from '../engine/src/edit.js';
import { roomArea } from '../engine/src/shape.js';
import { areaSchedule, carpetArea, scheduleCSV } from '../engine/src/schedule.js';
import { planDXF } from '../engine/src/dxf.js';
import { checkCompliance, fixWindows, DEFAULT_COMPLIANCE } from '../engine/src/compliance.js';
import { dimensionChains } from '../engine/src/render-svg.js';

const demo: Brief = {
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

const plan = generate(demo, 7, 40, 0.5);

test('same seed and brief give the same plan', () => {
  const a = generate(demo, 7, 40, 0.5);
  const b = generate(demo, 7, 40, 0.5);
  assert.deepEqual(
    a.rooms.map((r) => [r.id, r.rect.x, r.rect.y, r.rect.w, r.rect.h]),
    b.rooms.map((r) => [r.id, r.rect.x, r.rect.y, r.rect.w, r.rect.h]),
  );
  assert.equal(a.doors.length, b.doors.length);
});

test('a different seed is allowed to differ', () => {
  const a = generate(demo, 7, 40, 0.5);
  const b = generate(demo, 8, 40, 0.5);
  assert.ok(a.rooms.length === b.rooms.length);
});

test('rooms tile the footprint exactly, with no overlap', () => {
  const fp = footprint(demo);
  const covered = plan.rooms.reduce((s, r) => s + rectArea(r.rect), 0);
  assert.ok(Math.abs(covered - fp.w * fp.h) < 1e-6, `covered ${covered} vs ${fp.w * fp.h}`);

  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i].rect;
      const b = plan.rooms[j].rect;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(w <= 1e-9 || h <= 1e-9, `${plan.rooms[i].id} overlaps ${plan.rooms[j].id}`);
    }
  }
});

test('normaliseAreas makes the programme fill the footprint', () => {
  const fp = footprint(demo);
  const rooms = normaliseAreas(withHall(program(demo), fp), fp);
  const total = rooms.reduce((s, r) => s + r.area, 0);
  assert.ok(Math.abs(total - fp.w * fp.h) < 1e-6);
});

test('splitRect keeps total area and honours the ratio', () => {
  const r: Rect = { x: 1, y: 2, w: 8, h: 5 };
  const [a, b] = splitRect(r, 'x', 0.25);
  assert.ok(Math.abs(rectArea(a) + rectArea(b) - rectArea(r)) < 1e-9);
  assert.ok(Math.abs(a.w - 2) < 1e-9);
  assert.ok(Math.abs(b.x - (r.x + 2)) < 1e-9);

  const [c, d] = splitRect(r, 'y', 0.5);
  assert.ok(Math.abs(rectArea(c) + rectArea(d) - rectArea(r)) < 1e-9);
});

test('sharedEdge finds touching rooms and ignores gaps', () => {
  const a: Rect = { x: 0, y: 0, w: 4, h: 3 };
  const b: Rect = { x: 4, y: 0, w: 3, h: 3 };
  const e = sharedEdge(a, b);
  assert.ok(e, 'expected a shared edge');
  assert.equal(e!.axis, 'v');
  assert.ok(Math.abs(e!.len - 3) < 1e-9);

  const far: Rect = { x: 4.5, y: 0, w: 3, h: 3 };
  assert.equal(sharedEdge(a, far), null);

  const corner: Rect = { x: 4, y: 3, w: 2, h: 2 };
  assert.equal(sharedEdge(a, corner), null, 'a corner touch is not an edge');
});

test('every door lies on the shared edge of the rooms it names', () => {
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  const interior = plan.doors.filter((d) => d.b);
  assert.ok(interior.length > 0, 'expected interior doors');

  for (const d of interior) {
    const a = byId.get(d.a)!;
    const b = byId.get(d.b!)!;
    const e = sharedEdge(a.rect, b.rect);
    assert.ok(e, `${d.a}/${d.b} share no edge`);

    const [lo, hi] = extent(d);
    assert.ok(lo >= e!.lo - 1e-6 && hi <= e!.hi + 1e-6, `${d.a}/${d.b} door runs past the shared edge`);
    assert.ok(Math.abs((d.axis === 'v' ? d.x1 : d.y1) - e!.at) < 1e-6, 'door is not on the wall line');
  }
});

test('every window sits on an exterior wall', () => {
  const exterior = plan.walls.filter((w) => w.exterior);
  assert.ok(plan.windows.length > 0, 'expected windows');

  for (const win of plan.windows) {
    const [lo, hi] = extent(win);
    const host = exterior.find(
      (w) => sameLine(w, win) && lo >= extent(w)[0] - 1e-6 && hi <= extent(w)[1] + 1e-6,
    );
    assert.ok(host, `${win.roomId} window is not on an exterior wall`);
  }
});

test('every window sits inside the wall of the room it belongs to', () => {
  // The old exterior-wall test passed while windows were being centred on a
  // free run that had been widened past the room, landing up to 0.8 m outside
  // their own walls. This is the test that catches that.
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  for (const win of plan.windows) {
    const room = byId.get(win.roomId)!;
    const [lo, hi] = extent(win);

    if (Math.abs(win.x1 - win.x2) < 1e-9) {
      const onRoomWall =
        Math.abs(win.x1 - room.rect.x) < 1e-6 || Math.abs(win.x1 - (room.rect.x + room.rect.w)) < 1e-6;
      assert.ok(onRoomWall, `${win.roomId} window is not on one of its own vertical walls`);
      assert.ok(
        lo >= room.rect.y - 1e-6 && hi <= room.rect.y + room.rect.h + 1e-6,
        `${win.roomId} window runs past its room vertically (${lo.toFixed(2)}–${hi.toFixed(2)} vs ${room.rect.y.toFixed(2)}–${(room.rect.y + room.rect.h).toFixed(2)})`,
      );
    } else {
      const onRoomWall =
        Math.abs(win.y1 - room.rect.y) < 1e-6 || Math.abs(win.y1 - (room.rect.y + room.rect.h)) < 1e-6;
      assert.ok(onRoomWall, `${win.roomId} window is not on one of its own horizontal walls`);
      assert.ok(
        lo >= room.rect.x - 1e-6 && hi <= room.rect.x + room.rect.w + 1e-6,
        `${win.roomId} window runs past its room horizontally`,
      );
    }
  }
});

test('every wall segment stays inside the footprint', () => {
  const fp = plan.footprint;
  for (const w of plan.walls) {
    assert.ok(w.x1 >= fp.x - 1e-6 && w.x1 <= fp.x + fp.w + 1e-6, 'wall x1 outside footprint');
    assert.ok(w.x2 >= fp.x - 1e-6 && w.x2 <= fp.x + fp.w + 1e-6, 'wall x2 outside footprint');
    assert.ok(w.y1 >= fp.y - 1e-6 && w.y1 <= fp.y + fp.h + 1e-6, 'wall y1 outside footprint');
    assert.ok(w.y2 >= fp.y - 1e-6 && w.y2 <= fp.y + fp.h + 1e-6, 'wall y2 outside footprint');
  }
});

test('every wall segment has positive length', () => {
  for (const w of plan.walls) assert.ok(segLen(w) > 1e-6);
});

test('validate returns a list and never throws', () => {
  const problems = validate(plan.rooms, plan.walls, plan.windows, plan.footprint, demo, plan.doors);
  assert.ok(Array.isArray(problems));
});

test('the demo brief validates clean', () => {
  const problems = validate(plan.rooms, plan.walls, plan.windows, plan.footprint, demo, plan.doors);
  assert.deepEqual(problems, []);
});

// Grid growth: rooms can be L-shaped, so these check parts, not just rects.
const gridPlan = generate(demo, 7, 12, 0.3, 'grid');

test('grid: same seed and brief give the same plan', () => {
  const again = generate(demo, 7, 12, 0.3, 'grid');
  assert.deepEqual(
    gridPlan.rooms.map((r) => [r.id, partsOf(r)]),
    again.rooms.map((r) => [r.id, partsOf(r)]),
  );
});

test('grid: parts tile the footprint exactly, with no overlap', () => {
  const fp = footprint(demo);
  const all = gridPlan.rooms.flatMap((r) => partsOf(r).map((p) => ({ id: r.id, p })));
  const covered = all.reduce((s, { p }) => s + rectArea(p), 0);
  assert.ok(Math.abs(covered - fp.w * fp.h) < 1e-6, `covered ${covered} vs ${fp.w * fp.h}`);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i].p;
      const b = all[j].p;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(w <= 1e-9 || h <= 1e-9, `${all[i].id} overlaps ${all[j].id}`);
    }
  }
});

test('grid: every room is one connected piece', () => {
  for (const r of gridPlan.rooms) {
    const parts = partsOf(r);
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const i = queue.pop()!;
      parts.forEach((q, j) => {
        if (!seen.has(j) && sharedEdge(parts[i], q)) {
          seen.add(j);
          queue.push(j);
        }
      });
    }
    assert.equal(seen.size, parts.length, `${r.id} is in ${parts.length - seen.size + 1} or more pieces`);
  }
});

test('grid: every window sits on an exterior wall of its own room', () => {
  for (const win of gridPlan.windows) {
    const [lo, hi] = extent(win);
    const host = gridPlan.walls.find(
      (w) => w.exterior && w.roomId === win.roomId && sameLine(w, win) && lo >= extent(w)[0] - 1e-6 && hi <= extent(w)[1] + 1e-6,
    );
    assert.ok(host, `${win.roomId} window is not on its own exterior wall`);
  }
});

test('minWidth reads an L by its thinner arm', () => {
  const room = {
    ...program(demo)[0],
    rect: { x: 0, y: 0, w: 4, h: 4 },
    parts: [{ x: 0, y: 0, w: 4, h: 1 }, { x: 0, y: 1, w: 1.5, h: 3 }],
  };
  assert.ok(Math.abs(minWidth(room) - 1) < 1e-9, `got ${minWidth(room)}`);
});

test('furniture stays inside its room, off door swings and off other pieces', () => {
  const items = placeFurniture(plan, demo.wallThickness);
  assert.ok(items.some((f) => f.kind === 'bed'), 'a bedroom gets a bed');
  assert.ok(items.some((f) => f.kind === 'wc'), 'a bath gets a WC');
  const hit = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
  for (const f of items) {
    const room = plan.rooms.find((r) => r.id === f.roomId)!;
    assert.ok(partsOf(room).some((p) => f.rect.x >= p.x && f.rect.y >= p.y && f.rect.x + f.rect.w <= p.x + p.w + 1e-9 && f.rect.y + f.rect.h <= p.y + p.h + 1e-9), `${f.kind} inside ${room.id}`);
    for (const d of plan.doors) assert.ok(!inDoorSwing(f.rect, d), `${f.kind} clear of door ${d.a}`);
    for (const g of items) if (g !== f) assert.ok(!hit(f.rect, g.rect), `${f.kind} clear of ${g.kind}`);
  }
  assert.deepEqual(placeFurniture(plan, demo.wallThickness), items, 'same plan, same furniture');
});

test('a dragged door stays on the wall its two rooms share', () => {
  const i = plan.doors.findIndex((d) => !d.entry);
  const [lo] = openingRange(plan.doors[i]);
  const moved = setDoor(plan, i, lo + 50, lo + 50.9).doors[i];
  const a = plan.rooms.find((r) => r.id === moved.a)!;
  const b = plan.rooms.find((r) => r.id === moved.b)!;
  const [mlo, mhi] = openingRange(moved);
  assert.ok(Math.abs(mhi - mlo - 0.9) < 1e-6, 'width kept');
  const host = [...partsOf(a), ...partsOf(b)];
  assert.ok(host.length && mlo >= 0 && mhi <= Math.max(plan.footprint.w, plan.footprint.h), 'still on the plan');
  const w = setWindow(plan, 0, -10, 20).windows[0];
  const [wlo, whi] = openingRange(w);
  assert.ok(whi - wlo >= 0.4 && wlo >= 0, 'window clamped into its wall');
});

test('dragging a wall keeps the rooms tiling the footprint', () => {
  const total = plan.rooms.reduce((s, r) => s + roomArea(r), 0);
  let moved = 0;
  for (const line of wallLines(plan.walls)) {
    const next = moveWall(plan, line, line.at + 0.3) ?? moveWall(plan, line, line.at - 0.3);
    if (!next) continue;
    moved++;
    assert.ok(Math.abs(next.rooms.reduce((s, r) => s + roomArea(r), 0) - total) < 1e-6, 'area conserved');
    for (const r of next.rooms) for (const p of partsOf(r)) assert.ok(p.w >= MIN_PART - 1e-9 && p.h >= MIN_PART - 1e-9);
  }
  assert.ok(moved > 0, 'some wall could move');
  const line = wallLines(plan.walls)[0];
  assert.equal(moveWall(plan, line, line.at + 100), null, 'a room cannot be squeezed out');
});

test('rotating a piece four times brings it back', () => {
  let p = { ...plan, furniture: placeFurniture(plan, demo.wallThickness) };
  const i = p.furniture.findIndex((f) => f.kind === 'wc');
  const before = p.furniture[i];
  for (let k = 0; k < 4; k++) p = { ...rotateFurniture(p, i, demo.wallThickness), furniture: rotateFurniture(p, i, demo.wallThickness).furniture! };
  assert.equal(p.furniture[i].facing, before.facing);
});

test('area schedule: carpet is the clear floor inside the walls', () => {
  const t = demo.wallThickness;
  const room = { ...plan.rooms[0], rect: { x: 0, y: 0, w: 4, h: 3 }, parts: undefined };
  assert.ok(Math.abs(carpetArea(room, t) - (4 - t) * (3 - t)) < 1e-9, 'rectangle');
  const ell = { ...room, rect: { x: 0, y: 0, w: 4, h: 4 }, parts: [{ x: 0, y: 0, w: 4, h: 2 }, { x: 0, y: 2, w: 2, h: 2 }] };
  // L of a 4×2 bar and a 2×2 leg: clear floor is the same L shrunk by t/2 all round.
  const expected = (4 - t) * (2 - t) + (2 - t) * 2;
  assert.ok(Math.abs(carpetArea(ell, t) - expected) < 1e-9, 'L-shape');
  const s = areaSchedule(plan, demo);
  assert.equal(s.rows.length, plan.rooms.length);
  assert.ok(s.carpet < plan.footprint.w * plan.footprint.h && s.carpet < s.builtUp);
  assert.ok(s.coverage > 0 && s.coverage < 1 && s.efficiency > 0.7 && s.efficiency < 1);
  assert.match(scheduleCSV(s), /^Room,/);
});

test('dimension chains add up to the footprint on every side', () => {
  for (const c of dimensionChains(plan)) {
    const span = c.side === 'n' || c.side === 's' ? plan.footprint.w : plan.footprint.h;
    assert.ok(Math.abs(c.marks[0]) < 1e-9 && Math.abs(c.marks[c.marks.length - 1] - span) < 1e-9, `${c.side} chain spans the side`);
  }
});

test('DXF export is well formed', () => {
  const dxf = planDXF({ ...plan, furniture: placeFurniture(plan, demo.wallThickness) }, demo);
  const lines = dxf.trimEnd().split('\r\n');
  assert.equal(lines.length % 2, 0, 'code/value pairs');
  for (let i = 0; i < lines.length; i += 2) assert.ok(/^\s*-?\d+$/.test(lines[i]), `group code at line ${i + 1}`);
  const values = lines.filter((_, i) => i % 2 === 1);
  assert.equal(values.filter((v) => v === 'SECTION').length, values.filter((v) => v === 'ENDSEC').length);
  assert.equal(values[values.length - 1], 'EOF');
  assert.ok(values.filter((v) => v === 'ARC').length === plan.doors.length, 'one swing per door');
  assert.ok(values.filter((v) => v === 'LINE').length > plan.walls.length * 4);
  assert.ok(!values.some((v) => v === 'NaN' || v.includes('NaN')), 'no NaN coordinates');
});

test('re-furnishing offers other good arrangements, all clash-free', () => {
  const t = demo.wallThickness;
  const first = placeFurniture(plan, t, 0);
  const hit = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
  let differs = 0;
  const kinds = (fs: typeof first, id: string) => fs.filter((f) => f.roomId === id).map((f) => f.kind.replace(/NS$|Set$|[46]$/, '')).sort().join();
  for (let v = 1; v <= 8; v++) {
    const alt = placeFurniture(plan, t, v);
    if (JSON.stringify(alt) !== JSON.stringify(first)) differs++;
    for (const r of plan.rooms) {
      const has = kinds(alt, r.id).split(',');
      for (const k of kinds(first, r.id).split(',').filter(Boolean)) assert.ok(has.includes(k), `variant ${v}: ${r.id} keeps its ${k}`);
    }
    for (const f of alt) {
      for (const d of plan.doors) assert.ok(!inDoorSwing(f.rect, d), `variant ${v}: ${f.kind} clear of doors`);
      for (const g of alt) if (g !== f) assert.ok(!hit(f.rect, g.rect), `variant ${v}: ${f.kind} clear of ${g.kind}`);
    }
  }
  assert.ok(differs > 0, 'some step gives a different layout');
  assert.deepEqual(placeFurniture(plan, t, 0), first, 'step 0 is stable');
});

test('NBC checks: room sizes, ventilation and entered bye-law limits', () => {
  const checks = checkCompliance(plan, demo);
  const rooms = (rule: RegExp) => checks.filter((c) => rule.test(c.rule));
  assert.equal(rooms(/^Habitable/).length, plan.rooms.filter((r) => ['living', 'dining', 'bedroom'].includes(r.type)).length);
  assert.equal(rooms(/^Toilet/).length, plan.rooms.filter((r) => r.type === 'bath').length);
  assert.ok(checks.every((c) => c.ref && c.detail), 'every check cites a source');
  assert.ok(!checks.some((c) => c.source === 'bye-law'), 'no bye-law checks without limits');

  // A shrunken bath fails the 2.8 m² toilet rule.
  const bath = plan.rooms.find((r) => r.type === 'bath')!;
  const tiny = { ...plan, rooms: plan.rooms.map((r) => (r === bath ? { ...r, rect: { ...r.rect, w: 1.5, h: 1.5 }, parts: undefined } : r)) };
  assert.equal(checkCompliance(tiny, demo).find((c) => c.roomId === bath.id && /^Toilet/.test(c.rule))!.status, 'fail');

  const strict = checkCompliance(plan, demo, { ...DEFAULT_COMPLIANCE, limits: { coverage: 0.1, front: 1, far: 5 } });
  assert.equal(strict.find((c) => /coverage/.test(c.rule))!.status, 'fail');
  assert.equal(strict.find((c) => /^FAR/.test(c.rule))!.status, 'pass');
  assert.equal(strict.find((c) => /^Front/.test(c.rule))!.status, 'pass', '1.5 m less half a wall clears 1 m');
});

test('fixing windows clears the ventilation failures it can', () => {
  const opts = { ...DEFAULT_COMPLIANCE, climate: 'warm-humid' as const };
  const fails = (p: typeof plan) => checkCompliance(p, demo, opts).filter((c) => /^Window area/.test(c.rule) && c.status === 'fail').length;
  const before = fails(plan);
  assert.ok(before > 0, 'warm-humid 1/6 fails somewhere on the demo');
  const fixed = fixWindows(plan, demo, opts);
  assert.ok(fails(fixed) < before, `${before} -> ${fails(fixed)}`);
  for (const w of fixed.windows) {
    const [lo, hi] = openingRange(w);
    assert.ok(hi - lo >= 0.4 && lo >= -1e-9, 'windows stay on the plan');
  }
});
