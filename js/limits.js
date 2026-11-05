// Ograniczenia prędkości wzdłuż trasy z silnika Valhalla (trace_attributes) na danych OpenStreetMap.
// Publiczna instancja jest do użytku umiarkowanego; docelowo własny serwer (CONFIG.limitsUrl).

import { sliceLine } from './geo.js';

const CHUNK_M = 25000;

/** Odpowiedź trace_attributes -> odcinki [{from,to,kmh}] względem początku fragmentu (metry). */
export function edgesToLimits(json, chunkLen) {
  const edges = (json && json.edges) || [];
  if (!edges.length) return null;
  const total = edges.reduce((s, e) => s + (e.length || 0) * 1000, 0);
  if (!(total > 0)) return null;
  const k = chunkLen / total;
  if (k < 0.8 || k > 1.25) return null; // dopasowanie do innej drogi niż trasa: nie ufamy
  const out = [];
  let off = 0;
  for (const e of edges) {
    const len = (e.length || 0) * 1000 * k;
    const kmh = typeof e.speed_limit === 'number' && e.speed_limit > 0 && e.speed_limit < 200 ? Math.round(e.speed_limit) : null;
    const local = LOCAL.has(e.road_class);
    const last = out[out.length - 1];
    if (last && last.kmh === kmh) { last.to = off + len; last.local = last.local && local; }
    else out.push({ from: off, to: off + len, kmh, local });
    off += len;
  }
  return cleanLimits(out);
}

const LOCAL = new Set(['tertiary', 'unclassified', 'residential', 'service_other']);
const SHORT_M = 120;     // krótszy skok limitu to zwykle szum danych, nie znak na drodze
const SUSPECT_M = 800;   // krótki odcinek 80+ na lokalnej drodze obok miejskiego limitu
const CITY_KMH = 60;

/**
 * Limit na ekranie musi być wiarygodny, więc:
 * 1. krótki odcinek bez limitu lub z wyższym limitem przejmuje limit poprzedni (niższy limit zostawiamy zawsze),
 * 2. krótki odcinek 80+ na drodze lokalnej obok limitu miejskiego traktujemy jak brak danych: to zwykle domyślne 90 „poza zabudową”
 *    wpisane w OSM, a nie znak. Lepiej nie pokazać nic niż pokazać 90 w mieście.
 */
export function cleanLimits(segs) {
  const out = segs.map((s) => ({ ...s }));
  const len = (s) => s.to - s.from;
  let carried = 0; // przenosimy limit najwyżej przez kilka krótkich odcinków z rzędu, potem już nie zgadujemy
  for (let i = 1; i < out.length; i++) {
    const p = out[i - 1]; const c = out[i];
    if (p.kmh && len(c) < SHORT_M && (c.kmh == null || c.kmh > p.kmh) && carried + len(c) <= SHORT_M * 3) { carried += len(c); c.kmh = p.kmh; } else carried = 0;
  }
  for (let i = 0; i < out.length; i++) {
    if (!(out[i].kmh == null || out[i].kmh >= 80)) continue;
    let j = i; let any = false; let local = true;
    while (j < out.length && (out[j].kmh == null || out[j].kmh >= 80)) { any = any || out[j].kmh != null; local = local && out[j].local; j++; }
    const run = out[j - 1].to - out[i].from;
    const before = i > 0 ? out[i - 1].kmh : null; const after = j < out.length ? out[j].kmh : null;
    const city = (before && before <= CITY_KMH) || (after && after <= CITY_KMH);
    if (any && local && city && run < SUSPECT_M) for (let k = i; k < j; k++) out[k].kmh = null;
    i = j - 1;
  }
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.kmh === s.kmh) last.to = s.to;
    else merged.push({ from: s.from, to: s.to, kmh: s.kmh });
  }
  return merged;
}

async function fetchChunk(base, coords, chunkLen, signal) {
  // edge_walk idzie dokładnie po krawędziach trasy; map_snap to zapas dla tras spoza naszego silnika
  try { const r = await traceChunk(base, coords, chunkLen, signal, 'edge_walk'); if (r) return r; } catch (e) { if (e.name === 'AbortError') throw e; }
  return traceChunk(base, coords, chunkLen, signal, 'map_snap');
}

async function traceChunk(base, coords, chunkLen, signal, match) {
  const body = {
    shape: coords.map(([lng, lat]) => ({ lat, lon: lng })),
    costing: 'auto',
    shape_match: match,
    filters: { attributes: ['edge.length', 'edge.speed_limit', 'edge.road_class'], action: 'include' },
  };
  const res = await fetch(`${base.replace(/\/$/, '')}/trace_attributes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return edgesToLimits(await res.json(), chunkLen);
}

/**
 * Wypełnia route.limits. Zwraca { ok, covered } (covered = udział trasy z znanym limitem 0..1).
 * Niepowodzenie nie jest błędem: aplikacja po prostu nie pokazuje znaku.
 */
export async function loadRouteLimits(base, route, { signal } = {}) {
  const chunks = [];
  for (let a = 0; a < route.distance; a += CHUNK_M) chunks.push([a, Math.min(route.distance, a + CHUNK_M)]);
  const results = new Array(chunks.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      const [a, b] = chunks[i];
      try {
        const coords = sliceLine(route.line, a, b).filter((p, idx, arr) => idx === 0 || p[0] !== arr[idx - 1][0] || p[1] !== arr[idx - 1][1]);
        if (coords.length < 2) continue;
        results[i] = await fetchChunk(base, coords, b - a, signal);
      } catch { /* ten fragment zostaje bez limitów */ }
    }
  };
  await Promise.all([worker(), worker()]);
  const limits = [];
  let known = 0;
  chunks.forEach(([a], i) => {
    for (const s of results[i] || []) {
      limits.push({ from: a + s.from, to: a + s.to, kmh: s.kmh });
      if (s.kmh) known += s.to - s.from;
    }
  });
  if (!limits.length) return { ok: false, covered: 0 };
  route.limits = limits;
  return { ok: true, covered: known / route.distance };
}
