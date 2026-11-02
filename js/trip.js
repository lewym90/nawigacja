// Pamiątka z podróży: zapis śladu jazdy, statystyki, kolorowanie śladu prędkością, klatki filmowego przelotu
// i plakat do udostępnienia. Logika czysta (bez mapy i DOM), poza rysowaniem plakatu na przekazanym kontekście canvas.
import { haversine, bearing } from './geo.js';
import { limitColor } from './cockpit.js';

const RAD = Math.PI / 180;
export const TRIP = { minStepM: 12, idleMs: 20000, maxPts: 6000, storePts: 600, minDistM: 800, stopMs: 60000 };

const normAngle = (a) => ((a % 360) + 360) % 360;
const signed = (from, to) => ((to - from + 540) % 360) - 180;

export class TripRecorder {
  constructor(opts = {}) { this.o = { ...TRIP, ...opts }; this.pts = []; this.maxV = 0; }

  /** fix: { lng, lat, speed (m/s), t (ms), accuracy? }. Zła dokładność i skoki są pomijane. */
  add(fix) {
    if (!fix || fix.lng == null || fix.lat == null || (fix.accuracy != null && fix.accuracy > 60)) return false;
    const t = fix.t || Date.now();
    const v = Math.max(0, fix.speed || 0);
    if (v < 80) this.maxV = Math.max(this.maxV, v); // 80 m/s = 288 km/h: powyżej to błąd GPS
    const last = this.pts[this.pts.length - 1];
    if (last) {
      const d = haversine([last.lng, last.lat], [fix.lng, fix.lat]);
      const dt = t - last.t;
      if (dt <= 0) return false;
      if (d / (dt / 1000) > 90 && dt < 60000) return false; // teleport
      if (d < this.o.minStepM && dt < this.o.idleMs) return false;
    }
    this.pts.push({ lng: +fix.lng.toFixed(6), lat: +fix.lat.toFixed(6), t, v });
    if (this.pts.length > this.o.maxPts) this.pts = decimate(this.pts, Math.floor(this.o.maxPts * 0.75));
    return true;
  }

  summary() { return tripStats(this.pts, this.maxV); }
  toJSON() { return { pts: decimate(this.pts, this.o.storePts), maxV: this.maxV }; }
  static fromJSON(j) { const r = new TripRecorder(); r.pts = (j && j.pts) || []; r.maxV = (j && j.maxV) || 0; return r; }
}

/** Równomierne przerzedzenie do najwyżej `max` punktów (pierwszy i ostatni zostają). */
export function decimate(pts, max) {
  if (pts.length <= max) return pts.slice();
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))]);
  return out;
}

export function tripStats(pts, maxV = 0, opt = TRIP) {
  let dist = 0; let movingMs = 0; let stops = 0; let run = 0; let longest = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine([pts[i - 1].lng, pts[i - 1].lat], [pts[i].lng, pts[i].lat]);
    const dt = pts[i].t - pts[i - 1].t;
    dist += d;
    const slow = d / Math.max(dt / 1000, 0.001) < 1;
    if (slow) { run += dt; } else { movingMs += dt; if (run >= opt.stopMs) { stops++; longest = Math.max(longest, run); } run = 0; }
  }
  if (run >= opt.stopMs) { stops++; longest = Math.max(longest, run); }
  const totalMs = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
  return {
    meters: dist, totalMs, movingMs, stopMs: Math.max(0, totalMs - movingMs), stops, longestStopMs: longest,
    avgKmh: movingMs > 0 ? (dist / (movingMs / 1000)) * 3.6 : 0,
    maxKmh: Math.round(maxV * 3.6),
    points: pts.length,
  };
}

export function fmtTripTime(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Przystanki gradientu wzdłuż śladu (kolor wg prędkości, jak kolor limitu na trasie). */
export function speedStops(pts, buckets = 60) {
  if (pts.length < 2) return [[0, limitColor(0)], [1, limitColor(0)]];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine([pts[i - 1].lng, pts[i - 1].lat], [pts[i].lng, pts[i].lat]));
  const total = cum[cum.length - 1] || 1;
  const stops = [];
  for (let b = 0; b <= buckets; b++) {
    const p = b / buckets; const target = p * total;
    // prędkość z okna ±total/buckets wokół punktu (średnia po segmentach ze śladu)
    let sum = 0; let w = 0;
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] < target - total / buckets || cum[i - 1] > target + total / buckets) continue;
      const dt = (pts[i].t - pts[i - 1].t) / 1000; if (dt <= 0) continue;
      const len = cum[i] - cum[i - 1]; sum += len; w += dt;
    }
    const kmh = w > 0 ? (sum / w) * 3.6 : 0;
    const col = limitColor(Math.max(10, Math.min(140, kmh)));
    const last = stops[stops.length - 1];
    stops.push([last && p <= last[0] ? Math.min(1, last[0] + 1e-6) : p, col]);
  }
  stops[0][0] = 0; stops[stops.length - 1][0] = 1;
  return stops;
}

/**
 * Klatki filmowego przelotu: n pozycji równo co do długości śladu; kierunek kamery patrzy ~`ahead` m do przodu
 * i jest wygładzany, więc kamera płynnie wchodzi w zakręty.
 */
