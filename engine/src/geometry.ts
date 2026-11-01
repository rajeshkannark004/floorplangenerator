export interface Rect { x: number; y: number; w: number; h: number }

export const EPS = 1e-6;

export const rectArea = (r: Rect) => r.w * r.h;
export const minDim = (r: Rect) => Math.min(r.w, r.h);
export const aspect = (r: Rect) => Math.max(r.w, r.h) / Math.min(r.w, r.h);

export function splitRect(r: Rect, axis: 'x' | 'y', f: number): [Rect, Rect] {
  if (axis === 'x') {
    const w = r.w * f;
    return [{ ...r, w }, { x: r.x + w, y: r.y, w: r.w - w, h: r.h }];
  }
  const h = r.h * f;
  return [{ ...r, h }, { x: r.x, y: r.y + h, w: r.w, h: r.h - h }];
}

export interface SharedEdge { axis: 'v' | 'h'; at: number; lo: number; hi: number; len: number }

export function sharedEdge(a: Rect, b: Rect): SharedEdge | null {
  if (Math.abs(a.x + a.w - b.x) < EPS) return overlapV(a.x + a.w, a, b);
  if (Math.abs(b.x + b.w - a.x) < EPS) return overlapV(a.x, a, b);
  if (Math.abs(a.y + a.h - b.y) < EPS) return overlapH(a.y + a.h, a, b);
  if (Math.abs(b.y + b.h - a.y) < EPS) return overlapH(a.y, a, b);
  return null;
}

function overlapV(at: number, a: Rect, b: Rect): SharedEdge | null {
  const lo = Math.max(a.y, b.y);
  const hi = Math.min(a.y + a.h, b.y + b.h);
  return hi - lo > EPS ? { axis: 'v', at, lo, hi, len: hi - lo } : null;
}

function overlapH(at: number, a: Rect, b: Rect): SharedEdge | null {
  const lo = Math.max(a.x, b.x);
  const hi = Math.min(a.x + a.w, b.x + b.w);
  return hi - lo > EPS ? { axis: 'h', at, lo, hi, len: hi - lo } : null;
}

export function touchesBoundary(r: Rect, fp: Rect): boolean {
  return (
    Math.abs(r.x - fp.x) < EPS ||
    Math.abs(r.y - fp.y) < EPS ||
    Math.abs(r.x + r.w - (fp.x + fp.w)) < EPS ||
    Math.abs(r.y + r.h - (fp.y + fp.h)) < EPS
  );
}
