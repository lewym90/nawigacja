// Kokpit: czyste funkcje wyglądu i kamery (bez mapy i DOM), żeby dało się je testować.
// - pozycja słońca -> światło i niebo mapy
// - kolor trasy wg limitu prędkości (gradient wzdłuż linii)
// - strzałka „namalowana” na jezdni przed skrętem
// - kamera patrząca w zakręt
// - pierścień prędkościomierza

import { pointAt, sliceLine, bearing, angleDiff } from './geo.js';

const RAD = Math.PI / 180;

/** Pozycja słońca (algorytm jak w SunCalc). Zwraca { azimuth (0=N, zgodnie z zegarem), altitude (stopnie nad horyzontem) }. */
export function sunPosition(date, lat, lng) {
  const d = date.getTime() / 864e5 - 0.5 + 2440588 - 2451545;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const e = RAD * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - RAD * -lng - ra;
  const phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: ((az / RAD + 180) % 360 + 360) % 360, altitude: alt / RAD };
}

// Niebo rysuje panorama za mapą (#sky): mapa zostawia nad horyzontem przezroczystość, a dal rozpływa się w mgle.
export const SKY_CLEAR = 'rgba(0,0,0,0)';

/**
 * Światło i niebo mapy. Dzień: ciepłe światło ze strony słońca (cienie budynków), noc: zimne światło księżycowe.
 * `night` wynika z wybranego motywu, a nie ze słońca: motyw „Noc” w południe nadal jest nocny.
 */
