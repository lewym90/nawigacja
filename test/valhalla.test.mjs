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
  assert.match(r.steps[2].text, /Przejdź przez ulicę/);
});
