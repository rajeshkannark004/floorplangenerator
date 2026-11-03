import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  renderSVG,
  sheetFrame,
  wallLines,
  moveWall,
  setDoor,
  setWindow,
  openingRange,
  moveFurniture,
  rotateFurniture,
  removeAt,
  furnitureClashes,
  partsOf,
  type Brief,
  type Plan,
  type WallLine,
} from '../../engine/src/index.js';

/** Drags snap to this, in metres. */
const SNAP = 0.05;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

type Kind = 'furniture' | 'door' | 'window' | 'wall';
export type Selection = { kind: Kind; i: number } | null;

type Pt = { x: number; y: number };
type Drag =
  | { kind: 'furniture'; i: number; start: Pt; origin: Plan }
  | { kind: 'door' | 'window'; i: number; end: 'move' | 'lo' | 'hi'; start: Pt; origin: Plan }
  | { kind: 'wall'; line: WallLine; start: Pt; origin: Plan };

const vertical = (s: { x1: number; x2: number }) => Math.abs(s.x1 - s.x2) < 1e-6;

/** The index of the line `was` became once moved to `at`; lines are re-derived after every wall move. */
const findLine = (lines: WallLine[], was: WallLine, at: number) =>
  lines.findIndex((l) => l.axis === was.axis && Math.abs(l.at - at) < 1e-6 && Math.min(l.hi, was.hi) - Math.max(l.lo, was.lo) > 1e-6);

/**
 * The nearest room edges either side of a wall line: where the room on its low
 * side starts and where the room on its high side ends. A typed room size is
 * measured from these.
 */
function wallNeighbours(plan: Plan, l: WallLine): { from?: number; to?: number } {
  let from: number | undefined;
  let to: number | undefined;
  const E = 1e-6;
  for (const r of plan.rooms) {
    for (const p of partsOf(r)) {
      const [a, b, lo, hi] = l.axis === 'v' ? [p.x, p.x + p.w, p.y, p.y + p.h] : [p.y, p.y + p.h, p.x, p.x + p.w];
      if (Math.min(hi, l.hi) - Math.max(lo, l.lo) <= E) continue;
      if (Math.abs(b - l.at) < E) from = from === undefined ? a : Math.max(from, a);
      if (Math.abs(a - l.at) < E) to = to === undefined ? b : Math.min(to, b);
    }
  }
  return { from, to };
}

/** A metres field that commits on Enter or blur, not on every keystroke. */
function Metres({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const done = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v > 0 && Math.abs(v - value) > 1e-6) onCommit(v);
    else setText(value.toFixed(2));
  };
  return (
    <label className="metres">
      {label}
      <input
        type="number"
        step={0.05}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      m
    </label>
  );
}

interface Props {
  plan: Plan;
  brief: Brief;
  /** A finished edit, to keep for undo. */
  onCommit: (plan: Plan) => void;
}

/**
 * The plan as an editable drawing. The engine's SVG is drawn as-is, and a
 * transparent overlay with the same viewBox carries the hit targets and
 * handles, so the editor never redraws a symbol of its own. While a drag is
 * under way the edit lives in `draft`; it is committed on release.
 */