export function atmosphere(night, date, lat, lng) {
  const sun = sunPosition(date, lat, lng);
  if (night) {
    return {
      light: { anchor: 'map', position: [1.4, 215, 55], color: '#8fa8dc', intensity: 0.2 },
      sky: { 'sky-color': SKY_CLEAR, 'horizon-color': SKY_CLEAR, 'fog-color': '#10223E', 'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.2, 'sky-horizon-blend': 0, 'atmosphere-blend': 0 },
    };
  }
  const alt = Math.max(5, Math.min(75, sun.altitude));
  const low = sun.altitude < 18; // poranek / wieczór: ciepły horyzont i dłuższe cienie
  return {
    light: { anchor: 'map', position: [1.2, sun.azimuth, 90 - alt], color: low ? '#ffd3a0' : '#fff6e8', intensity: low ? 0.5 : 0.3 },
    sky: low
      ? { 'sky-color': SKY_CLEAR, 'horizon-color': SKY_CLEAR, 'fog-color': '#F0D2B8', 'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.2, 'sky-horizon-blend': 0, 'atmosphere-blend': 0 }
      : { 'sky-color': SKY_CLEAR, 'horizon-color': SKY_CLEAR, 'fog-color': '#D7E6F1', 'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.2, 'sky-horizon-blend': 0, 'atmosphere-blend': 0 },
  };
}

// ---------- Kolor trasy wg limitu ----------
// Skala od chłodnego (wolno) do gorącego (szybko), czytelna na ciemnej i jasnej mapie.
const LIMIT_STOPS = [
  [20, '#5ef2d0'], [30, '#4fe0e6'], [50, '#4cb8ff'], [70, '#6c8cff'], [90, '#a56bff'], [110, '#e45cff'], [140, '#ff4f9a'],
];
export const ROUTE_PLAIN = { night: '#00D9FF', day: '#00D9FF' };

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(c) { return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }

/** Kolor dla limitu (km/h); null = nieznany -> kolor zwykłej trasy. Płynne przejście między punktami skali. */
export function limitColor(kmh, plain = ROUTE_PLAIN.night) {
  if (!kmh) return plain;
  if (kmh <= LIMIT_STOPS[0][0]) return LIMIT_STOPS[0][1];
  for (let i = 1; i < LIMIT_STOPS.length; i++) {
    const [k1, c1] = LIMIT_STOPS[i];
    if (kmh <= k1) {
      const [k0, c0] = LIMIT_STOPS[i - 1];
      const t = (kmh - k0) / (k1 - k0);
      const a = hexToRgb(c0); const b = hexToRgb(c1);
      return rgbToHex(a.map((v, j) => v + (b[j] - v) * t));
    }
  }
  return LIMIT_STOPS[LIMIT_STOPS.length - 1][1];
}

/**
 * Przystanki gradientu wzdłuż trasy: [[progress 0..1, kolor], ...] ściśle rosnące.
 * `consumed` (metry) – przejechany fragment jest przezroczysty, więc trasa „znika” pod kołami.
 */
export function routeGradient(route, { plain = ROUTE_PLAIN.night, colorByLimit = true, consumed = 0, shade = 1 } = {}) {
  const total = route.distance || (route.line && route.line.total) || 1;
  const EPS = 1e-6;
  const segs = [];
  const lims = colorByLimit && route.limits && route.limits.length ? route.limits : [{ from: 0, to: total, kmh: null }];
  for (const s of lims) {
    const col = s.kmh && shade < 1 ? rgbToHex(hexToRgb(limitColor(s.kmh, plain)).map((v) => v * shade)) : limitColor(s.kmh, plain);
    const last = segs[segs.length - 1];
    if (last && last.col === col) last.to = s.to;
    else segs.push({ from: s.from, to: s.to, col });
  }
  // krótkie ułamki (<120 m) wchłaniamy w poprzedni kolor: gradient nie ma setek przystanków
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.to - s.from < 120) last.to = s.to;
    else merged.push({ ...s });
  }
  if (!merged.length) merged.push({ from: 0, to: total, col: plain });
  merged[0].from = 0; merged[merged.length - 1].to = total;
  const clear = 'rgba(0,0,0,0)';
  const stops = [];
  const push = (p, c) => {
    p = Math.max(0, Math.min(1, p));
    const last = stops[stops.length - 1];
    if (last && p <= last[0]) p = Math.min(1, last[0] + EPS);
    if (last && p <= last[0]) return;
    stops.push([p, c]);
  };
  const cut = consumed > 5 ? Math.min(total, consumed) / total : 0;
  if (cut > 0) { push(0, clear); push(cut, clear); }
  merged.forEach((s, i) => {
    const a = s.from / total; const b = s.to / total;
    if (b <= cut) return;
    push(Math.max(a, cut + (cut > 0 ? EPS : 0)), s.col);
    if (i < merged.length - 1) push(b - EPS, s.col);
  });
  push(1, merged[merged.length - 1].col);
  if (stops.length < 2) stops.push([1, stops[0][1]]);
  if (stops[0][0] > 0) stops.unshift([0, stops[0][1]]);
  return stops;
}

/** Wyrażenie MapLibre `line-gradient` z przystanków. */
export function gradientExpr(stops) {
  return ['interpolate', ['linear'], ['line-progress'], ...stops.flat()];
}

// ---------- Strzałka na jezdni ----------
/**
 * Strzałka skrętu leżąca na drodze: trzon wzdłuż nadjeżdżanego odcinka i skrętu + grot na końcu.
 * Zwraca { shaft: [[lng,lat],...], head: [[lng,lat] x4] (zamknięty trójkąt) } albo null.
 */
export function maneuverArrow(line, atM, { before = 32, after = 16, headLen = 9, headHalf = 5 } = {}) {
  if (!line || !line.coords || line.coords.length < 2) return null;
  const from = Math.max(0, atM - before);
  const to = Math.min(line.total, atM + after);
  if (to - from < 15) return null;
  const shaft = sliceLine(line, from, to);
  if (shaft.length < 2) return null;
  const tip = shaft[shaft.length - 1];
  // kierunek końcówki z ostatnich ~6 m
  const back = pointAt(line, Math.max(from, to - 6)).point;
  const brg = bearing(back, tip);
  const M_LAT = 111195;
  const mLng = M_LAT * Math.cos(tip[1] * RAD);
  const off = (p, brgDeg, dist) => [p[0] + (Math.sin(brgDeg * RAD) * dist) / mLng, p[1] + (Math.cos(brgDeg * RAD) * dist) / M_LAT];
  // grot: podstawa cofnięta o headLen, szerokość 2*headHalf; trzon kończy się w podstawie grotu
  const base = off(tip, (brg + 180) % 360, headLen);
  const l = off(base, (brg + 270) % 360, headHalf);
  const r = off(base, (brg + 90) % 360, headHalf);
  const tipFar = off(tip, brg, 3);
  const trimmed = shaft.slice(0, -1).concat([base]);
  return { shaft: trimmed, head: [l, tipFar, r, l] };
}

/** Czy dla tego manewru rysujemy strzałkę (skręty, ronda, zjazdy; nie „prosto” i nie start/cel). */
export function wantsArrow(step) {
  if (!step) return false;
  const t = step.type || '';
  if (['arrive', 'depart', 'continue', 'new name', 'notification'].includes(t)) return false;
  const m = step.modifier || '';
  if (t === 'turn' && m === 'straight') return false;
  return true;
}

// ---------- Kamera ----------
/** Różnica kątów ze znakiem (-180..180): o ile trzeba obrócić `from`, by dojść do `to`. */
export function signedAngle(from, to) {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Kierunek kamery „patrzącej w zakręt”: kierunek GPS lekko przechylony ku temu, co trasa robi kilkadziesiąt
 * metrów dalej. Odchylenie ograniczone, żeby mapa nie skakała.
 */
export function lookAheadBearing(route, along, heading, { ahead = 120, maxTurn = 55, gain = 0.8 } = {}) {
  const line = route.line;
  if (!line || line.total < 30) return heading;
  const a = pointAt(line, Math.min(line.total, along + 8)).point;
  const b = pointAt(line, Math.min(line.total, along + ahead)).point;
  if (a[0] === b[0] && a[1] === b[1]) return heading;
  const want = bearing(a, b);
  const diff = signedAngle(heading, want);
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff * gain));
  return (heading + turn + 360) % 360;
}

/** Dodatkowe przybliżenie przy zbliżaniu się do skrętu, żeby strzałka na jezdni była dobrze widoczna. */
export function turnZoomBoost(distToNextM, step) {
  if (!wantsArrow(step)) return 0;
  if (distToNextM > 220) return 0;
  if (distToNextM < 25) return 0.35;
  return 0.35 * (1 - (distToNextM - 25) / 195);
}

// ---------- Pierścień prędkościomierza ----------
/** Wypełnienie 0..100 i stan ('ok' | 'near' | 'over' | 'way'). Skala: limit = 80% pierścienia. */
export function speedRing(kmh, limit) {
  const scale = limit ? limit * 1.25 : 140;
  const pct = Math.max(0, Math.min(100, (kmh / scale) * 100));
  let state = 'ok';
  if (limit) {
    if (kmh > limit + 10) state = 'way';
    else if (kmh > limit + 2) state = 'over';
    else if (kmh >= limit - 3) state = 'near';
  }
  return { pct, state, notch: limit ? 80 : null };
}

export { angleDiff };
