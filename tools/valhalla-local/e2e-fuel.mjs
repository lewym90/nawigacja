// Sprawdza na prawdziwych danych: macierz Valhalli daje ten sam koszt objazdu co trasa „przez” punkt,
// a trasa z punktem pośrednim nie ma w środku komunikatu „cel podróży”.
// Użycie: node e2e-fuel.mjs http://127.0.0.1:8765
import { fuelDetours } from '../../js/fuel.js';
import { fetchValhallaRoutes } from '../../js/valhalla.js';
import { parseRoutes } from '../../js/routing.js';
const base = process.argv[2];
const A = [22.5684, 51.2465]; const B = [22.4000, 51.0500];
const direct = parseRoutes(await fetchValhallaRoutes(base, [A, B], { alternatives: false, avoidMinor: false }))[0];
const c = direct.line.coords;
const near = (i, dLat) => ({ lat: c[i][1] + dLat, lng: c[i][0], along: i, off: 100 });
const cands = [near(Math.floor(c.length * 0.3), 0.004), near(Math.floor(c.length * 0.6), -0.006), near(Math.floor(c.length * 0.8), 0.001)];
const det = await fuelDetours(base, A, B, cands);
let bad = 0;
for (const d of det) {
  const via = parseRoutes(await fetchValhallaRoutes(base, [A, [d.lng, d.lat], B], { alternatives: false, avoidMinor: false }))[0];
  const arrives = via.steps.filter((s) => s.type === 'arrive').length;
  const real = (via.duration - direct.duration) / 60;
  const ok = arrives === 1 && Math.abs(real - d.extraMin) < 2.0;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'ZLE'} macierz +${d.extraMin.toFixed(1)} min / +${d.extraKm.toFixed(1)} km | trasa przez punkt +${real.toFixed(1)} min | komunikatów „cel”: ${arrives}`);
}
console.log(bad ? `${bad} rozbieżności` : `macierz zgodna z trasą przez punkt (${det.length} stacji)`);
process.exit(bad || !det.length ? 1 : 0);
