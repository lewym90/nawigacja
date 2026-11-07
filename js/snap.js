// Tor jazdy: jedna linia dla auta, kamery i wstęgi, dopasowana do prawdziwych jezdni z BDOT10k.
// Trasa z Valhalli biegnie po osiach OSM, a jezdnie narysowane w silniku pochodzą z BDOT i potrafią leżeć kilka metrów obok.

const CELL = 40;
const STEP = 2.5;

export class AxisIndex {
  /** lines: [{ pts: [[x, y], ...], w, two }] w metrach Merkatora. */
  constructor(lines) {
    this.cells = new Map(); this.nodes = []; this.grid = new Map();
    lines.forEach((l, id) => {
      let prev = null;
      for (const q of l.pts) { const n = this.node(q); if (prev && prev !== n) { const d = Math.hypot(n.x - prev.x, n.y - prev.y); prev.out.push({ to: n, d, w: l.w, two: l.two }); n.out.push({ to: prev, d, w: l.w, two: l.two }); } prev = n; }
      for (let i = 1; i < l.pts.length; i++) {
        const [ax, ay] = l.pts[i - 1]; const [bx, by] = l.pts[i]; const seg = { ax, ay, bx, by, w: l.w, two: l.two, name: l.name, id, na: this.node(l.pts[i - 1]), nb: this.node(l.pts[i]) };
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

  /** Punkty osi w grafie: końce odcinków leżące do 2,5 m od siebie to jeden węzeł. */
  node([x, y]) {
    const cx = Math.floor(x / 3); const cy = Math.floor(y / 3);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of this.grid.get((cx + i) * 1000003 + cy + j) || []) if (Math.hypot(n.x - x, n.y - y) < 2.5) return n;
    const n = { x, y, out: [] }; const k = cx * 1000003 + cy;
    this.nodes.push(n); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(n);
    return n;
  }

  /** Węzły w promieniu r metrów Merkatora. */
  nodesNear(x, y, r) {
    const c = Math.ceil(r / 3); const cx = Math.floor(x / 3); const cy = Math.floor(y / 3); const out = [];
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) for (const n of this.grid.get((cx + i) * 1000003 + cy + j) || []) if (Math.hypot(n.x - x, n.y - y) <= r) out.push(n);
    return out;
  }

  /** Najkrótsza droga po osiach z okolic punktu a do okolic b. Prosty Dijkstra: pytamy o kilkaset węzłów na skrzyżowanie. */
  route(a, b, r, limit) {
    const dist = new Map(); const from = new Map(); const open = new Set(); const goal = new Set(this.nodesNear(b[0], b[1], r));
    for (const n of this.nodesNear(a[0], a[1], r)) { dist.set(n, 3 * Math.hypot(n.x - a[0], n.y - a[1])); open.add(n); } // dojście z boku słono kosztuje: zaczynamy na tej osi, po której jedziemy
    let best = null; let bestCost = Infinity;
    while (open.size) {
      let n = null; let d = Infinity; for (const q of open) if (dist.get(q) < d) { d = dist.get(q); n = q; }
      open.delete(n); if (d > limit || d >= bestCost) break;
      if (goal.has(n)) { const c = d + 3 * Math.hypot(n.x - b[0], n.y - b[1]); if (c < bestCost) { bestCost = c; best = n; } }
      for (const e of n.out) { const v = d + e.d; if (v < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, v); from.set(e.to, { n, e }); open.add(e.to); } }
    }
    if (!best) return null;
    const chain = []; for (let n = best; n; n = from.get(n)?.n) chain.unshift({ n, e: from.get(n)?.e });
    return chain;
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

/** Przejazd przez skrzyżowanie po prawdziwych osiach: jezdnia powstała z tych osi, więc tor nie może wejść na chodnik ani wyspę, a zjazd łącznicą wypada na łącznicy. */
function followAxes(T, a, b, K, axes, left) {
  const chord = Math.hypot(T[b][0] - T[a][0], T[b][1] - T[a][1]);
  const chain = axes.route(T[a], T[b], 14 * K, chord * 1.7); if (!chain || chain.length < 2) return false;
  const line = [T[a]];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i].n; const p0 = chain[Math.max(0, i - 1)].n; const p1 = chain[Math.min(chain.length - 1, i + 1)].n; const f = unit([p0.x, p0.y], [p1.x, p1.y]);
    const e = chain[i].e || chain[i + 1]?.e; const off = (e ? laneOffset(e.w, e.two, left) : 0) * K;
    line.push([n.x + f[1] * off, n.y - f[0] * off]);
  }
  line.push(T[b]);
  // pierwszy i ostatni węzeł mogą leżeć za końcami odcinka: odrzucamy zawrotki
  const clean = [line[0]];
  for (let i = 1; i < line.length; i++) { const u = unit(clean[clean.length - 1], line[i]); const g = unit(line[i], line[Math.min(line.length - 1, i + 1)]); if (i < line.length - 1 && i < 3 && u[0] * g[0] + u[1] * g[1] < -0.2) continue; clean.push(line[i]); }
  const cum = [0]; for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  let k = 1;
  for (let j = a + 1; j < b; j++) {
    const d = (cum[cum.length - 1] * (j - a)) / (b - a); while (k < clean.length - 1 && cum[k] < d) k++;
    const u = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
    T[j] = [clean[k - 1][0] + (clean[k][0] - clean[k - 1][0]) * u, clean[k - 1][1] + (clean[k][1] - clean[k - 1][1]) * u];
  }
  return true;
}

/** Ostatnie słowo: każdy punkt toru musi leżeć na jezdni, co najmniej metr od krawężnika. Gdy wypada poza najbliższą jezdnię, przesuwamy go w jej stronę.
 *  Jezdnie na mapie są zbudowane z tych samych osi i szerokości, więc auto nie może już jechać po trawniku. Miejsca bez danych (dalej niż 20 m od osi) zostają bez zmian. */
export const EDGE = 1.6; // metry od krawężnika do środka toru: pół wstęgi (1,1 m) i zapas

/** Jak daleko za krawędzią najbliższej jezdni leży punkt (ujemne: na jezdni) i która to jezdnia. */
function nearestRoad(p, K, axes) {
  let best = null; let bv = Infinity;
  for (const s of axes.near(p[0], p[1])) {
    const ex = s.bx - s.ax; const ey = s.by - s.ay; const l2 = ex * ex + ey * ey; if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - s.ax) * ex + (p[1] - s.ay) * ey) / l2));
    const qx = s.ax + ex * t; const qy = s.ay + ey * t; const d = Math.hypot(p[0] - qx, p[1] - qy) / K; const v = d - s.w / 2;
    if (v < bv) { bv = v; best = { qx, qy, d, w: s.w, v }; }
  }
  return best;
}

