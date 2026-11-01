import test from 'node:test';
import assert from 'node:assert/strict';
import { Compass } from '../js/compass.js';
import { Guidance } from '../js/guidance.js';
import { MODES } from '../js/modes.js';
import { buildLine } from '../js/geo.js';

test('kompas: iOS webkitCompassHeading i Android alpha, wygładzanie', () => {
  const c = new Compass();
  assert.equal(c.get(), null);
  c.feed({ webkitCompassHeading: 90 });
  assert.equal(Math.round(c.get()), 90);
  c.feed({ webkitCompassHeading: 100 });
  assert.ok(c.get() > 90 && c.get() < 100);
  const a = new Compass();
  a.feed({ absolute: true, alpha: 270 });
  assert.equal(Math.round(a.get()), 90);
  a.feed({ alpha: 10 }); // bez „absolute”: ignorujemy
  assert.equal(Math.round(a.get()), 90);
});

test('kompas: odmowa zgody', async () => {
  const win = { DeviceOrientationEvent: { requestPermission: async () => 'denied' }, addEventListener() {}, removeEventListener() {} };
  assert.equal(await new Compass().start(win), false);
});

test('pieszo: zapowiedzi na krótkich dystansach', () => {
  const coords = [[22.5, 51.2], [22.5, 51.203], [22.504, 51.203]]; // ok. 333 m + 280 m
  const line = buildLine(coords);
  const route = { line, distance: line.total, coords, steps: [
    { at: 0, distance: 333, duration: 240, type: 'depart', text: 'Idź', short: 'Idź' },
    { at: 333, distance: 280, duration: 200, type: 'turn', modifier: 'right', text: 'Skręć w prawo w ulicę Krótką', short: 'Skręć w prawo' },
    { at: line.total, distance: 0, duration: 0, type: 'arrive', text: 'Cel podróży', short: 'Cel podróży' },
  ] };
  const g = new Guidance(route, { profile: MODES.pedestrian.guide });
  const say = [];
  const at = (lat, lng) => say.push(...g.update({ lng, lat, speed: 1.3, accuracy: 6 }).spoken);
  at(51.2002, 22.5);   // daleko od skrętu: zapowiedź
  at(51.20292, 22.5);   // ok. 9 m przed skrętem: komenda
  assert.ok(say.some((t) => /^Za .*(metrów|metry)/.test(t)), `zapowiedź: ${say}`);
  assert.ok(say.some((t) => t === 'Skręć w prawo'), `komenda: ${say}`);
});

test('schody i przejścia nie są „ciche”, mimo że manewr to jazda prosto', async () => {
  const { isSilent } = await import('../js/guidance.js');
  assert.equal(isSilent({ type: 'continue', modifier: 'straight' }), true);
  assert.equal(isSilent({ type: 'continue', modifier: 'straight', feature: 'stairs' }), false);
  assert.equal(isSilent({ type: 'turn', modifier: 'straight', feature: 'crossing' }), false);
});

test('pieszo: schody tuż przed celem są zapowiedziane przed „Jesteś na miejscu”', () => {
  const coords = [[22.5, 51.2], [22.5, 51.2018]]; // ok. 200 m na północ
  const line = buildLine(coords);
  const T = line.total;
  const route = { line, distance: T, coords, steps: [
    { at: 0, distance: T - 5, duration: 140, type: 'depart', text: 'Idź', short: 'Idź' },
    { at: T - 5, distance: 5, duration: 4, type: 'continue', modifier: 'straight', feature: 'stairs', text: 'Idź po schodach', short: 'Idź po schodach' },
    { at: T, distance: 0, duration: 0, type: 'arrive', text: 'Cel podróży', short: 'Cel podróży' },
  ] };
  const g = new Guidance(route, { profile: MODES.pedestrian.guide });
  const said = [];
  let arrivedAt = null;
  for (let m = 0; m <= T; m += 2) {
    const lat = 51.2 + (m / T) * 0.0018;
    const r = g.update({ lng: 22.5, lat, speed: 1.3, accuracy: 5 });
    said.push(...r.spoken.map((t) => ({ m, t })));
    if (r.arrived && arrivedAt == null) arrivedAt = m;
  }
  const stairs = said.find((s) => /schodach/.test(s.t));
  assert.ok(stairs, `brak zapowiedzi schodów: ${JSON.stringify(said)}`);
  assert.ok(arrivedAt == null || stairs.m < arrivedAt, 'schody muszą paść przed uznaniem celu');
  assert.ok(arrivedAt >= T - 9, `cel pieszo nie może być uznany za wcześnie (${arrivedAt} z ${T.toFixed(0)})`);
});
