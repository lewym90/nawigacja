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
  assert.ok(texts.includes('Przejdź przez ulicę'), texts.join(' | '));
  assert.ok(texts.includes('Idź po schodach'), texts.join(' | '));
});

test('zapytanie Valhalli: koszty pieszych (podjazdy/alejki bez kary) i kierunek startu', async () => {
  const { valhallaRequest, COSTING_OPTIONS } = await import('../js/valhalla.js');
  const ped = valhallaRequest([[22.5, 51.2], [22.6, 51.3]], { costing: 'pedestrian' });
  assert.equal(ped.costing_options.pedestrian.driveway_factor, 1);
  assert.equal(ped.costing_options.pedestrian.alley_factor, 1);
  assert.equal(COSTING_OPTIONS.pedestrian.pedestrian.sidewalk_factor, 1);
  const car = valhallaRequest([[22.5, 51.2], [22.6, 51.3]], { costing: 'auto', heading: 370 });
  assert.equal(car.locations[0].radius, 10);
  assert.equal(ped.locations[1].radius, 15);
  assert.equal(car.locations[0].heading, 10);
  assert.equal(car.locations[0].heading_tolerance, 60);
  assert.equal(car.locations[1].heading, undefined);
  assert.equal(car.costing_options.auto.use_distance, 0.6);
  const none = valhallaRequest([[22.5, 51.2], [22.6, 51.3]], { costing: 'auto' });
  assert.equal(none.locations[0].heading, undefined);
});

test('uproszczenie marszu nie robi „zawróć” z dużego skrętu', async () => {
  const { simplifyWalk } = await import('../js/valhalla.js');
  const mans = [
    { type: 1, length: 0.05, bearing_after: 0, travel_mode: 'pedestrian', instruction: 'x' },
    { type: 10, length: 0.05, bearing_after: 175, travel_mode: 'pedestrian', instruction: 'x' },
    { type: 4, length: 0, bearing_after: 175, travel_mode: 'pedestrian', instruction: 'y' },
  ];
  assert.match(simplifyWalk(mans)[1]._mod, /sharp right/);
});

test('prawdziwa odpowiedź Valhalli (Lublin, pieszo): krótka lista kroków bez zygzaków i „zawróć”', async () => {
  const { readFileSync } = await import('node:fs');
  const json = JSON.parse(readFileSync(new URL('./fixtures/valhalla-walk-lublin.json', import.meta.url), 'utf8'));
  const [r] = parseRoutes(valhallaToOsrm(json));
  const texts = r.steps.map((s) => s.text);
  assert.ok(Math.abs(r.distance - 669) < 2, `długość ${r.distance}`);
  assert.ok(r.steps.length <= 5, `za dużo kroków (${r.steps.length}): ${texts.join(' | ')}`);
  assert.equal(r.steps[0].type, 'depart');
  assert.equal(r.steps[r.steps.length - 1].type, 'arrive');
  assert.ok(!texts.some((t) => /Zawróć/.test(t)), texts.join(' | '));
  assert.ok(texts.includes('Przejdź przez ulicę'), texts.join(' | '));
  // suma długości kroków = długość trasy
  const sum = r.steps.reduce((s, x) => s + x.distance, 0);
  assert.ok(Math.abs(sum - r.distance) < 2, `suma kroków ${sum} vs ${r.distance}`);
  // żaden krok „skrętu” nie jest krótszy niż 8 m (mikroskręty wchłonięte), poza przejściem
  assert.ok(r.steps.filter((s) => s.type === 'turn' && !s.feature && s.distance < 8).length === 0);
});

