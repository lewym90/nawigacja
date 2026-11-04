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
  const { parseLanes, laneAdvice, towardOf } = await import('../js/lanes.js');
  const l = parseLanes([{ directions: 8 }, { directions: 2 }, { directions: 64, active: 64 }]);
  assert.deepEqual(l.map((x) => x.angles[0]), [-90, 0, 90]);
  assert.equal(laneAdvice(l), 'Zajmij prawy pas');
  assert.equal(laneAdvice(parseLanes([{ directions: 8, active: 8 }, { directions: 2 }, { directions: 2 }])), 'Zajmij lewy pas');
  assert.equal(laneAdvice(parseLanes([{ directions: 2, active: 2 }, { directions: 2, active: 2 }])), null);
  assert.equal(parseLanes([{ directions: 2 }, { directions: 8 }]), null);
  assert.equal(towardOf('Skręć w prawo, kierunek: Przemyśl/Bychawa.'), 'Przemyśl, Bychawa');
  assert.equal(towardOf('Skręć w lewo.'), '');
});

test('ruch: korki na naszej linii, próg zmiany trasy, godzina wyjazdu', async () => {
  const { jamsOnLine, worthSwitch, nextJam, departAt } = await import('../js/traffic.js');
  const j = jamsOnLine({ length: 1000, jams: [{ from: 100, to: 200, mag: 3, kind: 'JAM' }, { from: 300, to: 400, mag: 0, kind: 'OTHER' }] }, { total: 2000 }, 1000);
  assert.equal(j.length, 1); assert.equal(j[0].from, 1100); assert.equal(j[0].to, 1200);
  assert.equal(worthSwitch(1800, 1700), 0);
  assert.equal(worthSwitch(1800, 1500), 300);
  assert.equal(nextJam(j, 1150), j[0]); assert.equal(nextJam(j, 1300), null);
  assert.equal(departAt(0), null);
  assert.match(departAt(30, new Date('2026-11-05T06:00:00Z')), /^2026-11-05T\d\d:30:00[+-]\d\d:\d\d$/);
});
