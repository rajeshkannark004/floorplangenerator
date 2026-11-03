import { renderSVG, sheetFrame, type Brief, type Plan } from '../../engine/src/index.js';

/** Hand the browser a file to save. */
export function download(name: string, body: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** ISO sheets, millimetres, short side first. */
const SHEETS: [name: string, short: number, long: number][] = [
  ['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594], ['A1', 594, 841], ['A0', 841, 1189],
];
const PRINT_MARGIN = 10;

/**
 * The smallest ISO sheet the drawing fits on at 1:`denom`, and which way up.
 * The sheet frame is `W` × `H` pixels at `scale` pixels per metre.
 */
export function sheetFor(brief: Brief, denom: number) {
  const f = sheetFrame(brief);
  const wmm = (f.W / f.scale) * (1000 / denom);
  const hmm = (f.H / f.scale) * (1000 / denom);
  for (const [name, s, l] of SHEETS) {
    const room = (a: number, b: number) => wmm <= a - 2 * PRINT_MARGIN && hmm <= b - 2 * PRINT_MARGIN;
    if (room(s, l)) return { name, orientation: 'portrait' as const, wmm, hmm };
    if (room(l, s)) return { name, orientation: 'landscape' as const, wmm, hmm };
  }
  return null;
}

/**
 * Print the sheet at a true scale through the browser's print dialog, where
 * "Save as PDF" gives the PDF. The SVG is sized in millimetres, so 1 m on the
 * plan is exactly 1000/denom mm on paper as long as the dialog prints at 100%.
 */
export function printAtScale(plan: Plan, brief: Brief, denom: number): string | null {
  const sheet = sheetFor(brief, denom);
  if (!sheet) return `The plan does not fit on A0 at 1:${denom}.`;
  const svg = renderSVG(plan, brief)
    .replace(/width="\d+" height="\d+"/, `width="${sheet.wmm.toFixed(2)}mm" height="${sheet.hmm.toFixed(2)}mm"`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Floor plan 1:${denom}</title>
<style>
@page { size: ${sheet.name} ${sheet.orientation}; margin: ${PRINT_MARGIN}mm; }
html, body { margin: 0; }
svg { display: block; }
p { font: 9pt Helvetica, Arial, sans-serif; margin: 2mm 0 0; color: #23272b; }
</style></head><body>${svg}<p>Scale 1:${denom} on ${sheet.name} ${sheet.orientation} · print at 100%, no fit-to-page · dimensions in metres</p></body></html>`;

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow!.focus();
  setTimeout(() => {
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 50);
  return null;
}
