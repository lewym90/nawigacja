import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, valhallaToOsrm, valhallaRequest } from '../js/valhalla.js';
import { parseRoutes } from '../js/routing.js';

// kodowanie polyline precyzji 6 na potrzeby testu
function enc(coords) {
  let out = '', pl = 0, pg = 0;
  const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 32) { s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lng, lat] of coords) { const la = Math.round(lat * 1e6), lo = Math.round(lng * 1e6); out += e(la - pl) + e(lo - pg); pl = la; pg = lo; }
  return out;
}

const shape = [[22.5, 51.2], [22.5, 51.21], [22.5, 51.22], [22.51, 51.22], [22.52, 51.22]];
const trip = {
  status: 0,
  summary: { length: 3.2, time: 300 },
  legs: [{
    shape: enc(shape),
    maneuvers: [
      { type: 1, begin_shape_index: 0, length: 2.2, time: 120, street_names: ['ul. Lubelska'] },
      { type: 10, begin_shape_index: 2, length: 0.5, time: 80, street_names: ['Aleja Racławicka', 'S17'] },
      { type: 26, begin_shape_index: 3, length: 0.1, time: 20, roundabout_exit_count: 2 },
      { type: 27, begin_shape_index: 3, length: 0.4, time: 60, street_names: ['ul. Kresowa'] },
      { type: 4, begin_shape_index: 4, length: 0, time: 0 },
    ],
  }],
};

test('dekoder polyline odtwarza współrzędne', () => {
  const d = decodePolyline(enc(shape));
  assert.equal(d.length, shape.length);
  assert.ok(Math.abs(d[2][1] - 51.22) < 1e-6 && Math.abs(d[4][0] - 22.52) < 1e-6);
});

test('Valhalla -> format OSRM -> nasze trasy: kroki, ronda, nazwy i numery dróg', () => {
  const osrm = valhallaToOsrm({ trip });
  const [r] = parseRoutes(osrm);
  assert.equal(r.coords.length, shape.length);
  assert.ok(Math.abs(r.distance - 3200) < 1);
  const types = r.steps.map((s) => s.type);
  assert.deepEqual(types, ['depart', 'turn', 'roundabout', 'arrive']); // zjazd z ronda wchłonięty
  assert.equal(r.steps[1].modifier, 'right');
  assert.match(r.steps[1].text, /Skręć w prawo w aleję Racławicką/);
  assert.match(r.steps[2].text, /Na rondzie zjedź drugim zjazdem w ulicę Kresową/);
  assert.ok(Math.abs(r.steps[2].distance - 500) < 1, 'rondo + zjazd = 500 m');
  assert.equal(r.steps[2].at, 2200 + 500);
});

test('alternatywy i błędy', () => {
  assert.equal(valhallaToOsrm({ trip, alternates: [{ trip }, { trip }] }).routes.length, 3);
  assert.throws(() => valhallaToOsrm({ error: 'No route' }));
  assert.throws(() => valhallaToOsrm({ trip: { status: 442, status_message: 'No path could be found' } }), /No path/);
  const q = valhallaRequest([[22.5, 51.2], [21, 52]], { costing: 'pedestrian' });
  assert.equal(q.costing, 'pedestrian');
  assert.equal(q.locations[1].lat, 52);
});

test('opis trasy wskazuje ulicę, która odróżnia warianty (a nie wspólny początek)', () => {
  const mk = (names) => ({ geometry: { type: 'LineString', coordinates: [[22, 51], [22.1, 51.1]] },
    distance: 9000, duration: 900,
    legs: [{ summary: 'Granata', steps: names.map(([name, d]) => ({ name, distance: d, duration: 60, maneuver: { type: 'turn', modifier: 'left', location: [22, 51] } })) }] });
  const rs = parseRoutes({ code: 'Ok', routes: [
    mk([['Granata', 2000], ['Krańcowa', 4000], ['Wojciechowska', 3000]]),
    mk([['Granata', 2000], ['Zamojska', 4500], ['Wojciechowska', 2500]]),
    mk([['Granata', 2000], ['Lubelska', 5000], ['Wojciechowska', 2000]]),
  ] });
  assert.deepEqual(rs.map((r) => r.via), ['Krańcowa', 'Zamojska', 'Lubelska']);
  assert.equal(parseRoutes({ code: 'Ok', routes: [mk([['Granata', 9000]])] })[0].via, 'Granata');
});

