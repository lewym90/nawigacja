import test from 'node:test';
import assert from 'node:assert/strict';
import { ChaseCam, pathBearing } from '../js/camera.js';
import { buildLine } from '../js/geo.js';
import { MODES } from '../js/modes.js';

const lat0 = 51.2, lng0 = 22.5;
const north = (m) => [lng0, lat0 + m / 111195];
const line = buildLine(Array.from({ length: 21 }, (_, i) => north(i * 100)));
const pose = { center: north(0), bearing: 0, zoom: 17, pitch: 67 };
const fix = (along, speed, x = {}) => ({ along, line, onRoute: true, lng: lng0, lat: lat0, speed, heading: 0, zoom: 17, pitch: 67, ...x });

test('kamera jedzie płynnie między odczytami GPS', () => {
  const c = new ChaseCam(); c.place(pose); let along = 0; let prev = null;
  for (let sec = 0; sec < 10; sec++) { along += 14; c.fix(fix(along, 14)); for (let i = 0; i < 30; i++) c.tick(1 / 30); } let maxStep = 0; let minStep = 1e9;
  for (let sec = 0; sec < 12; sec++) {
    along += 14; c.fix(fix(along + (sec % 2 ? 3 : -3), 14)); // odczyty z błędem ±3 m
    for (let i = 0; i < 30; i++) {
      const y = c.tick(1 / 30).center[1] * 111195;
      if (prev != null) { const s = y - prev; maxStep = Math.max(maxStep, s); minStep = Math.min(minStep, s); }
      prev = y;
    }
  }
  assert.ok(minStep > 0, 'kamera nie cofa się przy zaszumionym GPS');
  assert.ok(maxStep - minStep < 0.4, `równy krok klatek, rozrzut ${maxStep - minStep}`);
});

test('zaszumiony kurs GPS nie rusza kierunkiem na trasie', () => {
  const c = new ChaseCam(); c.place(pose); let along = 0; let peak = 0;
  for (let sec = 0; sec < 15; sec++) {
    along += 14; c.fix(fix(along, 14, { heading: sec % 2 ? 9 : 351 }));
    for (let i = 0; i < 30; i++) { const b = c.tick(1 / 30).bearing; peak = Math.max(peak, Math.abs(((b + 180) % 360) - 180)); }
  }
  assert.ok(peak < 0.1, `kierunek stabilny, wychylenie ${peak}`);
});

test('obrót kadru ma ograniczoną szybkość, a skok trasy nie jest animowany', () => {
  const c = new ChaseCam(); c.place(pose); c.fix(fix(0, 14));
  const turn = buildLine([north(0), [lng0 + 0.01, lat0]]);
  c.fix(fix(0, 14, { line: turn }));
  let prev = c.tick(1 / 30).bearing; let peak = 0;
  for (let i = 0; i < 60; i++) { const b = c.tick(1 / 30).bearing; peak = Math.max(peak, Math.abs(b - prev) * 30); prev = b; }
  assert.ok(peak <= 38.5, `szybkość obrotu ${peak}`);
  c.fix(fix(1500, 14)); const p = c.tick(1 / 30);
  assert.ok(Math.abs(p.center[1] * 111195 - north(1500)[1] * 111195) < 30, 'przeskok bez animacji');
});

test('poza trasą kamera przewiduje pozycję z kursu', () => {
  const c = new ChaseCam(); c.place(pose);
  c.fix(fix(0, 10, { onRoute: false, heading: 0 }));
  for (let i = 0; i < 90; i++) c.tick(1 / 30);
  const p = c.tick(1 / 30);
  assert.ok(p.center[1] > lat0 + 20 / 111195, 'jedzie dalej między odczytami');
});

test('kierunek patrzy dalej przy większej prędkości', () => {
  assert.ok(Math.abs(pathBearing(line, 100, 50)) < 0.01);
});

test('zoom i pochylenie auta bez skoków', () => {
  const m = MODES.auto;
  for (let k = 0; k < 160; k++) assert.ok(Math.abs(m.zoom(k + 1) - m.zoom(k)) < 0.02, `skok przy ${k}`);
  assert.equal(m.camPitch(10), m.camPitch(120));
});

