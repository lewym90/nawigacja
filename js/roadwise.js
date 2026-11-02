// Inteligencja drogi: ostrzeżenia, których nie ma w znakach na mapie, tylko w geometrii trasy i danych OSM.
//  - zakręty z zalecaną prędkością (liczone z kształtu trasy, nie z bazy),
//  - przejazdy kolejowe, progi zwalniające, szkoły (punkty z OpenStreetMap).
// Czyste funkcje, bez mapy i DOM.

import { pointAt, bearing, haversine } from './geo.js';
import { plNum, distWords } from './speech-pl.js';

const RAD = Math.PI / 180;
const diffAngle = (a, b) => ((b - a + 540) % 360) - 180;

// ---------- Zakręty ----------
export const CURVE = { stepM: 8, windowN: 6, minWindowDeg: 12, minTotalDeg: 30, latAccel: 2.2, junctionPadM: 35, mergeGapM: 120 };

/** Zalecana prędkość (km/h, co 5) dla łuku o promieniu R metrów: v = sqrt(a * R), a = 2,2 m/s^2 (komfortowo). */
export function adviseKmh(radiusM, a = CURVE.latAccel) {
  return Math.max(20, Math.round((3.6 * Math.sqrt(a * radiusM)) / 5) * 5);
}

/**
 * Zakręty na trasie. `steps` służą do pominięcia skrętów na skrzyżowaniach i rond (to robi prowadzenie głosowe),
 * tu zostają łuki drogi bez manewru. Zwraca [{ id, kind:'curve', along, end, dir:'left'|'right'|null, advised, angle, sharp, series }].
 */
export function findCurves(line, steps = [], opts = {}) {
  const C = { ...CURVE, ...opts };
  if (!line || !line.coords || line.total < C.stepM * (C.windowN + 2)) return [];
  const pts = [];
  for (let a = 0; a <= line.total; a += C.stepM) pts.push(pointAt(line, a).point);
  if (pts.length < C.windowN + 3) return [];
  const hd = [];
  for (let i = 1; i < pts.length; i++) hd.push(bearing(pts[i - 1], pts[i]));
  const turn = [0];
  for (let i = 1; i < hd.length; i++) turn.push(diffAngle(hd[i - 1], hd[i])); // turn[i]: zmiana kierunku na wierzchołku i
  // okno: suma zmian kierunku na odcinku windowN*stepM
  const W = C.windowN;
  const win = new Array(turn.length).fill(0);
  let sum = 0;
  for (let i = 0; i < turn.length; i++) {
    sum += turn[i];
    if (i >= W) sum -= turn[i - W];
    win[i] = sum; // okno kończy się w i
  }
  const raw = [];
  let cur = null;
  for (let i = W; i < win.length; i++) {
    const s = Math.sign(win[i]);
    const hit = Math.abs(win[i]) >= C.minWindowDeg;
    if (hit && cur && cur.sign === s) { cur.last = i; cur.minR = Math.min(cur.minR, (W * C.stepM) / (Math.abs(win[i]) * RAD)); }
    else if (hit) {
      if (cur) raw.push(cur);
      cur = { sign: s, first: i, last: i, minR: (W * C.stepM) / (Math.abs(win[i]) * RAD) };
    } else if (cur && i - cur.last > 2) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);

  const maneuvers = steps.filter((s) => s && s.type && !['depart', 'arrive'].includes(s.type) && s.at != null);
  let items = [];
  for (const r of raw) {
    const startIdx = Math.max(0, r.first - W); // okno zaczyna się W próbek wcześniej
    const endIdx = r.last;
    const start = startIdx * C.stepM; const end = endIdx * C.stepM;
    let total = 0;
    for (let i = startIdx + 1; i <= endIdx; i++) total += turn[i];
    const angle = Math.abs(total);
    if (angle < C.minTotalDeg) continue;
    if (maneuvers.some((m) => m.at >= start - C.junctionPadM && m.at <= end + C.junctionPadM)) continue;
    const advised = adviseKmh(r.minR);
    items.push({
      id: `c:${Math.round(start)}`, kind: 'curve', along: start, end, dir: total > 0 ? 'right' : 'left',
      advised, angle: Math.round(angle), radius: Math.round(r.minR), sharp: advised <= 45 || angle >= 100, series: false,
    });
  }
  // serie zakrętów (esy-floresy): sąsiednie łuki w przeciwnych kierunkach blisko siebie scalamy w jedno ostrzeżenie
  const merged = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && it.along - last.end < C.mergeGapM && it.dir !== last.dir) {
      last.end = it.end; last.advised = Math.min(last.advised, it.advised); last.angle += it.angle; last.series = true; last.dir = null;
      last.sharp = last.sharp || it.sharp; last.radius = Math.min(last.radius, it.radius);
    } else merged.push({ ...it });
  }
  items = merged;
  return items;
}