export function contain(pts, K, axes, margin = EDGE) {
  return pts.map((p) => {
    const best = nearestRoad(p, K, axes);
    // dalej niż 4 m za krawędzią to już inna ulica: trasa jedzie drogą, której nie ma w BDOT, i dostaje własny kawałek jezdni (roadFill)
    if (!best || best.v > 4 || best.v <= -margin + 0.05) return p;
    const lim = Math.max(0, best.w / 2 - margin); const f = best.d ? lim / best.d : 0;
    return [best.qx + (p[0] - best.qx) * f, best.qy + (p[1] - best.qy) * f];
  });
}

/** Odcinki toru (w metrach trasy), pod którymi nie ma narysowanej jezdni: tam silnik kładzie własny asfalt, żeby auto nie jechało po trawie. */
export function roadFill(path, K, axes, margin = EDGE) {
  if (!axes) return [];
  const { pts, along } = path; const runs = [];
  const raw = path.raw || pts; // asfalt tylko tam, gdzie samej trasy nie ma na jezdni BDOT; błąd toru ma wyjść w teście, nie zostać zamalowany
  const missing = (i) => { const r = nearestRoad(raw[Math.min(raw.length - 1, i)], K, axes); return !r || r.v > 0.5; };
  // 0,1 m zapasu: obrys jezdni na mapie jest uproszczony inaczej niż osie
  const ok = (p) => { const r = nearestRoad(p, K, axes); return r && r.v <= -margin - 0.1; };
  for (let i = 0; i < pts.length; i++) {
    // sprawdzamy też drogę do następnego punktu: przeskok między jezdniami potrafi przeciąć pas trawy
    const q = pts[Math.min(pts.length - 1, i + 1)]; const p = pts[i];
    if ([0, 0.25, 0.5, 0.75].every((u) => ok([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]))) continue;
    if (!missing(i) && !missing(i + 1) && !missing(i - 1 < 0 ? 0 : i - 1)) continue;
    const a = along[i] - 6; const e = along[i] + 6; const last = runs[runs.length - 1];
    if (last && a <= last[1]) last[1] = e; else runs.push([a, e]);
  }
  return runs;
}

const ANCHOR = 20; // m: co tyle punkt trasy przypinamy do jezdni

/** Najbliższy odcinek osi zgodny z kierunkiem jazdy. */
function snapSeg(p, f, K, axes) {
  let best = null; let bs = Infinity;
  for (const s of axes.near(p[0], p[1])) {
    const ex = s.bx - s.ax; const ey = s.by - s.ay; const l2 = ex * ex + ey * ey; if (!l2) continue;
    const c = Math.abs(ex * f[0] + ey * f[1]) / Math.sqrt(l2); if (c < 0.7) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - s.ax) * ex + (p[1] - s.ay) * ey) / l2));
    const q = [s.ax + ex * t, s.ay + ey * t]; const d = Math.hypot(q[0] - p[0], q[1] - p[1]) / K;
    if (d > s.w / 2 + 6) continue;
    const score = d + 8 * (1 - c);
    if (score < bs) { bs = score; best = { s, q }; }
  }
  return best;
}