export function replayFrames(pts, n = 240, { ahead = 160, smooth = 0.12 } = {}) {
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine([pts[i - 1].lng, pts[i - 1].lat], [pts[i].lng, pts[i].lat]));
  const total = cum[cum.length - 1];
  if (total < 1) return [];
  const at = (d) => {
    d = Math.max(0, Math.min(total, d));
    let lo = 0; let hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo] || 1; const t = (d - cum[lo]) / seg;
    return [pts[lo].lng + (pts[hi].lng - pts[lo].lng) * t, pts[lo].lat + (pts[hi].lat - pts[lo].lat) * t];
  };
  const frames = []; let brg = null;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    const p = at(d); const q = at(d + ahead);
    const want = (p[0] === q[0] && p[1] === q[1]) ? (brg ?? 0) : bearing(p, q);
    brg = brg == null ? want : normAngle(brg + signed(brg, want) * smooth);
    frames.push({ center: p, bearing: brg, progress: d / total });
  }
  return frames;
}

/** Rzut równokątny dopasowany do prostokąta w x h z marginesem; zwraca funkcję [lng,lat] -> [x,y] i skalę. */
export function fitProjection(pts, w, h, pad = 60) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const kx = Math.cos(lat0 * RAD);
  for (const p of pts) { const x = p.lng * kx; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, p.lat); maxY = Math.max(maxY, p.lat); }
  const sx = (w - 2 * pad) / Math.max(maxX - minX, 1e-9); const sy = (h - 2 * pad) / Math.max(maxY - minY, 1e-9);
  const s = Math.min(sx, sy);
  const ox = pad + ((w - 2 * pad) - (maxX - minX) * s) / 2; const oy = pad + ((h - 2 * pad) - (maxY - minY) * s) / 2;
  return (p) => [ox + (p.lng * kx - minX) * s, oy + (maxY - p.lat) * s];
}

/** Plakat do udostępnienia (ctx: CanvasRenderingContext2D, rozmiar w x h). */
export function drawPoster(ctx, w, h, { pts, title, stats, dateText }) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#080c1a'); bg.addColorStop(1, '#1b1033');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 40; x < w; x += 60) for (let y = 40; y < h; y += 60) ctx.fillRect(x, y, 2, 2);
  const mapH = Math.round(h * 0.62); const proj = fitProjection(pts, w, mapH, 110);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const xy = pts.map(proj);
  const stops = speedStops(pts, 80);
  const colAt = (i) => stops[Math.min(stops.length - 1, Math.round((i / Math.max(1, pts.length - 1)) * (stops.length - 1)))][1];
  for (const [lw, alpha] of [[34, 0.12], [20, 0.2]]) {
    ctx.globalAlpha = alpha; ctx.lineWidth = lw;
    for (let i = 1; i < xy.length; i++) { ctx.strokeStyle = colAt(i); ctx.beginPath(); ctx.moveTo(...xy[i - 1]); ctx.lineTo(...xy[i]); ctx.stroke(); }
  }
  ctx.globalAlpha = 1; ctx.lineWidth = 9;
  for (let i = 1; i < xy.length; i++) { ctx.strokeStyle = colAt(i); ctx.beginPath(); ctx.moveTo(...xy[i - 1]); ctx.lineTo(...xy[i]); ctx.stroke(); }
  const dot = (p, c) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], 20, 0, 7); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, 7); ctx.fill(); };
  dot(xy[0], '#3ddc84'); dot(xy[xy.length - 1], '#ffcf3a');
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 64px system-ui, sans-serif'; ctx.fillText((title || 'Podróż').slice(0, 26), 70, 120);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '500 34px system-ui, sans-serif'; ctx.fillText(dateText || '', 70, 170);
  const cols = [
    [`${(stats.meters / 1000).toFixed(stats.meters < 10000 ? 1 : 0).replace('.', ',')}`, 'km'],
    [fmtTripTime(stats.totalMs), 'czas'],
    [`${Math.round(stats.avgKmh)}`, 'km/h średnio'],
    [`${stats.maxKmh}`, 'km/h maks.'],
  ];
  const cw = (w - 140) / cols.length; let y0 = mapH + 120;
  cols.forEach(([big, small], i) => {
    const x = 70 + i * cw;
    ctx.fillStyle = '#fff'; ctx.font = '800 64px system-ui, sans-serif'; ctx.fillText(big, x, y0);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '500 30px system-ui, sans-serif'; ctx.fillText(small, x, y0 + 46);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText(stats.stops ? `${stats.stops} ${stats.stops === 1 ? 'postój' : 'postoje/postojów'} · kolor trasy: wolno → szybko` : 'kolor trasy: wolno → szybko', 70, h - 70);
}

/** Gradient odsłaniający ślad do `progress` (0..1); dalej przezroczysty. */
export function revealStops(stops, progress) {
  const clear = 'rgba(0,0,0,0)';
  const p = Math.max(0.0005, Math.min(1, progress));
  const out = [];
  for (const [q, c] of stops) { if (q < p) out.push([q, c]); }
  if (!out.length) out.push([0, stops[0][1]]);
  const last = out[out.length - 1];
  const colHere = last[1];
  if (p >= 1) { out.push([1, stops[stops.length - 1][1]]); return out; }
  out.push([Math.max(p, last[0] + 1e-6), colHere]);
  out.push([Math.min(1, p + 1e-6 * 2 + 0.0005), clear]);
  out.push([1, clear]);
  for (let i = 1; i < out.length; i++) if (out[i][0] <= out[i - 1][0]) out[i][0] = Math.min(1, out[i - 1][0] + 1e-6);
  return out;
}
