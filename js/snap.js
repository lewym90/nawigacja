// Tor jazdy: jedna linia dla auta, kamery i wstęgi, dopasowana do prawdziwych jezdni z BDOT10k.
// Trasa z Valhalli biegnie po osiach OSM, a jezdnie narysowane w silniku pochodzą z BDOT i potrafią leżeć kilka metrów obok.

const CELL = 40;
const STEP = 2.5;

export class AxisIndex {
  /** lines: [{ pts: [[x, y], ...], w, two }] w metrach Merkatora. */
  constructor(lines) {
    this.cells = new Map();
    lines.forEach((l, id) => {
      for (let i = 1; i < l.pts.length; i++) {
        const [ax, ay] = l.pts[i - 1]; const [bx, by] = l.pts[i]; const seg = { ax, ay, bx, by, w: l.w, two: l.two, id };
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2));
        const seen = new Set();
        for (let k = 0; k <= n; k++) {
          const c = this.key(ax + ((bx - ax) * k) / (n || 1), ay + ((by - ay) * k) / (n || 1));
          if (seen.has(c)) continue;
          seen.add(c);
          if (!this.cells.has(c)) this.cells.set(c, []);
          this.cells.get(c).push(seg);
        }
      }
    });
  }

  key(x, y) { return Math.floor(x / CELL) * 1000003 + Math.floor(y / CELL); }

  near(x, y) {
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = this.cells.get(this.key(x + i * CELL, y + j * CELL)); if (c) out.push(...c); }
    return out;
  }
}

/** Plik axes.bin: patrz tools/build-roads.py. */
export function parseAxes(buf, org) {
  const dv = new DataView(buf); const n = dv.getUint32(0, true); let o = 4; const lines = [];
  for (let i = 0; i < n; i++) {
    const c = dv.getUint32(o, true); const w = dv.getFloat32(o + 4, true); const two = dv.getFloat32(o + 8, true) > 0.5; o += 12; const pts = [];
    for (let k = 0; k < c; k++, o += 8) pts.push([dv.getFloat32(o, true) + org[0], dv.getFloat32(o + 4, true) + org[1]]);
    lines.push({ pts, w, two });
  }
  return new AxisIndex(lines);
}

function resample(raw, K) {
  const p = []; const along = []; let s = 0; let next = 0;
  for (let i = 1; i < raw.length; i++) {
    const [ax, ay] = raw[i - 1]; const [bx, by] = raw[i]; const d = Math.hypot(bx - ax, by - ay) / K;
    while (d > 0 && next <= s + d) { const u = (next - s) / d; p.push([ax + (bx - ax) * u, ay + (by - ay) * u]); along.push(next); next += STEP; }
    s += d;
  }
  p.push([...raw[raw.length - 1]]); along.push(s);
  return { p, along };
}

const smooth = (v, reach) => v.map((q, i) => {
  const r = Math.min(reach, i, v.length - 1 - i); let x = 0; let y = 0; // przy końcach okno się zwęża: początek i cel zostają na miejscu
  for (let j = i - r; j <= i + r; j++) { x += v[j][0]; y += v[j][1]; }
  return [x / (2 * r + 1), y / (2 * r + 1)];
});

/** Przesunięcie punktu toru na jezdnię, albo null, gdy w pobliżu nie ma pasującej osi (środek skrzyżowania, kierunek w poprzek). */
function shift(p, fx, fy, K, axes, prev) {
  let best = null; let bestScore = Infinity;
  for (const s of axes.near(p[0], p[1])) {
    const ex = s.bx - s.ax; const ey = s.by - s.ay; const l2 = ex * ex + ey * ey; if (!l2) continue;
    if (Math.abs(ex * fx + ey * fy) / Math.sqrt(l2) < 0.8) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - s.ax) * ex + (p[1] - s.ay) * ey) / l2));
    const qx = s.ax + ex * t; const qy = s.ay + ey * t; const d = Math.hypot(qx - p[0], qy - p[1]) / K;
    if (d > s.w / 2 + 7) continue;
    const score = d + (s.id === prev.id ? 0 : 3); // trzymamy się tej samej jezdni, żeby nie przeskakiwać na równoległą
    if (score < bestScore) { bestScore = score; best = { qx, qy, s }; }
  }
  if (!best) return null;
  prev.id = best.s.id;
  const off = best.s.two && best.s.w >= 5 ? (best.s.w / 4) * K : 0; // ruch prawostronny: środek prawego pasa
  return [best.qx + fy * off - p[0], best.qy - fx * off - p[1]];
}

/** Zwraca tor: punkty w metrach Merkatora i odległość wzdłuż trasy dla każdego z nich. Długości zostają z trasy, więc postęp i dystanse się nie rozjeżdżają. */
export function drivePath(raw, K = 1, axes = null) {
  const { p, along } = resample(raw, K); const n = p.length; let pts = p;
  if (axes) {
    const prev = { id: -1 }; const disp = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 8)]; const b = p[Math.min(n - 1, i + 8)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!l) continue;
      disp[i] = shift(p[i], (b[0] - a[0]) / l, (b[1] - a[1]) / l, K, axes, prev);
    }
    const LONG = 40; // ponad 100 m bez jezdni: to nie skrzyżowanie, tylko miejsce bez danych, więc wracamy na trasę
    let last = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && !disp[i]) continue;
      const a = last >= 0 ? disp[last] : [0, 0]; const b = i < n ? disp[i] : [0, 0]; const gap = i - last;
      for (let j = last + 1; j < i; j++) {
        const u = (j - last) / gap;
        const f = gap > LONG ? Math.max(0, 1 - Math.min(j - last, i - j) / 20) : 1;
        disp[j] = [(a[0] + (b[0] - a[0]) * u) * f, (a[1] + (b[1] - a[1]) * u) * f];
      }
      last = i;
    }
    const d = smooth(smooth(disp, 6), 6);
    pts = p.map((q, i) => [q[0] + d[i][0], q[1] + d[i][1]]);
  }
  return { pts: smooth(pts, 5), along };
}

/** Punkt toru dla odległości wzdłuż trasy. toLngLat zamienia Merkatora na stopnie. */
export function pathAt(path, s, toLngLat) {
  const { pts, along } = path; const n = pts.length; const v = Math.max(0, Math.min(along[n - 1], s));
  let lo = 0; let hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (along[m] <= v) lo = m; else hi = m; }
  const u = (v - along[lo]) / ((along[hi] - along[lo]) || 1);
  const a = pts[Math.max(0, lo - 2)]; const b = pts[Math.min(n - 1, hi + 2)];
  return { point: toLngLat(pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u), bearing: (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI };
}
