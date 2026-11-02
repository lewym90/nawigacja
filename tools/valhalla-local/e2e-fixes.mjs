// Dowód, że poprawka „unikaj tej drogi” zmienia trasę: bierzemy punkt z połowy trasy bazowej, dodajemy go jako
// wykluczenie (tak jak robi FixStore) i sprawdzamy, że nowa trasa omija to miejsce.
// Użycie: node e2e-fixes.mjs http://127.0.0.1:8765
import { fetchValhallaRoutes } from '../../js/valhalla.js';
import { distToSegM } from '../../js/fixes.js';
const base = process.argv[2];
const pairs = [
  [[22.5684, 51.2465], [22.4710, 51.2230]], [[22.5684, 51.2465], [22.6400, 51.2000]],
  [[22.5300, 51.2700], [22.6100, 51.2100]], [[22.5000, 51.2300], [22.6200, 51.2800]],
];
const minDist = (coords, p) => { let m = Infinity; for (let i = 1; i < coords.length; i++) m = Math.min(m, distToSegM(p, coords[i - 1], coords[i])); return m; };
let ok = 0; let tested = 0;
for (const [A, B] of pairs) {
  const r0 = (await fetchValhallaRoutes(base, [A, B], { alternatives: false, avoidMinor: false })).routes[0];
  const c = r0.geometry.coordinates; const p = c[Math.floor(c.length / 2)];
  const r1 = (await fetchValhallaRoutes(base, [A, B], { alternatives: false, avoidMinor: false, fixExclude: [p] })).routes[0];
  const d = minDist(r1.geometry.coordinates, p); tested++;
  const good = d > 15 && r1.distance !== r0.distance;
  if (good) ok++;
  console.log(`${good ? 'OK ' : 'ZLE'} ${(r0.distance / 1000).toFixed(1)}→${(r1.distance / 1000).toFixed(1)} km, ${(r0.duration / 60).toFixed(0)}→${(r1.duration / 60).toFixed(0)} min, najbliżej punktu: ${d.toFixed(0)} m`);
}
console.log(`${ok}/${tested} tras omija zaznaczone miejsce`);
process.exit(ok === tested ? 0 : 1);
