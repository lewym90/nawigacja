// Buduje data/fuel.osm.json: stacje paliw z OpenStreetMap dla całej Polski (uruchamiane przez hazards.yml).
// Nieudane pobranie NIE nadpisuje poprzedniego pliku.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFuel, packFuel, FUEL_QUERY } from '../js/fuel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'fuel.osm.json');
const UA = 'nawigacja-hazards-builder (github.com/lewym90/nawigacja)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastErr = null;
for (let round = 0; round < 3; round++) {
  for (const url of OVERPASS) {
    try {
      console.log(`stacje paliw: pytam ${url}`);
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: new URLSearchParams({ data: FUEL_QUERY }), signal: AbortSignal.timeout(330000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const st = parseFuel(await res.json());
      console.log(`stacje paliw: ${st.length}`);
      if (st.length < 3000) throw new Error('podejrzanie mało stacji'); // w Polsce jest ich ponad 7 tys.
      fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), ...packFuel(st) }));
      process.exit(0);
    } catch (e) { lastErr = e; console.warn(`stacje paliw: ${url}: ${e.message}`); }
  }
  await sleep(20000 * (round + 1));
}
console.error('Nie udało się pobrać stacji paliw; poprzedni plik zostaje.', lastErr && lastErr.message);
process.exit(1);