// ---------- Punkty z OSM ----------
export const POINT_KINDS = { rail: 'Przejazd kolejowy', bump: 'Próg zwalniający', school: 'Szkoła' };

/** Overpass (out center) -> [{ k, lat, lng, f? }]; f = cecha: 'nobarrier' dla przejazdu bez zapór. */
export function parseRoadPoints(json) {
  const out = [];
  for (const e of (json && json.elements) || []) {
    const t = e.tags || {};
    const lat = e.lat ?? (e.center && e.center.lat);
    const lng = e.lon ?? (e.center && e.center.lon);
    if (lat == null || lng == null) continue;
    if (t.railway === 'level_crossing') {
      out.push({ k: 'rail', lat, lng, f: t['crossing:barrier'] === 'no' || t.crossing === 'uncontrolled' ? 'nobarrier' : undefined });
    } else if (/^(bump|hump|table|cushion|yes)$/.test(t.traffic_calming || '')) {
      out.push({ k: 'bump', lat, lng });
    } else if (/^(school|kindergarten)$/.test(t.amenity || '')) {
      out.push({ k: 'school', lat, lng });
    }
  }
  return out;
}

export const ROADPOINTS_QUERY = `[out:json][timeout:300];
area["ISO3166-1"="PL"][admin_level=2]->.pl;
(
  node(area.pl)["railway"="level_crossing"];
  node(area.pl)["traffic_calming"~"^(bump|hump|table|cushion)$"];
  nwr(area.pl)["amenity"~"^(school|kindergarten)$"];
);
out center;`;

/** Kompaktowy zapis do pliku: { rail:[[lat,lng,f?]], bump:[[lat,lng]], school:[[lat,lng]] } (5 miejsc po przecinku). */
export function packRoadPoints(points) {
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const o = { rail: [], bump: [], school: [] };
  for (const p of points) o[p.k].push(p.f ? [r5(p.lat), r5(p.lng), p.f === 'nobarrier' ? 1 : 0] : [r5(p.lat), r5(p.lng)]);
  return o;
}
export function unpackRoadPoints(packed) {
  const out = [];
  for (const k of ['rail', 'bump', 'school']) for (const a of (packed && packed[k]) || []) out.push({ k, lat: a[0], lng: a[1], f: a[2] === 1 ? 'nobarrier' : undefined });
  return out;
}

/**
 * Punkty leżące przy trasie (maxOff m od linii) z położeniem wzdłuż trasy. Siatka segmentów zamiast pełnego
 * przeszukiwania: trasa 300 km i dziesiątki tysięcy punktów liczą się w ułamku sekundy.
 */
export function pointsOnRoute(points, line, maxOff = 25, kindOff = { school: 45 }) {
  if (!points || !points.length || !line || line.coords.length < 2) return [];
  const CELL = 0.002;
  const key = (lng, lat) => `${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`;
  const grid = new Map();
  const put = (lng, lat, i) => { const k = key(lng, lat); const a = grid.get(k); if (a) { if (a[a.length - 1] !== i) a.push(i); } else grid.set(k, [i]); };
  const c = line.coords;
  for (let i = 0; i < c.length - 1; i++) {
    const n = Math.max(1, Math.ceil(haversine(c[i], c[i + 1]) / 120));
    for (let j = 0; j <= n; j++) put(c[i][0] + ((c[i + 1][0] - c[i][0]) * j) / n, c[i][1] + ((c[i + 1][1] - c[i][1]) * j) / n, i);
  }
  const found = [];
  for (const p of points) {
    const cx = Math.floor(p.lng / CELL); const cy = Math.floor(p.lat / CELL);
    let segs = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const a = grid.get(`${cx + dx}:${cy + dy}`); if (a) segs = segs ? segs.concat(a) : a.slice(); }
    if (!segs) continue;
    const mLat = 111195; const mLng = mLat * Math.cos(p.lat * RAD);
    let best = null;
    for (const i of new Set(segs)) {
      const ax = (c[i][0] - p.lng) * mLng; const ay = (c[i][1] - p.lat) * mLat;
      const bx = (c[i + 1][0] - p.lng) * mLng; const by = (c[i + 1][1] - p.lat) * mLat;
      const dx = bx - ax; const dy = by - ay; const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (!best || d < best.d) best = { d, along: line.cum[i] + t * (line.cum[i + 1] - line.cum[i]) };
    }
    if (best && best.d <= (kindOff[p.k] ?? maxOff)) found.push({ id: `p:${p.k}:${p.lat}:${p.lng}`, kind: p.k, along: best.along, off: Math.round(best.d), f: p.f });
  }
  found.sort((a, b) => a.along - b.along);
  // dwa takie same punkty bliżej niż 40 m (np. próg opisany dwa razy) to jedno ostrzeżenie
  const out = [];
  for (const f of found) {
    const prev = [...out].reverse().find((o) => o.kind === f.kind);
    if (prev && f.along - prev.along < 40) continue;
    out.push(f);
  }
  return out;
}

