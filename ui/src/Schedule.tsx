import { SQFT_PER_M2, type Schedule } from '../../engine/src/index.js';

const m2 = (n: number) => n.toFixed(2);
const ft2 = (n: number) => Math.round(n * SQFT_PER_M2).toLocaleString('en-IN');

/** The area statement: per room, then carpet, built-up, coverage and efficiency. */
export default function ScheduleTable({ s, onCSV }: { s: Schedule; onCSV: () => void }) {
  return (
    <details className="schedule" open>
      <summary>
        Area schedule · carpet {m2(s.carpet)} m² ({ft2(s.carpet)} sq ft) · built-up {m2(s.builtUp)} m²
      </summary>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Size (m)</th>
            <th>Area m²</th>
            <th>Carpet m²</th>
            <th>Carpet sq ft</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.w.toFixed(2)} × {r.h.toFixed(2)}</td>
              <td>{m2(r.area)}</td>
              <td>{m2(r.carpet)}</td>
              <td>{ft2(r.carpet)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>Total carpet</td><td /><td /><td>{m2(s.carpet)}</td><td>{ft2(s.carpet)}</td></tr>
          <tr><td>Built-up</td><td /><td /><td>{m2(s.builtUp)}</td><td>{ft2(s.builtUp)}</td></tr>
          <tr><td>Plot</td><td /><td /><td>{m2(s.plot)}</td><td>{ft2(s.plot)}</td></tr>
        </tfoot>
      </table>
      <p className="muted">
        Ground coverage {(s.coverage * 100).toFixed(1)}% · FAR {s.far.toFixed(2)} (single storey) · efficiency{' '}
        {(s.efficiency * 100).toFixed(1)}% carpet / built-up · <button type="button" className="link" onClick={onCSV}>Download CSV</button>
      </p>
    </details>
  );
}
