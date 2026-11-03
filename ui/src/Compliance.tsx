import { useState } from 'react';
import { type Check, type Climate, type ComplianceOptions } from '../../engine/src/index.js';

const CLIMATES: Climate[] = ['hot-dry', 'warm-humid', 'composite', 'temperate', 'cold'];
const MARK: Record<Check['status'], string> = { pass: '✓', fail: '✗', advice: '!' };

/** An optional limit: empty means "not checked". */
function Limit({ label, value, onChange, suffix }: { label: string; value?: number; onChange: (v?: number) => void; suffix: string }) {
  return (
    <label className="limit">
      {label}
      <input
        type="number"
        step={0.1}
        value={value ?? ''}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      {suffix}
    </label>
  );
}

interface Props {
  checks: Check[];
  opts: ComplianceOptions;
  onOpts: (o: ComplianceOptions) => void;
  /** Widen windows that fall short; absent when nothing to fix. */
  onFixWindows?: () => void;
}

/** NBC 2016 checks, with the climate, window height and local bye-law limits they run against. */
export default function CompliancePanel({ checks, opts, onOpts, onFixWindows }: Props) {
  const [showPass, setShowPass] = useState(false);
  const fail = checks.filter((c) => c.status === 'fail').length;
  const advice = checks.filter((c) => c.status === 'advice').length;
  const shown = showPass ? checks : checks.filter((c) => c.status !== 'pass');
  const L = opts.limits;
  const limit = (k: keyof ComplianceOptions['limits'], scale = 1) => (v?: number) =>
    onOpts({ ...opts, limits: { ...L, [k]: v === undefined || !Number.isFinite(v) ? undefined : v / scale } });

  return (
    <details className="compliance" open>
      <summary>
        Code check · NBC 2016 ·{' '}
        <span className={fail ? 'bad' : 'good'}>{fail ? `${fail} fail` : 'no fails'}</span>
        {advice ? ` · ${advice} advice` : ''} · {checks.length - fail - advice} pass
      </summary>

      <div className="settings">
        <label className="limit">
          Climate
          <select value={opts.climate} onChange={(e) => onOpts({ ...opts, climate: e.target.value as Climate })}>
            {CLIMATES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <Limit label="Window height" value={opts.windowHeight} suffix="m"
          onChange={(v) => v && v > 0 && onOpts({ ...opts, windowHeight: v })} />
        <span className="muted">Local bye-law, leave blank to skip:</span>
        <Limit label="Max coverage" value={L.coverage === undefined ? undefined : +(L.coverage * 100).toFixed(2)} suffix="%" onChange={limit('coverage', 100)} />
        <Limit label="Max FAR" value={L.far} suffix="" onChange={limit('far')} />
        <Limit label="Front" value={L.front} suffix="m" onChange={limit('front')} />
        <Limit label="Rear" value={L.rear} suffix="m" onChange={limit('rear')} />
        <Limit label="Side" value={L.side} suffix="m" onChange={limit('side')} />
      </div>

      <ul className="checks">
        {shown.map((c, i) => (
          <li key={i} className={c.status}>
            <span className="mark">{MARK[c.status]}</span>
            <span className="rule">{c.rule}</span>
            <span className="detail">{c.detail}</span>
            <span className={`ref ${c.source}`} title={c.source === 'secondary' ? 'From secondary sources, not read in the code text' : undefined}>{c.ref}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        <button type="button" className="link" onClick={() => setShowPass((s) => !s)}>{showPass ? 'Hide passes' : 'Show passes'}</button>
        {onFixWindows ? <> · <button type="button" className="link" onClick={onFixWindows}>Widen short windows</button></> : null}
        {' '}· Clear sizes inside walls. Room heights are not checked (2D plan). Rules marked secondary are from secondary
        sources; confirm against the code text and your state bye-law.
      </p>
    </details>
  );
}