/** Wszystkie pozycje do obserwowania na trasie: zakręty + punkty. */
export function buildRoadItems(route, points) {
  const items = [...findCurves(route.line, route.steps || []), ...pointsOnRoute(points, route.line)];
  items.sort((a, b) => a.along - b.along);
  return items;
}

// ---------- Opis i obserwator ----------
const DIR_PL = { left: 'w lewo', right: 'w prawo' };

/** Tytuł i podtytuł do paska ostrzeżenia oraz zdanie dla lektora. */
export function describe(item, dist) {
  if (item.kind === 'curve') {
    const name = item.series ? 'Seria zakrętów' : `${item.sharp ? 'Ostry zakręt' : 'Zakręt'} ${DIR_PL[item.dir]}`;
    return {
      title: name,
      sub: `Zalecana prędkość ${item.advised} km/h`,
      say: `${name} za ${distWords(Math.max(50, dist))}, zalecana prędkość ${plNum(item.advised)}`,
    };
  }
  if (item.kind === 'rail') {
    const nb = item.f === 'nobarrier';
    return { title: 'Przejazd kolejowy', sub: nb ? 'Bez zapór: rozejrzyj się' : 'Zwolnij i rozejrzyj się', say: `Przejazd kolejowy${nb ? ' bez zapór' : ''} za ${distWords(Math.max(50, dist))}` };
  }
  if (item.kind === 'bump') return { title: 'Próg zwalniający', sub: 'Zwolnij', say: `Próg zwalniający za ${distWords(Math.max(50, dist))}` };
  return { title: 'Szkoła', sub: 'Uważaj na dzieci przy drodze', say: `Szkoła za ${distWords(Math.max(50, dist))}, uważaj na dzieci` };
}

/**
 * Obserwator ostrzeżeń drogowych. Odzywa się tylko, gdy ma to sens:
 *  - zakręt: gdy jedziesz wyraźnie szybciej niż zalecana prędkość,
 *  - przejazd kolejowy: zawsze (to zagrożenie życia),
 *  - próg: gdy jedziesz szybciej niż ~35 km/h,
 *  - szkoła: gdy jedziesz szybciej niż ~35 km/h.
 * Pasek na ekranie pokazuje także zakręty ostre i wszystkie punkty, nawet bez zapowiedzi głosowej.
 */
export class RoadWatch {
  constructor(items, done = null) {
    this.items = items;
    this.done = done || new Set();
    this.cursor = 0;
  }

  update(along, speedMs, limit = null) {
    const kmh = speedMs * 3.6;
    while (this.cursor < this.items.length && this.items[this.cursor].along < along - 15) this.cursor++;
    const say = [];
    let ahead = null;
    for (let i = this.cursor; i < this.items.length; i++) {
      const it = this.items[i];
      const dist = it.along - along;
      if (dist > 500) break;
      if (dist < -15) continue;
      const warnAt = Math.max(150, Math.min(420, speedMs * (it.kind === 'rail' ? 11 : 8)));
      let speak = false; let show = false;
      if (it.kind === 'curve') {
        const tooFast = kmh > it.advised + 8 && !(limit && limit <= it.advised);
        speak = tooFast; show = tooFast || it.sharp;
      } else if (it.kind === 'rail') { speak = true; show = true; }
      else { speak = kmh > 35; show = true; }
      if (show && dist <= (it.kind === 'curve' || it.kind === 'rail' ? Math.max(warnAt, 200) : Math.min(warnAt, 250)) && !ahead) ahead = { ...it, dist: Math.max(0, dist), tooFast: speak };
      if (speak && dist <= warnAt && !this.done.has(it.id)) {
        this.done.add(it.id);
        say.push(describe(it, dist).say);
      }
    }
    return { ahead, say };
  }
}
