// Bryły nawigacji: wstęga z grubością, grotem na każdym skręcie i znacznik auta.
// Tylko geometria (bez WebGL), żeby dało się ją sprawdzić testami.
// Wierzchołek: środek [x, y], oś boczna [nx, ny], przesunięcie [w bok, w górę], normalna [x, y, z], odległość wzdłuż trasy, położenie w poprzek (-1..1), wierzch (0..1), przesunięcie i normalna przed postawieniem grotu (do animacji podnoszenia).

export const RIB = { hw: 1.3, h: 0.3, r: 0.1, exit: 16, head: 5.5, headW: 2.5, gap: 7, twist: 7 };
const STRIDE = 17;

function sampler(path) {
  const { pts, along } = path; const n = pts.length;
  // kierunek z ok. 15 m, bo z sąsiednich punktów boki wstęgi falowały
  return (s) => {
    let lo = 0; let hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (along[m] <= s) lo = m; else hi = m; }
    const u = Math.max(0, Math.min(1, (s - along[lo]) / ((along[hi] - along[lo]) || 1)));
    const a = pts[Math.max(0, lo - 3)]; const b = pts[Math.min(n - 1, hi + 3)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { c: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u], t: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
  };
}

/** Przekrój: boki pionowe, zaokrąglone górne krawędzie. [w bok, w górę, normalna w bok, normalna w górę] dla połowy szerokości w. */
function profile(w, h, r) {
  const out = [[-w, 0, -1, 0]];
  for (const deg of [0, 30, 60, 90]) { const a = (deg * Math.PI) / 180; out.push([-w + r * (1 - Math.cos(a)), h - r + r * Math.sin(a), -Math.cos(a), Math.sin(a)]); }
  for (const p of out.slice().reverse()) out.push([-p[0], p[1], -p[2], p[3]]);
  return out; // 10 punktów
}

/** Odcinki wstęgi: każdy kończy się grotem tuż za skrętem, następny zaczyna się chwilę dalej. */
export function segments(total, turns, o = RIB) {
  const out = []; let start = 0;
  for (const at of [...turns].sort((a, b) => a - b)) {
    const end = at + o.exit; if (end <= start + 1 || end > total) continue;
    out.push({ a: start, b: end, head: true }); start = end + o.gap;
  }
  if (start < total - 1) out.push({ a: start, b: total, head: false });
  return out;
}

/** Wstęga jako bryła. style: 'flat' grot leży na drodze, 'up' wstęga staje na krawędzi i grot stoi pionowo. */
/** Na prostych i łagodnych łukach wygładzamy oś mocniej: kilkucentymetrowe drgania toru dawały falujące, świecące brzegi. Na zakrętach zostaje dokładny tor. */
function calm(path) {
  const { pts } = path; const n = pts.length; const R = 5;
  const dir = (i, j) => Math.atan2(pts[j][1] - pts[i][1], pts[j][0] - pts[i][0]);
  return {
    ...path,
    pts: pts.map((p, i) => {
      if (i < R || i >= n - R) return p;
      let d = Math.abs(dir(i - R, i) - dir(i, i + R)); if (d > Math.PI) d = 2 * Math.PI - d;
      const k = Math.max(0, 1 - d / 0.3); if (!k) return p; // powyżej ok. 17° na 25 m: zakręt
      let x = 0; let y = 0; for (let j = i - R; j <= i + R; j++) { x += pts[j][0]; y += pts[j][1]; }
      x /= 2 * R + 1; y /= 2 * R + 1;
      return [p[0] + (x - p[0]) * k, p[1] + (y - p[1]) * k];
    }),
  };
}

