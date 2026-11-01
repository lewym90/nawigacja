// Test end-to-end: prawdziwy kod klienta (fetchValhallaRoutes) na lokalnym serwerze HTTP z Valhallą (srv.py).
// Użycie: node e2e-auto.mjs http://127.0.0.1:8765 pary.json   (pary: [[lon,lat],[lon,lat],"city|far"])
import fs from 'node:fs';
import { fetchValhallaRoutes, valhallaRequest, valhallaToOsrm, minorEdges, encodePolyline, decodePolyline } from '../../js/valhalla.js';
const [base, file] = process.argv.slice(2);
const pairs = JSON.parse(fs.readFileSync(file, 'utf8'));
const post = async (p, b) => (await fetch(`${base}/${p}`, { method: 'POST', body: JSON.stringify(b) })).json();
const minor = async (r) => {
  const ta = await post('trace_attributes', { encoded_polyline: encodePolyline(r.geometry.coordinates), costing: 'auto', shape_match: 'edge_walk', filters: { attributes: ['edge.use', 'edge.length', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' } });
  return minorEdges(ta.edges, decodePolyline(ta.shape)).meters;
};
let changed = 0, before = 0, after = 0, dKm = 0, dMin = 0, worst = 0, fail = 0; const t0 = Date.now(); const lines = [];
for (const [A, B, k] of pairs) {
  try {
    const body = valhallaRequest([A, B], { costing: 'auto', alternatives: false });
    const base0 = valhallaToOsrm(await (await fetch(`${base}/route?json=${encodeURIComponent(JSON.stringify(body))}`)).json()).routes[0];
    const r = (await fetchValhallaRoutes(base, [A, B], { costing: 'auto', alternatives: false })).routes[0];
    const m0 = await minor(base0), m1 = await minor(r);
    if (m0) before++; if (m1) after++;
    if (m1 > 0 && r.distance === base0.distance) lines.push(`ZOSTAŁO ${k} ${(base0.distance/1000).toFixed(1)} km, niechcianych m ${m0.toFixed(0)} | ${A} -> ${B}`);
    if (r.distance !== base0.distance) { changed++; dKm += (r.distance - base0.distance) / 1000; dMin += (r.duration - base0.duration) / 60; worst = Math.max(worst, r.distance / base0.distance); lines.push(`${k} ${(base0.distance/1000).toFixed(1)}→${(r.distance/1000).toFixed(1)} km, ${(base0.duration/60).toFixed(0)}→${(r.duration/60).toFixed(0)} min, niechcianych m ${m0.toFixed(0)}→${m1.toFixed(0)}`); }
  } catch (e) { fail++; lines.push('BŁĄD ' + e.message); }
}
console.log(lines.join('\n'));
console.log(`tras: ${pairs.length} | z niechcianymi odcinkami przed: ${before}, po: ${after} | zmienionych: ${changed} | suma km ${dKm.toFixed(1)}, min ${dMin.toFixed(1)}, najgorszy stosunek długości ${worst.toFixed(2)} | błędy: ${fail} | ${((Date.now()-t0)/1000).toFixed(0)} s`);