test('zdjęcia lotnicze: adres kafla jak w mapie, kolejka wzdłuż trasy bez powtórek', async () => {
  const { tileBBox, tilesAlong, tileAt } = await import('../js/orto.js');
  assert.equal(tileBBox(0, 0, 1), '-20037508.342789244,0,0,20037508.342789244');
  const t = tilesAlong(line, 0, 2000);
  assert.equal(new Set(t.map(String)).size, t.length);
  assert.deepEqual(t[0], [...tileAt(north(0), 16), 16]);
});

test('pasy ruchu: kierunki, aktywny pas, porada i drogowskaz', async () => {
  const { parseLanes, laneAdvice, towardOf, lanesStraight, laneFeatures, parseJunctionLanes, junctionAhead } = await import('../js/lanes.js');
  const l = parseLanes([{ directions: 8 }, { directions: 2 }, { directions: 64, active: 64 }]);
  assert.deepEqual(l.map((x) => x.angles[0]), [-90, 0, 90]);
  assert.equal(laneAdvice(l, 'right'), 'Zajmij prawy pas');
  assert.equal(laneAdvice(parseLanes([{ directions: 8, active: 8 }, { directions: 2 }, { directions: 2 }]), 'left'), 'Zajmij lewy pas');
  assert.equal(laneAdvice(parseLanes([{ directions: 2, active: 2 }, { directions: 2, active: 2 }]), 'straight'), null);
  // 2 w lewo + 2 prosto, jedziemy prosto: żadnego „trzymaj się prawych pasów”
  const straight = [{ directions: 8 }, { directions: 8 }, { directions: 2, active: 2 }, { directions: 2, active: 2 }];
  assert.equal(laneAdvice(parseLanes(straight), 'slight right'), null);
  assert.equal(lanesStraight(straight), true);
  assert.equal(lanesStraight([{ directions: 2 }, { directions: 64, active: 64 }]), false);
  assert.equal(parseLanes([{ directions: 2 }, { directions: 8 }]), null);
  assert.equal(towardOf('Skręć w prawo, kierunek: Przemyśl/Bychawa.'), 'Przemyśl, Bychawa');
  assert.equal(towardOf('Skręć w lewo.'), '');
  const j = parseJunctionLanes([{ indications: ['left'] }, { indications: ['straight'], active: true }, { indications: ['straight'], active: true }, { indications: ['right'] }]);
  assert.deepEqual(j.map((x) => [x.angles[0], x.on]), [[-90, false], [0, true], [0, true], [90, false]]);
  assert.equal(junctionAhead([{ at: 100 }, { at: 500 }], 60, 250).at, 100);
  assert.equal(junctionAhead([{ at: 100 }, { at: 500 }], 120, 250), null);
  const f = laneFeatures([{ lane_count: 3, traversability: 'forward', begin_shape_index: 0, end_shape_index: 1, length: 0.05 }, { lane_count: 3, traversability: 'forward', begin_shape_index: 1, end_shape_index: 2, length: 0.05 }], [[0, 0], [0, 1], [0, 2]]);
  assert.equal(f.length, 2);
  assert.equal(f[0].geometry.coordinates.length, 3);
  assert.equal(laneFeatures([{ lane_count: 3, traversability: 'forward', begin_shape_index: 0, end_shape_index: 1, length: 0.03 }], [[0, 0], [0, 1]]).length, 0);
});

test('nazwa ulicy zamiast samego numeru, a rozwidlenie z pasami prosto to jazda prosto', async () => {
  const { tripToOsrmRoute } = await import('../js/valhalla.js');
  const trip = { summary: {}, legs: [{ shape: '_ibE_seK_ibE_seK', maneuvers: [
    { type: 1, length: 1, time: 1, begin_shape_index: 0, street_names: ['Armii Krajowej'] },
    { type: 23, length: 1, time: 1, begin_shape_index: 1, street_names: ['830'], begin_street_names: ['Bohaterów Monte Cassino', '830'], lanes: [{ directions: 8 }, { directions: 2, active: 2 }] },
    { type: 4, length: 0, time: 0, begin_shape_index: 1 } ] }] };
  const st = tripToOsrmRoute(trip).legs[0].steps[1];
  assert.equal(st.name, 'Bohaterów Monte Cassino');
  assert.equal(st.maneuver.modifier, 'straight');
});