/** Droga po osiach od punktu na odcinku A do punktu na odcinku B (najkrótsza, po grafie jezdni). */
function between(A, B, limit) {
  if (A.s === B.s) return [A.q, B.q];
  const dist = new Map(); const from = new Map(); const open = new Set();
  const start = (n, q) => { const d = Math.hypot(n.x - q[0], n.y - q[1]); if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); open.add(n); } };
  start(A.s.na, A.q); start(A.s.nb, A.q);
  const goal = new Map([[B.s.na, Math.hypot(B.s.na.x - B.q[0], B.s.na.y - B.q[1])], [B.s.nb, Math.hypot(B.s.nb.x - B.q[0], B.s.nb.y - B.q[1])]]);
  let best = null; let bc = Infinity;
  while (open.size) {
    let n = null; let d = Infinity; for (const q of open) if (dist.get(q) < d) { d = dist.get(q); n = q; }
    open.delete(n); if (d > limit || d >= bc) break;
    if (goal.has(n) && d + goal.get(n) < bc) { bc = d + goal.get(n); best = n; }
    for (const e of n.out) { const v = d + e.d; if (v < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, v); from.set(e.to, n); open.add(e.to); } }
  }
  if (!best) return null;
  const chain = []; for (let n = best; n; n = from.get(n)) chain.unshift([n.x, n.y]);
  return [A.q, ...chain, B.q];
}

const plen = (l) => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };

/** Zaokrąglenie narożników łamanej łukiem o promieniu do r (metry Merkatora), bez ścinania dalej niż r od wierzchołka. */
function fillet(l, r) {
  const out = [l[0]];
  for (let i = 1; i < l.length - 1; i++) {
    const a = l[i - 1]; const b = l[i]; const c = l[i + 1];
    const u = unit(a, b); const v = unit(b, c); const cos = u[0] * v[0] + u[1] * v[1];
    if (cos > 0.97) { out.push(b); continue; }
    const k = Math.min(r, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.45, Math.hypot(c[0] - b[0], c[1] - b[1]) * 0.45);
    const P = [b[0] - u[0] * k, b[1] - u[1] * k]; const Q = [b[0] + v[0] * k, b[1] + v[1] * k];
    for (let j = 0; j <= 6; j++) { const t = j / 6; const w = 1 - t; out.push([w * w * P[0] + 2 * t * w * b[0] + t * t * Q[0], w * w * P[1] + 2 * t * w * b[1] + t * t * Q[1]]); }
  }
  out.push(l[l.length - 1]);
  return out;
}

/** Przesunięcie łamanej w prawo (jazda prawostronna) o off(i) metrów Merkatora. */
function offsetRight(l, off) {
  return l.map((p, i) => {
    const a = l[Math.max(0, i - 1)]; const b = l[Math.min(l.length - 1, i + 1)]; const f = unit(a, b); const o = off[i];
    return [p[0] + f[1] * o, p[1] - f[0] * o];
  });
}

/** Tor dopasowany do sieci jezdni BDOT: od kotwicy do kotwicy (co ANCHOR m) najkrótszą drogą po osiach, prawym pasem.
 *  Gdzie trasa jedzie drogą, której w BDOT nie ma, zostaje linia trasy (i dostaje własny asfalt). Długości z trasy zostają. */