export function ribbonMesh(path, turns, { style = 'flat', o = RIB } = {}) {
  // współrzędne względem początku: w 32 bitach pełne metry Merkatora mają krok ok. 25 cm i brzegi wstęgi falowały
  const K = path.K || 1; const at = sampler(calm(path)); const org = path.pts[0]; const total = path.along[path.along.length - 1];
  const V = []; const I = []; const U = []; const UI = [];
  const lift = o.headW;
  const vert = (c, n, a, z, nrm, l, u, top, a0 = a, z0 = z, n0 = nrm) => { V.push(c[0] - org[0], c[1] - org[1], n[0], n[1], a * K, z * K, nrm[0], nrm[1], nrm[2], l, u, top, a0 * K, z0 * K, n0[0], n0[1], n0[2]); return V.length / STRIDE - 1; };

  // pierścień przekroju; normalna 'back' to ściana zwrócona do tyłu (ramiona grotu, początek odcinka)
  const ring = (s, w, theta, mode = 'side', taper = 0) => {
    const { c, t } = at(s); const n = [-t[1], t[0]]; const cs = Math.cos(theta); const sn = Math.sin(theta); const first = V.length / STRIDE;
    for (const [a, z, na, nz] of profile(w, o.h, Math.min(o.r, w))) {
      const a2 = a * cs - z * sn; const z2 = a * sn + z * cs + lift * sn;
      const nr = (c2, s2) => {
        if (mode === 'back') return [-t[0], -t[1], 0];
        const na2 = na * c2 - nz * s2; const nz2 = na * s2 + nz * c2; const f = Math.abs(na2) * taper; // boki grotu patrzą trochę do przodu
        const v = [n[0] * na2 + t[0] * f, n[1] * na2 + t[1] * f, nz2]; const l = Math.hypot(...v) || 1; return v.map((x) => x / l);
      };
      vert(c, n, a2, z2, nr(cs, sn), s, w ? a / w : 0, mode === 'back' ? 0 : Math.max(0, nz), a, z, nr(1, 0)); // wierzch zostaje wierzchem także po postawieniu na krawędzi
    }
    return first;
  };
  const strip = (r0, r1) => { for (let j = 0; j < 9; j++) I.push(r0 + j, r0 + j + 1, r1 + j + 1, r0 + j, r1 + j + 1, r1 + j); };
  const cap = (r) => { for (let j = 1; j < 9; j++) I.push(r, r + j + 1, r + j); };
  const under = (s, w) => { const { c, t } = at(s); const n = [-t[1], t[0]]; const W = w + 1.4; const i = U.length / STRIDE; for (const sg of [-1, 1]) U.push(c[0] - org[0], c[1] - org[1], n[0], n[1], sg * W * K, 0.03 * K, 0, 0, 1, s, sg * W, 0, sg * W * K, 0.03 * K, 0, 0, 1); return i; };
  const underStrip = (i0, i1) => UI.push(i0, i0 + 1, i1 + 1, i0, i1 + 1, i1);

  const up = style === 'up'; const heads = [];
  const theta = (s, shaftEnd) => (up ? (Math.PI / 2) * Math.max(0, Math.min(1, (s - (shaftEnd - o.twist)) / (o.twist - 1))) : 0);
  for (const sg of segments(total, turns, o)) {
    const shaftEnd = sg.head ? Math.max(sg.a, sg.b - o.head) : sg.b;
    const ds = new Set([sg.a, shaftEnd]);
    for (const s of path.along) if (s > sg.a && s < shaftEnd) ds.add(s);
    if (up && sg.head) for (let s = shaftEnd - o.twist; s < shaftEnd; s += 0.5) if (s > sg.a) ds.add(s);
    const list = [...ds].sort((x, y) => x - y);
    let prev = ring(sg.a, sg.a > 0 ? 0.05 : o.hw, theta(sg.a, shaftEnd)); let pu = under(sg.a, o.hw); // po skrzyżowaniu wstęga wyrasta z punktu, bez ściętego końca
    if (sg.a === 0) cap(ring(0, o.hw, 0, 'back'));
    if (sg.a > 0 && sg.a + 4 < shaftEnd) { const r = ring(sg.a + 4, o.hw, theta(sg.a + 4, shaftEnd)); strip(prev, r); prev = r; }
    for (const s of list.slice(1).filter((v) => sg.a === 0 || v > sg.a + 4)) {
      const r = ring(s, o.hw, theta(s, shaftEnd)); strip(prev, r); prev = r;
      if (theta(s, shaftEnd) < 0.3) { const u = under(s, o.hw); underStrip(pu, u); pu = u; }
    }
    if (!sg.head) { cap(ring(shaftEnd, o.hw, 0, 'back')); continue; }
    heads.push(shaftEnd - o.twist);
    const th = up ? Math.PI / 2 : 0;
    const b0 = ring(shaftEnd, o.hw, th, 'back'); const b1 = ring(shaftEnd, o.headW, th, 'back'); strip(b0, b1); // ramiona grotu
    const taper = o.headW / o.head;
    const h0 = ring(shaftEnd, o.headW, th, 'side', taper); const tip = ring(sg.b, 0.04, th, 'side', taper); strip(h0, tip);
    if (!up) { const u0 = under(shaftEnd, o.headW); const u1 = under(sg.b, 0.05); underStrip(u0, u1); }
  }
  heads.sort((x, y) => x - y);
  return { org, heads, data: new Float32Array(V), index: new Uint32Array(I), under: { data: new Float32Array(U), index: new Uint32Array(UI) } };
}

/** Znacznik auta: grot z grzbietem i fazowanymi bokami, w metrach na rozmiar 1. [x, y, z, nx, ny, nz, rodzaj] (0 góra, 1 bok, 2 cień). */
export function puckMesh() {
  const P = [[0, 1], [0.62, -0.72], [0, -0.36], [-0.62, -0.72]]; const H = 0.3; const out = [];
  const tri = (a, b, c, k) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
    if (n[2] < -0.01) { n = n.map((x) => -x); [b, c] = [c, b]; }
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], k);
  };
  // góra: grzbiet od czubka do wcięcia wyżej niż skrzydła, więc dwie połowy łapią światło inaczej
  const top = [[0, 0.9, H], [0.56, -0.66, H * 0.6], [0, -0.32, H * 0.95], [-0.56, -0.66, H * 0.6]];
  tri(top[0], top[1], top[2], 0); tri(top[0], top[2], top[3], 0);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4; const a = [...P[i], 0]; const b = [...P[j], 0];
    // ściana boku skierowana na zewnątrz: kolejność ustala znak normalnej w poziomie
    const sideN = (p, q, r) => { tri(p, q, r, 1); };
    sideN(a, b, top[j]); sideN(a, top[j], top[i]);
  }
  for (const [x, y] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.3], [-1.1, -1.1], [1.1, 1.3], [-1.1, 1.3]]) out.push(x, y, 0.01, 0, 0, 1, 2);
  return new Float32Array(out);
}
