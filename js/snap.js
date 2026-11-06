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
        const [ax, ay] = l.pts[i - 1]; const [bx, by] = l.pts[i]; const seg = { ax, ay, bx, by, w: l.w, two: l.two, name: l.name, id };
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
    const c = dv.getUint32(o, true); const w = dv.getFloat32(o + 4, true); const two = dv.getFloat32(o + 8, true) > 0.5; const nl = dv.getUint16(o + 12, true); o += 14;
    const name = nl ? new TextDecoder().decode(new Uint8Array(buf, o, nl)) : ''; o += nl; const pts = [];
    for (let k = 0; k < c; k++, o += 8) pts.push([dv.getFloat32(o, true) + org[0], dv.getFloat32(o + 4, true) + org[1]]);
    lines.push({ pts, w, two, name });
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

/** Odległość środka pasa od osi, w prawo od kierunku jazdy. Jedziemy prawym pasem, a przed skrętem w lewo lewym. */
export function laneOffset(w, two, left) {
  if (w < 5) return 0;
  const half = two ? w / 2 : w; const n = Math.max(1, Math.round(half / 3.3)); const lw = half / n;
  if (!left || n === 1 && !two) return w / 2 - lw / 2;
  return two ? lw / 2 : -(w / 2 - lw / 2);
}

/** Punkt na jezdni albo null, gdy w pobliżu nie ma pasującej osi. */
function target(p, fx, fy, K, axes, prev, left) {
  let best = null; let bestScore = Infinity;
  for (const s of axes.near(p[0], p[1])) {
    const ex = s.bx - s.ax; const ey = s.by - s.ay; const l2 = ex * ex + ey * ey; if (!l2) continue;
    if (Math.abs(ex * fx + ey * fy) / Math.sqrt(l2) < 0.85) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - s.ax) * ex + (p[1] - s.ay) * ey) / l2));
    const qx = s.ax + ex * t; const qy = s.ay + ey * t; const d = Math.hypot(qx - p[0], qy - p[1]) / K;
    if (d > s.w / 2 + 7) continue;
    const score = d + (s.id === prev.id ? 0 : 3); // trzymamy się tej samej jezdni, żeby nie przeskakiwać na równoległą
    if (score < bestScore) { bestScore = score; best = { qx, qy, s }; }
  }
  if (!best) return null;
  prev.id = best.s.id;
  const off = laneOffset(best.s.w, best.s.two, left) * K;
  return [best.qx + fy * off, best.qy - fx * off];
}

