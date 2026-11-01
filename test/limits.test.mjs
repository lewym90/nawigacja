import test from 'node:test';
import assert from 'node:assert/strict';
import { edgesToLimits, loadRouteLimits } from '../js/limits.js';
import { SpeedFilter } from '../js/speed.js';
import { limitAt } from '../js/routing.js';
import { fakeRoute } from './helpers.mjs';

test('edgesToLimits: długości w km -> odcinki w metrach, sąsiednie o tym samym limicie łączą się', () => {
  const json = { edges: [{ length: 1.0, speed_limit: 50 }, { length: 0.5, speed_limit: 50 }, { length: 2.0 }, { length: 1.5, speed_limit: 90 }] };
  const l = edgesToLimits(json, 5000);
  assert.deepEqual(l.map((x) => x.kmh), [50, null, 90]);
  assert.ok(Math.abs(l[0].to - 1500) < 1 && Math.abs(l[2].to - 5000) < 1);
});

test('edgesToLimits: dopasowanie o zupełnie innej długości jest odrzucane', () => {
  assert.equal(edgesToLimits({ edges: [{ length: 10, speed_limit: 50 }] }, 5000), null);
  assert.equal(edgesToLimits({ edges: [] }, 5000), null);
});

test('loadRouteLimits: fragmenty z mockowanego serwera składają się w route.limits i limitAt je czyta', async () => {
  const route = fakeRoute();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body).shape.length);
    return { ok: true, json: async () => ({ edges: [{ length: route.distance / 1000 / 2, speed_limit: 50 }, { length: route.distance / 1000 / 2, speed_limit: 90 }] }) };
  };
  const r = await loadRouteLimits('https://valhalla.test', route);
  assert.ok(r.ok);
  assert.ok(calls.length >= 1);
  assert.equal(limitAt(route, 100), 50);
  assert.equal(limitAt(route, route.distance - 100), 90);
});

test('loadRouteLimits: błąd serwera nie psuje trasy', async () => {
  const route = fakeRoute();
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const r = await loadRouteLimits('https://valhalla.test', route);
  assert.equal(r.ok, false);
  assert.ok(!route.limits || route.limits.length === 0);
});

test('SpeedFilter: wygładza skok, zeruje postój, trzyma wartość przy złym odczycie', () => {
  const f = new SpeedFilter();
  let t = 0;
  const fix = (speed, accuracy = 5) => ({ lng: 22, lat: 51, speed, accuracy, t: (t += 1000) });
  for (let i = 0; i < 8; i++) f.update(fix(13.9));
  assert.ok(Math.abs(f.v - 13.9) < 0.2);
  const hold = f.update(fix(40, 200)); // beznadziejna dokładność: ignorujemy
  assert.ok(Math.abs(hold - 13.9) < 0.3);
  for (let i = 0; i < 8; i++) f.update(fix(0));
  assert.equal(f.v, 0);
});
