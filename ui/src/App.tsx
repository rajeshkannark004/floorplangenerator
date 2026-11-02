import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULTS,
  generate,
  renderSVG,
  validate,
  type Brief,
  type Layout,
  type RoomSpec,
} from '../../engine/src/index.js';

interface FormState {
  plotW: number;
  plotD: number;
  front: number;
  back: number;
  left: number;
  right: number;
  wall: number;
  windowW: number;
  bedrooms: number;
  baths: number;
  utility: boolean;
  seed: number;
  attempts: number;
  layout: Layout;
}

const INITIAL: FormState = {
  plotW: 10,
  plotD: 15,
  front: 1.5,
  back: 1.5,
  left: 1.5,
  right: 1.5,
  wall: 0.23,
  windowW: 1.2,
  bedrooms: 2,
  baths: 2,
  utility: true,
  seed: 7,
  attempts: 60,
  layout: 'grid',
};

/** Preview runs at reduced search effort; the CLI keeps the thorough settings. */
const PREVIEW_EFFORT = 0.6;

function toBrief(f: FormState): Brief {
  const rooms: RoomSpec[] = [
    { type: 'living', count: 1, ...DEFAULTS.living },
    { type: 'dining', count: 1, ...DEFAULTS.dining },
    { type: 'kitchen', count: 1, ...DEFAULTS.kitchen },
  ];
  if (f.bedrooms > 0) rooms.push({ type: 'bedroom', count: f.bedrooms, ...DEFAULTS.bedroom });
  if (f.baths > 0) rooms.push({ type: 'bath', count: f.baths, ...DEFAULTS.bath });
  if (f.utility) rooms.push({ type: 'utility', count: 1, ...DEFAULTS.utility });

  return {
    plot: { w: f.plotW, d: f.plotD },
    setbacks: { front: f.front, back: f.back, left: f.left, right: f.right },
    wallThickness: f.wall,
    windowWidth: f.windowW,
    rooms,
  };
}

interface Stats {
  rooms: number;
  doors: number;
  windows: number;
  score: number;
  ms: number;
}

function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 0.1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {suffix ? <em>{suffix}</em> : null}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

export default function App() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [svg, setSvg] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The form a plan was last requested for. Nothing generates until the user
  // presses Generate, so editing a field no longer kicks off a run.
  const [submitted, setSubmitted] = useState<FormState | null>(null);

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!submitted) return;
    setBusy(true);
    let cancelled = false;
    let inner: ReturnType<typeof setTimeout> | undefined;

    // Two timeouts: the first lets React paint the busy state, the second does
    // the work. Generation is synchronous, so without this the spinner never
    // appears — the main thread is blocked for the whole run.
    const outer = setTimeout(() => {
      inner = setTimeout(() => {
        if (cancelled) return;
        const brief = toBrief(submitted);
        try {
          const t0 = performance.now();
          const plan = generate(brief, submitted.seed, submitted.attempts, PREVIEW_EFFORT, submitted.layout);
          const ms = performance.now() - t0;
          setSvg(renderSVG(plan, brief));
          setProblems(validate(plan.rooms, plan.walls, plan.windows, plan.footprint, brief, plan.doors));
          setStats({
            rooms: plan.rooms.length,
            doors: plan.doors.length,
            windows: plan.windows.length,
            score: plan.score,
            ms,
          });
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setProblems([]);
          setStats(null);
        }
        setBusy(false);
      }, 16);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(outer);
      if (inner) clearTimeout(inner);
    };
  }, [submitted]);

  const stale = submitted !== null && submitted !== form;

  const buildable = useMemo(
    () => ({
      w: form.plotW - form.left - form.right,
      d: form.plotD - form.front - form.back,
    }),
    [form.plotW, form.plotD, form.left, form.right, form.front, form.back],
  );

  const tooSmall = buildable.w < 3 || buildable.d < 3;

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>Floorplan generator</h1>
          <p className="muted">Constraint-driven 2D layout · engine imported directly</p>
        </header>

        <section>
          <h2>Plot</h2>
          <div className="row">
            <Num label="Width" value={form.plotW} onChange={set('plotW')} min={4} max={40} step={0.5} suffix="m" />
            <Num label="Depth" value={form.plotD} onChange={set('plotD')} min={4} max={60} step={0.5} suffix="m" />
          </div>
          <p className={tooSmall ? 'warn' : 'muted'}>
            buildable {buildable.w.toFixed(1)} × {buildable.d.toFixed(1)} m
            {tooSmall ? ' — too small for a programme' : ''}
          </p>
        </section>

        <section>
          <h2>Setbacks</h2>
          <div className="row">
            <Num label="Front" value={form.front} onChange={set('front')} max={6} step={0.25} suffix="m" />
            <Num label="Back" value={form.back} onChange={set('back')} max={6} step={0.25} suffix="m" />
          </div>
          <div className="row">
            <Num label="Left" value={form.left} onChange={set('left')} max={6} step={0.25} suffix="m" />
            <Num label="Right" value={form.right} onChange={set('right')} max={6} step={0.25} suffix="m" />
          </div>
        </section>

        <section>
          <h2>Walls &amp; openings</h2>
          <div className="row">
            <Num label="Wall thickness" value={form.wall} onChange={set('wall')} min={0.05} max={0.6} step={0.01} suffix="m" />
            <Num label="Window width" value={form.windowW} onChange={set('windowW')} min={0.4} max={3} step={0.1} suffix="m" />
          </div>
        </section>

        <section>
          <h2>Programme</h2>
          <div className="row">
            <Num label="Bedrooms" value={form.bedrooms} onChange={set('bedrooms')} min={0} max={5} step={1} />
            <Num label="Baths" value={form.baths} onChange={set('baths')} min={0} max={5} step={1} />
          </div>
          <label className="check">
            <input type="checkbox" checked={form.utility} onChange={(e) => set('utility')(e.target.checked)} />
            <span>Utility room</span>
          </label>
        </section>

        <section>
          <h2>Search</h2>
          <div className="row">
            <Num label="Seed" value={form.seed} onChange={set('seed')} min={1} max={9999} step={1} />
            <Num label="Attempts" value={form.attempts} onChange={set('attempts')} min={4} max={200} step={4} />
          </div>
          <label className="field">
            <span className="field-label">Layout</span>
            <select value={form.layout} onChange={(e) => set('layout')(e.target.value as Layout)}>
              <option value="grid">Grown on a grid — rooms can be L-shaped</option>
              <option value="split">Split into rectangles — the original</option>
            </select>
          </label>
          <p className="muted">Same seed and programme always give the same plan.</p>
        </section>

        <section>
          <button
            type="button"
            className="generate"
            disabled={busy || tooSmall}
            onClick={() => setSubmitted(form)}
          >
            {busy ? 'Generating…' : 'Generate'}
          </button>
          {stale && !busy ? <p className="muted">Inputs changed — press Generate to update.</p> : null}
        </section>
      </aside>

      <main className="stage">
        <div className={`canvas ${busy ? 'busy' : ''}`}>
          {svg ? (
            <div className="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p className="muted">{error ? 'No plan' : busy ? 'Generating…' : 'Fill in the details and press Generate.'}</p>
          )}
          {busy ? <div className="badge">generating…</div> : null}
        </div>

        <div className="status">
          {error ? (
            <p className="warn">{error}</p>
          ) : problems.length ? (
            <ul className="problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="ok">Validation clean</p>
          )}
          {stats ? (
            <p className="muted">
              {stats.rooms} rooms · {stats.doors} doors · {stats.windows} windows · score{' '}
              {stats.score.toFixed(2)} · {Math.round(stats.ms)} ms
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
