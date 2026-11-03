import type { Compass, VastuItem } from '../../engine/src/index.js';

const MARK: Record<VastuItem['verdict'], string> = { good: '✓', ok: '~', neutral: '·', avoid: '✗' };
const ZONE_NAME: Record<string, string> = {
  N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west', C: 'centre',
};

/** Where each room sits by compass zone, against common Vastu placements. */
export default function VastuPanel({ report, facing, planned }: { report: { items: VastuItem[]; score: number }; facing: Compass; planned: boolean }) {
  const avoid = report.items.filter((i) => i.verdict === 'avoid').length;
  return (
    <details className="vastu" open={planned}>
      <summary>
        Vastu · {facing}-facing · score {report.score}/100{avoid ? ` · ${avoid} to avoid` : ''}
        {planned ? '' : ' · not planned for (tick "Plan for Vastu" and Generate)'}
      </summary>
      <ul className="checks">
        {report.items.map((i) => (
          <li key={i.label} className={i.verdict === 'avoid' ? 'fail' : i.verdict === 'good' ? 'pass' : 'advice'}>
            <span className="mark">{MARK[i.verdict]}</span>
            <span className="rule">{i.label} — {ZONE_NAME[i.zone] ?? i.zone}</span>
            <span className="detail">{i.note}</span>
            <span className="ref secondary">{i.verdict}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        Zones are the plan cut into thirds each way. Placements follow common Vastu guidance, which varies between
        practitioners; treat this as a guide, not a rule.
      </p>
    </details>
  );
}
