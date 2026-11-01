import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulator, maneuverSpeed } from '../js/sim.js';
import { fakeRoute } from './helpers.mjs';

function drive(route, ticks = 1000) {
  const fixes = [];
  const sim = new Simulator(route, { onFix: (f) => fixes.push(f), tickMs: 1000 });
  for (let i = 0; i < ticks; i++) { sim.step(); if (sim.along >= route.line.total - 0.5) break; }
  return fixes;
}

test('symulator rusza z zera, rozpędza się łagodnie i przed skrętem zwalnia', () => {
  const route = fakeRoute();
  const f = drive(route);
  assert.ok(f[0].speed <= 2, `pierwszy odczyt ${f[0].speed}`);
  for (let i = 1; i < f.length; i++) assert.ok(f[i].speed - f[i - 1].speed <= 1.81, 'przyspieszenie nie większe niż ok. 1,8 m/s²');
  assert.ok(Math.max(...f.map((x) => x.speed)) * 3.6 >= 45, 'dojeżdża do prędkości jazdy');
  // skręt w prawo jest na 6000 m: tuż przed nim prędkość spada do ok. 24 km/h
  const idx = f.findIndex((x) => x.lat > 51.2 + 5996 / 111195);
  assert.ok(idx > 0);
  assert.ok(f[idx].speed * 3.6 < 36, `przy skręcie ${Math.round(f[idx].speed * 3.6)} km/h`);
  for (let i = 1; i < f.length - 1; i++) assert.ok(f[i - 1].speed - f[i].speed <= 2.01, 'hamowanie nie ostrzejsze niż ok. 2 m/s²');
  assert.ok(f[f.length - 1].speed < 3, 'przy celu prawie stoi');
});

test('prędkość manewru: rondo wolniej niż zwykły skręt wolniej niż łagodny łuk', () => {
  assert.ok(maneuverSpeed({ type: 'roundabout' }) < maneuverSpeed({ type: 'turn', modifier: 'right' }));
  assert.ok(maneuverSpeed({ type: 'turn', modifier: 'right' }) < maneuverSpeed({ type: 'turn', modifier: 'slight right' }));
  assert.equal(maneuverSpeed({ type: 'arrive' }), 0);
});