test('ruch: korki na naszej linii, próg zmiany trasy, godzina wyjazdu', async () => {
  const { jamsOnLine, worthSwitch, nextJam, departAt } = await import('../js/traffic.js');
  const j = jamsOnLine({ length: 1000, jams: [{ from: 100, to: 200, mag: 3, kind: 'JAM' }, { from: 300, to: 400, mag: 0, kind: 'OTHER' }] }, { total: 2000 }, 1000);
  assert.equal(j.length, 1); assert.equal(j[0].from, 1100); assert.equal(j[0].to, 1200);
  assert.equal(worthSwitch(1800, 1700), 0);
  assert.equal(worthSwitch(1800, 1500), 300);
  const rw = jamsOnLine({ length: 1000, jams: [{ from: 10, to: 20, mag: 4, kind: 'ROAD_WORK' }] }, { total: 1000 });
  assert.equal(rw.length, 1); assert.equal(nextJam(rw, 0), null);
  assert.equal(nextJam(j, 1150), j[0]); assert.equal(nextJam(j, 1300), null);
  assert.equal(departAt(0), null);
  assert.match(departAt(30, new Date('2026-11-05T06:00:00Z')), /^2026-11-05T\d\d:30:00[+-]\d\d:\d\d$/);
});

test('limity: podejrzane 90 w mieście znika, prawdziwe 90 zostaje, krótkie skoki się wygładzają', async () => {
  const { cleanLimits } = await import('../js/limits.js');
  const seg = (from, to, kmh, local = true) => ({ from, to, kmh, local });
  // Zemborzycka: 50, 90, brak, 90, 50
  assert.deepEqual(cleanLimits([seg(0, 500, 50), seg(500, 600, 90), seg(600, 710, null), seg(710, 800, 90), seg(800, 1200, 50)]).map((s) => s.kmh), [50]);
  // dłuższy przebieg: sygnał o 90 poza miastem zostaje
  assert.deepEqual(cleanLimits([seg(0, 500, 50), seg(500, 3000, 90), seg(3000, 3400, 50)]).map((s) => s.kmh), [50, 90, 50]);
  // droga główna z krótkim 90 nie jest zgadywana
  assert.deepEqual(cleanLimits([seg(0, 500, 50, false), seg(500, 900, 90, false), seg(900, 1200, 50, false)]).map((s) => s.kmh), [50, 90, 50]);
  // długi łańcuch krótkich odcinków bez danych nie dostaje zmyślonego limitu
  const chain = cleanLimits([seg(0, 500, 50), ...[0, 1, 2, 3, 4, 5].map((i) => seg(500 + i * 100, 600 + i * 100, null))]);
  assert.equal(chain[chain.length - 1].kmh, null);
  // niższy limit zostaje nawet na krótko
  assert.deepEqual(cleanLimits([seg(0, 500, 50), seg(500, 560, 30), seg(560, 900, 50)]).map((s) => s.kmh), [50, 30, 50]);
});

test('profile: nieznana wartość z ustawień wraca do domyślnej', async () => {
  const { cameraProfile, qualityProfile, CAMERA_PROFILES, QUALITY_PROFILES } = await import('../js/profiles.js');
  assert.equal(cameraProfile('x'), CAMERA_PROFILES.dynamic);
  assert.equal(qualityProfile(undefined), QUALITY_PROFILES.high);
  for (const q of Object.values(QUALITY_PROFILES)) assert.ok(q.drop > q.radius);
});

test('wstęga: ostry narożnik jest zaokrąglony, a końce i długość zostają', async () => {
  const { drivePath } = await import('../js/snap.js');
  const { pts, along } = drivePath([[0, 0], [100, 0], [100, 100]]);
  assert.deepEqual(pts[0], [0, 0]); assert.deepEqual(pts.at(-1), [100, 100]);
  assert.equal(along.at(-1), 200);
  const corner = Math.min(...pts.map(([x, y]) => Math.hypot(x - 100, y)));
  assert.ok(corner > 2 && corner < 8, String(corner));
});