test('pieszo: schody i przejścia z opisu manewru, krótkie komunikaty', () => {
  const osrm = valhallaToOsrm({ trip: { status: 0, summary: { length: 0.3, time: 240 }, legs: [{ shape: enc([[22.5, 51.2], [22.5, 51.201], [22.501, 51.201], [22.501, 51.202]]),
    maneuvers: [
      { type: 1, travel_mode: 'pedestrian', begin_shape_index: 0, length: 0.1, time: 70, street_names: ['ul. Krótka'], instruction: 'Walk north on ul. Krótka.' },
      { type: 15, travel_mode: 'pedestrian', begin_shape_index: 1, length: 0.1, time: 60, street_names: ['ul. Długa'], instruction: 'Turn left onto ul. Długa. Take the stairs.' },
      { type: 10, travel_mode: 'pedestrian', begin_shape_index: 2, length: 0.1, time: 60, street_names: ['ul. Szeroka'], instruction: 'Cross the street and turn right.' },
      { type: 4, travel_mode: 'pedestrian', begin_shape_index: 3, length: 0, time: 0 },
    ] }] } });
  const [r] = parseRoutes(osrm);
  assert.equal(r.steps[1].feature, 'stairs');
  assert.match(r.steps[1].text, /po schodach/);
  assert.equal(r.steps[2].feature, 'crossing');
  assert.match(r.steps[2].text, /na przejście dla pieszych/);
});

test('współrzędne wpisane jako cel', async () => {
  // parseCoords siedzi w app.js (DOM), więc sprawdzamy ten sam wzorzec osobno
  const re = /^\s*(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)\s*$/;
  assert.ok(re.test('51.2465, 22.5684') && re.test('51,2465 22,5684') && !re.test('Lublin 3'));
});

test('pieszo: zygzaki chodnika znikają, zostają prawdziwe skręty, przejście i schody (dane z serwera)', async () => {
  const { simplifyWalk, featureOf } = await import('../js/valhalla.js');
  // Kształt jak w odpowiedzi Valhalli dla trasy z testu (typ, długość km, kierunek po manewrze)
  const rows = [
    [1, 5, 274, 'Idź na zachód w stronę: chodnik.'], [10, 58, 4, 'Skręć w prawo w chodnik.'], [10, 37, 94, 'Skręć w prawo w chodnik.'],
    [15, 78, 4, 'Skręć w lewo w chodnik.'], [15, 87, 274, 'Skręć w lewo w chodnik.'], [10, 110, 4, 'Skręć w prawo w chodnik.'],
    [15, 9, 274, 'Skręć w lewo w przejście dla pieszych.'], [10, 404, 4, 'Skręć w prawo w chodnik.'], [15, 38, 274, 'Skręć w lewo w chodnik.'],
    [10, 5, 4, 'Skręć w prawo w chodnik.'], [15, 4, 274, 'Skręć w lewo w chodnik.'], [10, 15, 4, 'Skręć w prawo w chodnik.'],
    [10, 1, 94, 'Skręć w prawo w chodnik.'], [15, 24, 4, 'Skręć w lewo w chodnik.'], [10, 5, 94, 'Skręć w prawo w chodnik.'],
    [40, 5, 93, 'Użyj schodów.'], [4, 0, 93, 'Dotarłeś do celu.'],
  ].map(([type, m, b, instruction]) => ({ type, length: m / 1000, bearing_after: b, instruction, travel_mode: 'pedestrian', time: m }));
  const out = simplifyWalk(rows);
  assert.ok(out.length < rows.length - 3, `mikroskręty mają zniknąć (${rows.length} -> ${out.length})`);
  assert.equal(out[out.length - 1].type, 4);
  assert.equal(out[out.length - 2].type, 40);
  assert.equal(featureOf(out[out.length - 2]), 'stairs');
  assert.ok(out.some((m) => featureOf(m) === 'crossing'), 'przejście zostaje');
  const total = (a) => a.reduce((s, m) => s + m.length, 0);
  assert.ok(Math.abs(total(out) - total(rows)) < 1e-9, 'długość trasy się nie zmienia');
});

test('pieszo: kroki tekstowe schodów i przejścia', async () => {
  const r = parseRoutes(valhallaToOsrm({ trip: { status: 0, summary: { length: 0.2, time: 150 }, legs: [{ shape: enc([[22.5, 51.2], [22.5, 51.2005], [22.5005, 51.2005], [22.5005, 51.201]]),
    maneuvers: [
      { type: 1, travel_mode: 'pedestrian', bearing_after: 0, begin_shape_index: 0, length: 0.05, time: 40, instruction: 'Idź na północ.' },
      { type: 15, travel_mode: 'pedestrian', bearing_after: 270, begin_shape_index: 1, length: 0.01, time: 8, instruction: 'Skręć w lewo w przejście dla pieszych.' },
      { type: 10, travel_mode: 'pedestrian', bearing_after: 0, begin_shape_index: 2, length: 0.05, time: 40, instruction: 'Skręć w prawo w chodnik.' },
      { type: 40, travel_mode: 'pedestrian', bearing_after: 0, begin_shape_index: 3, length: 0.005, time: 4, instruction: 'Użyj schodów.' },
      { type: 4, travel_mode: 'pedestrian', bearing_after: 0, begin_shape_index: 3, length: 0, time: 0, instruction: 'Dotarłeś do celu.' },
    ] }] } }))[0];
  const texts = r.steps.map((s) => s.text);
  assert.ok(texts.includes('Skręć w lewo na przejście dla pieszych'), texts.join(' | '));
  assert.ok(texts.includes('Idź po schodach'), texts.join(' | '));
});