export function matchPath(raw, K, axes) {
  const { p, along } = resample(raw, K); const n = p.length; const total = along[n - 1];
  const step = Math.max(1, Math.round(ANCHOR / STEP)); const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const anchors = idx.map((i) => { const f = unit(p[Math.max(0, i - 4)], p[Math.min(n - 1, i + 4)]); return { i, s: along[i], m: snapSeg(p[i], f, K, axes) }; });
  // łamana z wagą: punkty, szerokości, czy dwukierunkowa, i dla kotwic ich odległość wzdłuż trasy
  const line = []; const lw = []; const tags = []; const onRoad = new Array(n).fill(false);
  const push = (q, w, two) => { line.push(q); lw.push([w, two]); };
  for (let k = 0; k < anchors.length - 1; k++) {
    const A = anchors[k]; const B = anchors[k + 1]; const rl = B.s - A.s;
    let piece = null;
    if (A.m && B.m) {
      const c = between(A.m, B.m, (rl * 2 + 30) * K);
      if (c && plen(c) / K <= rl * 1.6 + 12) piece = c;
    }
    tags.push([line.length, A.s]);
    if (piece) {
      for (let j = A.i; j < B.i; j++) onRoad[j] = true;
      const w = Math.min(A.m.s.w, B.m.s.w); const two = A.m.s.two && B.m.s.two;
      for (const q of piece.slice(0, -1)) push(q, w, two);
    } else for (let j = A.i; j < B.i; j++) push(p[j], 0, false);
  }
  tags.push([line.length, total]); push(anchors[anchors.length - 1].m ? anchors[anchors.length - 1].m.q : p[n - 1], 0, false);
  // usuwamy powtórzone punkty (koniec jednego kawałka to początek następnego)
  const L = []; const W = []; const map = new Map();
  for (let i = 0; i < line.length; i++) {
    if (L.length && Math.hypot(line[i][0] - L[L.length - 1][0], line[i][1] - L[L.length - 1][1]) < 0.05 * K) { map.set(i, L.length - 1); continue; }
    map.set(i, L.length); L.push(line[i]); W.push(lw[i]);
  }
  map.set(line.length, L.length - 1);
  const off = W.map(([w, two]) => laneOffset(w, two, false) * K);
  const sh = offsetRight(L, off);
  // tor przez kotwice: długości trasy przypisane do kotwic, między nimi proporcjonalnie do długości toru
  const cum = [0]; for (let i = 1; i < sh.length; i++) cum.push(cum[i - 1] + Math.hypot(sh[i][0] - sh[i - 1][0], sh[i][1] - sh[i - 1][1]));
  const knots = tags.map(([li, s]) => [cum[map.get(li)], s]).filter((k, i, a) => i === 0 || k[0] > a[i - 1][0]);
  const R = fillet(sh, 7 * K); const cr = [0]; for (let i = 1; i < R.length; i++) cr.push(cr[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]));
  const scale = cr[cr.length - 1] / (cum[cum.length - 1] || 1);
  const arcFor = (s) => { let k = 1; while (k < knots.length - 1 && knots[k][1] < s) k++; const [a0, s0] = knots[k - 1]; const [a1, s1] = knots[k]; return (a0 + (a1 - a0) * Math.max(0, Math.min(1, (s - s0) / ((s1 - s0) || 1)))) * scale; };
  const at = (d) => { let lo = 0; let hi = R.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cr[m] <= d) lo = m; else hi = m; } const u = (d - cr[lo]) / ((cr[hi] - cr[lo]) || 1); return [R[lo][0] + (R[hi][0] - R[lo][0]) * u, R[lo][1] + (R[hi][1] - R[lo][1]) * u]; };
  return { pts: along.map((s) => at(arcFor(s))), along, onRoad };
}

/** Zwraca tor: punkty w metrach Merkatora i odległość wzdłuż trasy dla każdego z nich. Długości zostają z trasy, więc postęp i dystanse się nie rozjeżdżają.
 *  lefts: miejsca (metry trasy) skrętów w lewo, przed którymi tor przechodzi na lewy pas. */
export function drivePath(raw, K = 1, axes = null, { lefts = [], turns = [], legacy = false } = {}) {
  if (axes && !legacy) {
    const m = matchPath(raw, K, axes);
    return { pts: contain(smooth(m.pts, 1), K, axes), along: m.along, raw: resample(raw, K).p };
  }
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
    // na początku i końcu trasy trzymamy przesunięcie z najbliższej jezdni
    const LONG = 40; // ponad 100 m bez jezdni: to nie skrzyżowanie, tylko miejsce bez danych, więc wracamy na trasę
    let last = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && !T[i]) continue;
      const gap = i - last;
      if (gap > 1) {
        if (last >= 0 && i < n && gap <= LONG) arc(T, last, i);
        else {
          const a = last >= 0 ? [T[last][0] - p[last][0], T[last][1] - p[last][1]] : i < n ? [T[i][0] - p[i][0], T[i][1] - p[i][1]] : [0, 0]; const b = i < n ? [T[i][0] - p[i][0], T[i][1] - p[i][1]] : a;
          for (let j = last + 1; j < i; j++) { const u = (j - last) / gap; const f = Math.max(0, 1 - Math.min(j - last, i - j) / 20); const g = gap > LONG && last >= 0 && i < n ? f : 1; T[j] = [p[j][0] + (a[0] + (b[0] - a[0]) * u) * g, p[j][1] + (a[1] + (b[1] - a[1]) * u) * g]; }
        }
      }
      last = i;
    }
    for (const at of turns) {
      const c = along.findIndex((v) => v >= at); if (c < 0) continue;
      const a = Math.max(0, c - 18); const b = Math.min(n - 1, c + 18); // ok. 45 m w obie strony
      if (a < b) followAxes(T, a, b, K, axes, lefts.includes(at));
    }
    pts = T;
  }
  if (!axes) return { pts: smooth(pts, 5), along };
  return { pts: contain(smooth(contain(pts, K, axes), 2), K, axes), along };
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