test('niska kamera: włącza się 100 m przed skrzyżowaniem i schodzi 100 m za nim', async () => {
  const { closeUntil, zoomForDistance } = await import('../js/profiles.js');
  assert.equal(closeUntil({ along: 0, kmh: 50, nextAt: 300, blocked: false, until: null }), -1);
  assert.equal(closeUntil({ along: 210, kmh: 50, nextAt: 300, blocked: false, until: null }), 400);
  assert.equal(closeUntil({ along: 0, kmh: 120, nextAt: 150, blocked: false, until: null }), 250); // 120 km/h: 5 s to 167 m
  assert.equal(closeUntil({ along: 500, kmh: 50, nextAt: null, blocked: true, until: null }), 600);
  assert.equal(closeUntil({ along: 10, kmh: 50, nextAt: null, blocked: false, until: 2000 }), -1); // stary znacznik po nowej trasie
  const z = zoomForDistance(26, 51.25, 844, 50);
  assert.ok(z > 20 && z < 21.5, String(z));
});

test('tor: trasa kładzie się na prawym pasie jezdni i nie skacze do sąsiedniej', async () => {
  const { drivePath, AxisIndex, pathAt } = await import('../js/snap.js');
  const axes = new AxisIndex([{ pts: [[0, 8], [400, 8]], w: 8, two: true }, { pts: [[0, 30], [400, 30]], w: 8, two: true }]);
  const { pts, along } = drivePath([[0, 0], [400, 0]], 1, axes); // trasa 8 m obok osi, jedzie na wschód
  const mid = pts[Math.floor(pts.length / 2)];
  assert.ok(Math.abs(mid[1] - 6) < 0.5, String(mid[1])); // oś minus ćwierć szerokości, czyli w prawo
  assert.equal(Math.round(along.at(-1)), 400);
  const p = pathAt({ pts, along }, 200, (x, y) => [x, y]);
  assert.ok(Math.abs(p.bearing - 90) < 3, String(p.bearing));
  const free = drivePath([[0, 500], [400, 500]], 1, axes);
  assert.equal(free.pts[80][1], 500); // poza jezdniami tor zostaje na trasie
});

test('tor: prawy pas, a przed skrętem w lewo lewy', async () => {
  const { laneOffset } = await import('../js/snap.js');
  assert.equal(laneOffset(8, true, false), 2); // jeden pas w każdą stronę: ćwierć szerokości
  assert.equal(laneOffset(14, true, false), 5.25); // dwa pasy w każdą stronę: skrajny prawy
  assert.equal(laneOffset(14, true, true), 1.75);
  assert.equal(laneOffset(7, false, false), 1.75); // jezdnia jednokierunkowa, dwa pasy
  assert.equal(laneOffset(7, false, true), -1.75);
  assert.equal(laneOffset(4, true, false), 0); // wąska uliczka: środkiem
});

test('tor: zakręt nie ścina narożnika', async () => {
  const { drivePath, AxisIndex } = await import('../js/snap.js');
  const axes = new AxisIndex([{ pts: [[0, 0], [200, 0]], w: 7, two: true, name: 'A' }, { pts: [[200, 0], [200, -200]], w: 7, two: true, name: 'B' }]);
  const { pts } = drivePath([[0, 0], [200, 0], [200, -200]], 1, axes); // skręt w prawo
  assert.ok(pts.every(([x, y]) => !(x < 195.5 && y < -4.5)), 'tor wszedł na chodnik'); // prawdziwy narożnik ma promień, więc metr zapasu od kwadratowego rogu
});

test('przecznice: po jednej tabliczce na ulicę, bez bieżącej', async () => {
  const { drivePath, AxisIndex, crossings } = await import('../js/snap.js');
  const axes = new AxisIndex([{ pts: [[0, 0], [400, 0]], w: 7, two: true, name: 'Główna' }, { pts: [[100, -50], [100, 50]], w: 6, two: true, name: 'Boczna' }]);
  const p = drivePath([[0, 0], [400, 0]], 1, axes);
  const c = crossings(p, 1, axes);
  assert.deepEqual(c.map((x) => x.name), ['Boczna']);
  assert.ok(Math.abs(c[0].at - 100) < 15, String(c[0].at));
});