const unit = (a, b) => { const x = b[0] - a[0]; const y = b[1] - a[1]; const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/** Łuk przez skrzyżowanie: krzywa wzdłuż obu pasów, która skręca dopiero na ich przecięciu i nie ścina narożnika. */
function arc(T, a, b) {
  const P0 = T[a]; const P2 = T[b]; const t0 = unit(T[Math.max(0, a - 6)], P0); const t2 = unit(P2, T[Math.min(T.length - 1, b + 6)]);
  const cross = t0[0] * t2[1] - t0[1] * t2[0]; const chord = Math.hypot(P2[0] - P0[0], P2[1] - P0[1]);
  let C = null;
  if (Math.abs(cross) > 0.25) {
    const u = ((P2[0] - P0[0]) * t2[1] - (P2[1] - P0[1]) * t2[0]) / cross;
    if (u > 0 && u < chord * 1.5) C = [P0[0] + t0[0] * u, P0[1] + t0[1] * u];
  }
  const line = [P0];
  if (C) {
    const r = Math.min(cross < 0 ? 6 : 11, Math.hypot(C[0] - P0[0], C[1] - P0[1]), Math.hypot(C[0] - P2[0], C[1] - P2[1])); // w prawo ciasno przy krawężniku, w lewo szerzej
    const A = [C[0] - t0[0] * r, C[1] - t0[1] * r]; const B = [C[0] + t2[0] * r, C[1] + t2[1] * r];
    for (let i = 0; i <= 12; i++) { const u = i / 12; const v = 1 - u; line.push([v * v * A[0] + 2 * u * v * C[0] + u * u * B[0], v * v * A[1] + 2 * u * v * C[1] + u * u * B[1]]); }
  }
  line.push(P2);
  const cum = [0]; for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  let k = 1;
  for (let j = a + 1; j < b; j++) {
    const d = (cum[cum.length - 1] * (j - a)) / (b - a); while (k < line.length - 1 && cum[k] < d) k++;
    const u = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
    T[j] = [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * u, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * u];
  }
}

/** Zwraca tor: punkty w metrach Merkatora i odległość wzdłuż trasy dla każdego z nich. Długości zostają z trasy, więc postęp i dystanse się nie rozjeżdżają.
 *  lefts: miejsca (metry trasy) skrętów w lewo, przed którymi tor przechodzi na lewy pas. */
export function drivePath(raw, K = 1, axes = null, { lefts = [] } = {}) {
  const { p, along } = resample(raw, K); const n = p.length; let pts = p;
  if (axes) {
    const prev = { id: -1 }; const T = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 8)]; const b = p[Math.min(n - 1, i + 8)]; if (a[0] === b[0] && a[1] === b[1]) continue;
      const f0 = unit(p[Math.max(0, i - 12)], p[i]); const f1 = unit(p[i], p[Math.min(n - 1, i + 12)]);
      if (i >= 12 && i < n - 12 && f0[0] * f1[0] + f0[1] * f1[1] < 0.87) continue; // zakręt: tu nie ma jednego kierunku, przejdzie go łuk
      const f = unit(a, b); const left = lefts.some((at) => at >= along[i] && at - along[i] < 250);
      T[i] = target(p[i], f[0], f[1], K, axes, prev, left);
    }
    // odcinki na jezdni wygładzamy osobno, żeby przeskok między osiami nie ciągnął toru w bok
    for (let i = 0; i < n;) {
      if (!T[i]) { i++; continue; }
      let e = i; while (e + 1 < n && T[e + 1]) e++;
      const run = smooth(smooth(T.slice(i, e + 1), 6), 6);
      for (let j = i; j <= e; j++) T[j] = run[j - i];
      i = e + 1;
    }
    const LONG = 40; // ponad 100 m bez jezdni: to nie skrzyżowanie, tylko miejsce bez danych, więc wracamy na trasę
    let last = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && !T[i]) continue;
      const gap = i - last;
      if (gap > 1) {
        if (last >= 0 && i < n && gap <= LONG) arc(T, last, i);
        else {
          const a = last >= 0 ? [T[last][0] - p[last][0], T[last][1] - p[last][1]] : [0, 0]; const b = i < n ? [T[i][0] - p[i][0], T[i][1] - p[i][1]] : [0, 0];
          for (let j = last + 1; j < i; j++) { const u = (j - last) / gap; const f = Math.max(0, 1 - Math.min(j - last, i - j) / 20); const g = gap > LONG || last < 0 || i >= n ? f : 1; T[j] = [p[j][0] + (a[0] + (b[0] - a[0]) * u) * g, p[j][1] + (a[1] + (b[1] - a[1]) * u) * g]; }
        }
      }
      last = i;
    }
    pts = T;
  }
  return { pts: smooth(pts, axes ? 3 : 5), along };
}

/** Przecznice na torze: po jednej na ulicę, z nazwą z BDOT. */
export function crossings(path, K, axes) {
  if (!axes) return [];
  const { pts, along } = path; const out = [];
  for (let i = 4; i < pts.length - 4; i += 4) {
    const f = unit(pts[i - 4], pts[i + 4]); let own = ''; const hit = [];
    for (const s of axes.near(pts[i][0], pts[i][1])) {
      const ex = s.bx - s.ax; const ey = s.by - s.ay; const l2 = ex * ex + ey * ey; if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((pts[i][0] - s.ax) * ex + (pts[i][1] - s.ay) * ey) / l2));
      if (Math.hypot(s.ax + ex * t - pts[i][0], s.ay + ey * t - pts[i][1]) / K > s.w / 2 + 3) continue;
      if (Math.abs(ex * f[0] + ey * f[1]) / Math.sqrt(l2) > 0.8) own = own || s.name; else if (s.name && Math.abs(ex * f[0] + ey * f[1]) / Math.sqrt(l2) < 0.5) hit.push(s.name);
    }
    for (const name of hit) {
      if (name === own || out.some((c) => c.name === name && along[i] - c.at < 200)) continue;
      out.push({ at: along[i], name, x: pts[i][0], y: pts[i][1] });
    }
  }
  return out;
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
