// Stacje paliw na trasie z REALNYM kosztem objazdu: nie „1,2 km od trasy w linii prostej”, tylko ile minut i km
// dłużej potrwa dojazd do celu przez stację (Valhalla: macierz czasów pozycja -> stacje -> cel).
import { pointsOnRoute } from './roadwise.js';
import { ROUTE_PREFS, DEFAULT_PREF } from './valhalla.js';

export const FUEL_QUERY = `[out:json][timeout:300];
area["ISO3166-1"="PL"][admin_level=2]->.pl;
nwr(area.pl)["amenity"="fuel"];
out center tags;`;

const inPoland = (lat, lng) => lat > 48.9 && lat < 55.0 && lng > 14.0 && lng < 24.3;

/** Odpowiedź Overpass -> [{lat,lng,b:marka}] (marka: brand, potem operator, potem nazwa). */
export function parseFuel(json) {
  const out = [];
  for (const e of (json && json.elements) || []) {
    const t = e.tags || {};
    const lat = e.lat ?? (e.center && e.center.lat);
    const lng = e.lon ?? (e.center && e.center.lon);
    if (lat == null || lng == null || !inPoland(lat, lng)) continue;
    if (t.disused || t['disused:amenity'] || t.abandoned) continue;
    const b = (t.brand || t.operator || t.name || '').trim().slice(0, 40);
    const lpg = t['fuel:lpg'] === 'yes' ? 1 : 0;
    out.push({ lat, lng, b, lpg });
  }
  return out;
}

/** Zapis kompaktowy: { brands:[...], s:[[lat,lng,markaIdx,lpg]] }. */
export function packFuel(stations) {
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const brands = []; const idx = new Map();
  const s = stations.map((p) => {
    if (!idx.has(p.b)) { idx.set(p.b, brands.length); brands.push(p.b); }
    return [r5(p.lat), r5(p.lng), idx.get(p.b), p.lpg ? 1 : 0];
  });
  return { brands, s };
}
export function unpackFuel(packed) {
  const br = (packed && packed.brands) || [];
  return ((packed && packed.s) || []).map((a) => ({ k: 'fuel', lat: a[0], lng: a[1], b: br[a[2]] || '', lpg: a[3] === 1 }));
}

/**
 * Kandydaci przy trasie przed nami: do `maxOff` m od linii, nie dalej niż `maxAhead` m do przodu.
 * Dla każdego kilometra trasy zostaje najbliższa linii, a łącznie najwyżej `max` (najbliższe po drodze najpierw).
 */
export function candidatesAhead(stations, line, alongNow, { maxOff = 1500, maxAhead = 120000, max = 12 } = {}) {
  const on = pointsOnRoute(stations, line, maxOff, {});
  const byKm = new Map();
  for (const c of on) {
    if (c.along < alongNow + 100 || c.along > alongNow + maxAhead) continue; // 100 m: już mijana stacja nie jest propozycją
    const km = Math.floor(c.along / 2000);
    const cur = byKm.get(km);
    if (!cur || c.off < cur.off) byKm.set(km, c);
  }
  const list = [...byKm.values()].sort((a, b) => a.along - b.along).slice(0, max);
  return list.map((c) => {
    const st = stations.find((p) => `p:fuel:${p.lat}:${p.lng}` === c.id);
    return { ...c, lat: st.lat, lng: st.lng, brand: st.b, lpg: st.lpg };
  });
}

/** Macierz Valhalli (GET sources_to_targets). Zwraca tablicę [źródło][cel] = { time (s), distance (km) }. */
export async function matrix(base, sources, targets, { costing = 'auto', timeoutMs = 6000, pref = DEFAULT_PREF } = {}) {
  // te same preferencje co przy trasie (use_distance), żeby czasy z macierzy zgadzały się z trasą, którą jedziemy
  const body = { sources: sources.map(([lon, lat]) => ({ lat, lon })), targets: targets.map(([lon, lat]) => ({ lat, lon })), costing, costing_options: { auto: { use_distance: (ROUTE_PREFS[pref] || ROUTE_PREFS[DEFAULT_PREF]).useDistance } } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/sources_to_targets?json=${encodeURIComponent(JSON.stringify(body))}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Valhalla matrix: ${res.status}`);
    return (await res.json()).sources_to_targets;
  } finally { clearTimeout(timer); }
}

/**
 * Koszt objazdu przez każdą stację: czas(pozycja→stacja) + czas(stacja→cel) − czas(pozycja→cel), analogicznie km.
 * Zwraca stacje z `extraMin`, `extraKm`, `toMin` (czas dojazdu do stacji); odrzuca nieosiągalne.
 */
export async function fuelDetours(base, pos, dest, cands, opts = {}) {
  if (!cands.length) return [];
  const pts = cands.map((c) => [c.lng, c.lat]);
  const [m1, m2] = await Promise.all([matrix(base, [pos], [...pts, dest], opts), matrix(base, pts, [dest], opts)]);
  const direct = m1[0][pts.length];
  if (!direct || direct.time == null) return [];
  const out = [];
  cands.forEach((c, i) => {
    const a = m1[0][i]; const b = m2[i][0];
    if (!a || !b || a.time == null || b.time == null) return;
    out.push({ ...c, toMin: a.time / 60, toKm: a.distance, extraMin: Math.max(0, (a.time + b.time - direct.time) / 60), extraKm: Math.max(0, a.distance + b.distance - direct.distance) });
  });
  return out;
}

/** Ocena do wyróżnienia „najlepsza”: najmniej dodatkowych minut, przy remisie bliżej. */
export function bestStation(list) {
  return list.reduce((best, s) => (!best || s.extraMin < best.extraMin - 0.2 || (Math.abs(s.extraMin - best.extraMin) <= 0.2 && s.along < best.along) ? s : best), null);
}

export function fmtExtra(s) {
  const min = s.extraMin < 0.5 ? 'bez objazdu' : `+${Math.round(s.extraMin)} min`;
  return s.extraMin < 0.5 ? min : `${min} (+${s.extraKm.toFixed(1).replace('.', ',')} km)`;
}