test('pieszo: wybiera drogę wejścia z najkrótszą trasą (nie tylko najbliższą) i dokleja dojście', async () => {
  const { fetchValhallaRoutes, pickCandidates, pickBestPair } = await import('../js/valhalla.js');
  const { readFileSync } = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/valhalla-walk-lublin.json', import.meta.url), 'utf8'));
  const user = [22.55256, 51.19904]; // [lon, lat]
  const edge = (way, lat, lon) => ({ edge_info: { way_id: way }, correlated_lat: lat, correlated_lon: lon });
  const locateOrigin = [{ edges: [edge(1, 51.199043, 22.552495), edge(1, 51.19905, 22.5525), edge(2, 51.198952, 22.552548)] }];
  const locateDest = [{ edges: [edge(9, 51.198350, 22.544300)] }];
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const body = JSON.parse(u.searchParams.get('json'));
    calls.push([u.pathname.split('/').pop(), body]);
    const out = (j) => ({ ok: true, json: async () => j });
    if (u.pathname.endsWith('/locate')) return out(Math.abs(body.locations[0].lat - 51.19904) < 1e-6 ? locateOrigin : locateDest);
    if (u.pathname.endsWith('/sources_to_targets')) return out({ sources_to_targets: [[{ time: 600 }], [{ time: 400 }]] }); // droga nr 2 szybsza
    if (u.pathname.endsWith('/route')) return out(fixture);
    throw new Error('nieoczekiwane ' + u);
  };
  try {
    const osrm = await fetchValhallaRoutes('https://x/valhalla', [user, [22.5443, 51.19835]], { costing: 'pedestrian', alternatives: false });
    const routeCall = calls.find((c) => c[0] === 'route')[1];
    assert.equal(routeCall.locations[0].lat, 51.198952, 'trasa ma ruszać z drogi nr 2, a nie z najbliższego chodnika');
    assert.equal('radius' in routeCall.locations[0], false);
    const r = osrm.routes[0];
    assert.deepEqual(r.geometry.coordinates[0], user, 'linia zaczyna się w punkcie GPS');
    const sumSteps = r.legs[0].steps.reduce((s, x) => s + x.distance, 0);
    assert.ok(Math.abs(sumSteps - r.distance) < 2, `kroki ${sumSteps} vs trasa ${r.distance}`);
    assert.ok(r.distance > 669 && r.distance < 700, `dojście doliczone do trasy: ${r.distance}`);
  } finally { globalThis.fetch = realFetch; }
  // pickCandidates: po jednym na drogę, od najbliższego
  const c = pickCandidates(locateOrigin, user);
  assert.equal(c.length, 2);
  assert.ok(c[0].d <= c[1].d);
  // pickBestPair uwzględnia dojście
  assert.equal(pickBestPair([[{ time: 100 }], [{ time: 90 }]], [{ d: 0 }, { d: 50 }], [{ d: 0 }]).from.d, 0);
});

test('auto: bez doboru punktu wejścia (jedno zapytanie), z kierunkiem jazdy', async () => {
  const { fetchValhallaRoutes } = await import('../js/valhalla.js');
  const { readFileSync } = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/valhalla-walk-lublin.json', import.meta.url), 'utf8'));
  const paths = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { paths.push(new URL(url).pathname.split('/').pop()); return { ok: true, json: async () => fixture }; };
  try {
    await fetchValhallaRoutes('https://x/valhalla', [[22.5, 51.2], [22.6, 51.3]], { costing: 'auto', heading: 90 });
    assert.deepEqual(paths, ['route']);
  } finally { globalThis.fetch = realFetch; }
});

test('auto: koszt z use_distance 0.6 (krótsze trasy miejskie, bez rezygnacji z ekspresówek)', async () => {
  const { COSTING_OPTIONS, valhallaRequest } = await import('../js/valhalla.js');
  assert.equal(COSTING_OPTIONS.auto.auto.use_distance, 0.6);
  assert.equal(COSTING_OPTIONS.auto.auto.use_highways, undefined);
  const body = valhallaRequest([[22.5, 51.2], [22.6, 51.3]], { costing: 'auto' });
  assert.equal(body.costing_options.auto.use_distance, 0.6);
});

test('auto: wybór najszybsza / zrównoważona / najkrótsza zmienia koszt dystansu', async () => {
  const { valhallaRequest, ROUTE_PREFS, DEFAULT_PREF } = await import('../js/valhalla.js');
  const P = [[22.5, 51.2], [22.6, 51.3]];
  assert.equal(DEFAULT_PREF, 'balanced');
  assert.deepEqual(Object.keys(ROUTE_PREFS), ['fast', 'balanced', 'short']);
  assert.equal(valhallaRequest(P, { costing: 'auto', pref: 'fast' }).costing_options.auto.use_distance, 0);
  assert.equal(valhallaRequest(P, { costing: 'auto', pref: 'balanced' }).costing_options.auto.use_distance, 0.6);
  assert.equal(valhallaRequest(P, { costing: 'auto', pref: 'short' }).costing_options.auto.use_distance, 1);
  assert.equal(valhallaRequest(P, { costing: 'auto', pref: 'nieznana' }).costing_options.auto.use_distance, 0.6);
  // pieszo i rower nie zależą od preferencji
  assert.equal('use_distance' in valhallaRequest(P, { costing: 'pedestrian', pref: 'short' }).costing_options.pedestrian, false);
});