export default function Editor({ plan, brief, onCommit }: Props) {
  const [draft, setDraft] = useState<Plan | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const drag = useRef<Drag | null>(null);
  const overlay = useRef<SVGSVGElement>(null);

  const shown = draft ?? plan;
  const t = brief.wallThickness;
  const frame = useMemo(() => sheetFrame(brief), [brief]);
  const { px, py, scale } = frame;
  const W = Math.round(frame.W);
  const H = Math.round(frame.H);

  const svg = useMemo(() => renderSVG(shown, brief), [shown, brief]);
  const lines = useMemo(() => wallLines(shown.walls), [shown.walls]);
  const clashes = useMemo(() => furnitureClashes(shown, t), [shown, t]);

  // A new plan (generate, load) starts with nothing selected; an undo may take
  // the selected item away.
  useEffect(() => setSel(null), [plan.seed, plan.footprint]);
  useEffect(() => {
    if (!sel) return;
    const n =
      sel.kind === 'furniture' ? (plan.furniture ?? []).length :
      sel.kind === 'door' ? plan.doors.length :
      sel.kind === 'window' ? plan.windows.length :
      wallLines(plan.walls).length;
    if (sel.i >= n) setSel(null);
  }, [plan, sel]);
  const wallAt = useRef(0);

  /** Pointer position in plan metres. */
  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const el = overlay.current!;
    const m = el.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: (p.x - px(0)) / scale, y: (p.y - py(0)) / scale };
  };

  const begin = (e: ReactPointerEvent, d: Drag, s: Selection) => {
    e.stopPropagation();
    e.preventDefault();
    overlay.current!.setPointerCapture(e.pointerId);
    drag.current = d;
    setSel(s);
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPlan(e);
    const dx = snap(p.x - d.start.x);
    const dy = snap(p.y - d.start.y);
    if (d.kind === 'furniture') {
      const f = d.origin.furniture![d.i];
      setDraft(moveFurniture(d.origin, d.i, f.rect.x + dx, f.rect.y + dy, t));
    } else if (d.kind === 'wall') {
      const at = d.line.at + (d.line.axis === 'v' ? dx : dy);
      const next = moveWall(d.origin, d.line, at);
      if (next) {
        wallAt.current = at;
        setDraft(next);
      }
    } else {
      const seg = d.kind === 'door' ? d.origin.doors[d.i] : d.origin.windows[d.i];
      const delta = vertical(seg) ? dy : dx;
      let [lo, hi] = openingRange(seg);
      if (d.end !== 'hi') lo += delta;
      if (d.end !== 'lo') hi += delta;
      if (hi - lo < 0.2) return;
      setDraft(d.kind === 'door' ? setDoor(d.origin, d.i, lo, hi) : setWindow(d.origin, d.i, lo, hi));
    }
  };

  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (draft && draft !== plan) {
      onCommit(draft);
      if (d.kind === 'wall') {
        const i = findLine(wallLines(draft.walls), d.line, wallAt.current);
        setSel(i >= 0 ? { kind: 'wall', i } : null);
      }
    }
    setDraft(null);
  };

  /** Move the selected wall to `at`, from a typed size. */
  const wallTo = (l: WallLine, at: number) => {
    const next = moveWall(plan, l, at);
    if (!next) return;
    onCommit(next);
    const i = findLine(wallLines(next.walls), l, at);
    setSel(i >= 0 ? { kind: 'wall', i } : null);
  };

  /** Resize the selected door or window from a typed width, keeping its start. */
  const widthTo = (kind: 'door' | 'window', i: number, w: number) => {
    const seg = kind === 'door' ? plan.doors[i] : plan.windows[i];
    const [lo] = openingRange(seg);
    onCommit(kind === 'door' ? setDoor(plan, i, lo, lo + w) : setWindow(plan, i, lo, lo + w));
  };

  const rotate = () => {
    if (sel?.kind === 'furniture') onCommit(rotateFurniture(plan, sel.i, t));
  };
  const remove = () => {
    if (!sel || sel.kind === 'wall') return;
    const key = sel.kind === 'furniture' ? 'furniture' : sel.kind === 'door' ? 'doors' : 'windows';
    onCommit(removeAt(plan, key, sel.i));
    setSel(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') setSel(null);
      else if (e.key === 'Delete' || e.key === 'Backspace') remove();
      else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) rotate();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isSel = (kind: Kind, i: number) => sel?.kind === kind && sel.i === i;
  const pad = Math.max(t * scale, 8);

  const opening = (kind: 'door' | 'window', s: { x1: number; y1: number; x2: number; y2: number }, i: number) => {
    const [lo, hi] = openingRange(s);
    const v = vertical(s);
    const x = v ? px(s.x1) - pad / 2 : px(lo);
    const y = v ? py(lo) : py(s.y1) - pad / 2;
    const w = v ? pad : (hi - lo) * scale;
    const h = v ? (hi - lo) * scale : pad;
    const start = (end: 'move' | 'lo' | 'hi') => (e: ReactPointerEvent) =>
      begin(e, { kind, i, end, start: toPlan(e), origin: plan }, { kind, i });
    const handle = (at: number, end: 'lo' | 'hi') => (
      <circle
        className="handle"
        cx={v ? px(s.x1) : px(at)}
        cy={v ? py(at) : py(s.y1)}
        r={6}
        style={{ cursor: v ? 'ns-resize' : 'ew-resize' }}
        onPointerDown={start(end)}
      />
    );
    return (
      <g key={`${kind}-${i}`}>
        <rect
          className={`hit ${kind} ${isSel(kind, i) ? 'selected' : ''}`}
          x={x} y={y} width={w} height={h}
          style={{ cursor: v ? 'ns-resize' : 'ew-resize' }}
          onPointerDown={start('move')}
        />
        {isSel(kind, i) ? <>{handle(lo, 'lo')}{handle(hi, 'hi')}</> : null}
      </g>
    );
  };

  const selName =
    !sel ? null :
    sel.kind === 'furniture' ? shown.furniture?.[sel.i]?.kind :
    sel.kind === 'door' ? (shown.doors[sel.i]?.entry ? 'entry door' : 'door') :
    sel.kind;

  return (
    <div className="editor">
      <div className="sheet editable">
        <div className="drawing" dangerouslySetInnerHTML={{ __html: svg }} />
        <svg
          ref={overlay}
          className="overlay"
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerDown={() => setSel(null)}
        >
          {lines.map((l, i) => (
            <line
              key={`wall-${i}`}
              className={`hit wall ${isSel('wall', i) ? 'selected' : ''}`}
              x1={px(l.axis === 'v' ? l.at : l.lo)} y1={py(l.axis === 'v' ? l.lo : l.at)}
              x2={px(l.axis === 'v' ? l.at : l.hi)} y2={py(l.axis === 'v' ? l.hi : l.at)}
              strokeWidth={pad + 4}
              style={{ cursor: l.axis === 'v' ? 'ew-resize' : 'ns-resize' }}
              onPointerDown={(e) => begin(e, { kind: 'wall', line: l, start: toPlan(e), origin: plan }, { kind: 'wall', i })}
            />
          ))}
          {(shown.furniture ?? []).map((f, i) => (
            <rect
              key={`f-${i}`}
              className={`hit furniture ${clashes.has(i) ? 'clash' : ''} ${isSel('furniture', i) ? 'selected' : ''}`}
              x={px(f.rect.x)} y={py(f.rect.y)} width={f.rect.w * scale} height={f.rect.h * scale}
              onPointerDown={(e) => begin(e, { kind: 'furniture', i, start: toPlan(e), origin: plan }, { kind: 'furniture', i })}
            />
          ))}
          {shown.windows.map((w, i) => opening('window', w, i))}
          {shown.doors.map((d, i) => opening('door', d, i))}
        </svg>
      </div>
      <div className="selbar">
        {sel ? (
          <>
            <span>Selected: <b>{selName}</b></span>
            {sel.kind === 'wall' && lines[sel.i] ? (() => {
              const l = lines[sel.i];
              const { from, to } = wallNeighbours(plan, l);
              const [lowName, highName] = l.axis === 'v' ? ['Room left', 'Room right'] : ['Room above', 'Room below'];
              return (
                <>
                  {from !== undefined ? <Metres label={lowName} value={l.at - from} onCommit={(v) => wallTo(l, from + v)} /> : null}
                  {to !== undefined ? <Metres label={highName} value={to - l.at} onCommit={(v) => wallTo(l, to - v)} /> : null}
                </>
              );
            })() : null}
            {(sel.kind === 'door' || sel.kind === 'window') && (sel.kind === 'door' ? plan.doors : plan.windows)[sel.i] ? (() => {
              const [lo, hi] = openingRange((sel.kind === 'door' ? plan.doors : plan.windows)[sel.i]);
              return <Metres label="Width" value={hi - lo} onCommit={(v) => widthTo(sel.kind as 'door' | 'window', sel.i, v)} />;
            })() : null}
            {sel.kind === 'furniture' && plan.furniture?.[sel.i] ? (
              <span className="muted">{plan.furniture[sel.i].len.toFixed(2)} × {plan.furniture[sel.i].depth.toFixed(2)} m</span>
            ) : null}
            {sel.kind === 'furniture' ? <button type="button" onClick={rotate}>Rotate (R)</button> : null}
            {sel.kind !== 'wall' ? <button type="button" onClick={remove}>Delete (Del)</button> : null}
          </>
        ) : (
          <span className="muted">Drag furniture, doors, windows or walls. Drag a door or window's end dots to resize it.</span>
        )}
      </div>
    </div>
  );
}
