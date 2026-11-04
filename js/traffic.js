// Ruch drogowy: czas przejazdu i korki na NASZEJ trasie (usługa server/nav-traffic.py, dane TomTom).
// Gdy usługa nie działa, nawigacja jedzie dalej na czasach z Valhalli: ruch jest dodatkiem, nigdy warunkiem.

import { CONFIG } from './config.js';
import { sliceLine } from './geo.js';

let online = null;
export async function trafficReady() {
  if (online !== null) return online;
  if (!CONFIG.trafficUrl) return (online = false);
  try { const r = await fetch(`${CONFIG.trafficUrl}/health`); online = r.ok && (await r.json()).key === true; } catch { online = false; }
  return online;
}

/** Punkty trasy do zapytania: od `from` metrów do końca. */
export function routePoints(line, from = 0) {
  const pts = sliceLine(line, from, line.total);
  return pts.length > 400 ? pts.filter((_, i) => i % Math.ceil(pts.length / 400) === 0 || i === pts.length - 1) : pts;
}

export async function fetchTraffic(points, { depart = null, client = 'app', signal } = {}) {
  if (!(await trafficReady())) return null;
  try {
    const r = await fetch(`${CONFIG.trafficUrl}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points, depart, client }), signal });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.time ? d : null;
  } catch { return null; }
}

/** Korki w metrach odległości do NASZEJ linii: skala, bo długości obu linii minimalnie się różnią. */
export function jamsOnLine(traffic, line, from = 0) {
  const span = line.total - from;
  const k = traffic.length ? span / traffic.length : 1;
  // skala TomTom: 1 mały, 2 średni, 3 duży; 4 = „nieokreślony”, czyli zwykle roboty lub zamknięcie, nie korek
  return (traffic.jams || []).filter((j) => (j.mag >= 1 && j.mag <= 3) || j.kind === 'ROAD_CLOSURE' || j.kind === 'ROAD_WORK').map((j) => ({ ...j, from: from + j.from * k, to: from + j.to * k }));
}

/** Warstwa mapy: bursztyn = ruch utrudniony, czerwień = stoi, ciemna czerwień = zamknięte. */
export function jamFeatures(jams, line) {
  return jams.map((j) => ({ type: 'Feature', properties: { sev: j.kind === 'ROAD_CLOSURE' ? 3 : j.mag === 3 ? 2 : 1 }, geometry: { type: 'LineString', coordinates: sliceLine(line, j.from, j.to) } }));
}

/** Czy warto proponować zmianę: oszczędność co najmniej 3 minuty i 8% pozostałego czasu. */
export function worthSwitch(now, alt) {
  const save = now - alt;
  return save >= Math.max(180, now * 0.08) ? Math.round(save) : 0;
}

/** Najbliższy prawdziwy korek: roboty bez opóźnienia nie są powodem do komunikatu. */
export function nextJam(jams, along) {
  return jams.find((j) => j.to > along && j.mag >= 2 && j.mag <= 3) || null;
}

export function departAt(minutes, now = new Date()) {
  if (!minutes) return null;
  const d = new Date(now.getTime() + minutes * 60000);
  const off = -d.getTimezoneOffset(); const p = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}
