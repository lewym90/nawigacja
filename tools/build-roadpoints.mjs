// Buduje data/roadpoints.osm.json: przejazdy kolejowe, progi zwalniające i szkoły z OpenStreetMap dla całej Polski.
// Uruchamiane razem z danymi o fotoradarach (.github/workflows/hazards.yml), bo tylko tam jest dostęp do Overpass.
// Zasada bezpieczeństwa: nieudane pobranie NIE nadpisuje poprzedniego pliku.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoadPoints, packRoadPoints, ROADPOINTS_QUERY } from '../js/roadwise.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'roadpoints.osm.json');
const UA = 'nawigacja-hazards-builder (github.com/lewym90/nawigacja)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inPoland = (p) => p.lat > 48.9 && p.lat < 55.0 && p.lng > 14.0 && p.lng < 24.3;

let lastErr = null;
for (let round = 0; round < 3; round++) {
  for (const url of OVERPASS) {
    try {
      console.log(`punkty drogowe: pytam ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: new URLSearchParams({ data: ROADPOINTS_QUERY }),
        signal: AbortSignal.timeout(330000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pts = parseRoadPoints(await res.json()).filter(inPoland);
      const c = pts.reduce((a, p) => ({ ...a, [p.k]: (a[p.k] || 0) + 1 }), {});
      console.log('punkty drogowe:', JSON.stringify(c));
      // sanity: Polska ma tysiące przejazdów, progów i szkół; mniej oznacza błędną odpowiedź
      if ((c.rail || 0) < 1000 || (c.bump || 0) < 1000 || (c.school || 0) < 3000) throw new Error('podejrzanie mało danych');
      fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), counts: c, ...packRoadPoints(pts) }));
      console.log(`zapisano ${OUT}`);
      process.exit(0);
    } catch (e) {
      lastErr = e;
      console.warn(`punkty drogowe: ${url}: ${e.message}`);
    }
  }
  await sleep(20000 * (round + 1));
}
console.error('Nie udało się pobrać punktów drogowych; poprzedni plik zostaje.', lastErr && lastErr.message);
process.exit(1);
