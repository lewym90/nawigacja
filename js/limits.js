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
    const last = out[out.length - 1];
    if (last && last.kmh === kmh) last.to = off + len;
    else out.push({ from: off, to: off + len, kmh });
    off += len;
  }
  return out;
}

async function fetchChunk(base, coords, chunkLen, signal) {
  const body = {
    shape: coords.map(([lng, lat]) => ({ lat, lon: lng })),
    costing: 'auto',
    shape_match: 'map_snap',
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
