import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLine } from '../js/geo.js';
import { parseFuel, packFuel, unpackFuel, candidatesAhead, fuelDetours, bestStation, fmtExtra } from '../js/fuel.js';
import { explainRoute, metersAtLeast } from '../js/explain.js';

const line = buildLine([[22.0, 51.0], [22.1, 51.0], [22.2, 51.0], [22.5, 51.0]]);
const st = [
  { k: 'fuel', lat: 51.002, lng: 22.05, b: 'Orlen' },   // ~220 m od trasy
  { k: 'fuel', lat: 51.0, lng: 22.3, b: 'BP' },         // na trasie
  { k: 'fuel', lat: 51.05, lng: 22.3, b: 'Daleko' },    // 5,5 km od trasy
  { k: 'fuel', lat: 51.001, lng: 22.0005, b: 'Za nami' },
];

test('parseFuel / pack / unpack', () => {
  const p = parseFuel({ elements: [
    { lat: 51.2, lon: 22.5, tags: { amenity: 'fuel', brand: 'Orlen', 'fuel:lpg': 'yes' } },
    { center: { lat: 51.3, lon: 22.6 }, tags: { amenity: 'fuel', name: 'Lokalna' } },
    { lat: 10, lon: 10, tags: { amenity: 'fuel' } },
    { lat: 51.2, lon: 22.5, tags: { amenity: 'fuel', disused: 'yes' } },
  ] });
  assert.equal(p.length, 2);
  const u = unpackFuel(packFuel(p));
  assert.equal(u[0].b, 'Orlen'); assert.equal(u[0].lpg, true); assert.equal(u[1].b, 'Lokalna');
});

test('kandydaci: tylko przed nami i blisko trasy', () => {
  const c = candidatesAhead(st, line, 1000, { maxOff: 1500 });
  const names = c.map((x) => x.brand);
  assert.ok(names.includes('BP') && !names.includes('Daleko') && !names.includes('Za nami'));
  assert.ok(!names.includes('Orlen') || c.find((x) => x.brand === 'Orlen').along > 1100);
});

test('koszt objazdu z macierzy i wybór najlepszej', async () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url) => {
    const b = JSON.parse(new URL(url).searchParams.get('json'));
    n++;
    if (b.sources.length === 1) return { ok: true, json: async () => ({ sources_to_targets: [[{ time: 300, distance: 5 }, { time: 600, distance: 11 }, { time: 900, distance: 20 }]] }) };
    return { ok: true, json: async () => ({ sources_to_targets: [[{ time: 650, distance: 14.5 }], [{ time: 280, distance: 4.4 }]] }) };
  };
  try {
    const cands = [{ lat: 51, lng: 22.1, along: 1, off: 5 }, { lat: 51, lng: 22.2, along: 2, off: 5 }];
    const out = await fuelDetours('https://v', [22, 51], [22.5, 51], cands);
    assert.equal(n, 2);
    assert.ok(Math.abs(out[0].extraMin - (300 + 650 - 900) / 60) < 1e-9);
    assert.equal(out[1].extraMin, 0); // 600 + 280 < 900: przez stację nie wychodzi dłużej
    assert.equal(bestStation(out).extraMin, Math.min(...out.map((x) => x.extraMin)));
    assert.match(fmtExtra({ extraMin: 3.2, extraKm: 1.14 }), /\+3 min \(\+1,1 km\)/);
    assert.equal(fmtExtra({ extraMin: 0.1, extraKm: 0 }), 'bez objazdu');
  } finally { globalThis.fetch = realFetch; }
});

test('„dlaczego ta trasa”: najszybsza, mieszanka dróg, ominięcia i poprawki', () => {
  const mk = (duration, distance, via, limits) => ({ duration, distance, via, limits });
  const a = mk(3000, 60000, 'S17', [{ from: 0, to: 40000, kmh: 120 }, { from: 40000, to: 60000, kmh: 50 }]);
  const b = mk(3600, 52000, 'DK19', [{ from: 0, to: 52000, kmh: 70 }]);
  const t = explainRoute([a, b], 0, { prefLabel: 'Zrównoważona', avoid: 'poprawiona 800→0 m', fixes: 2, cams: 1 });
  assert.match(t[0], /Najszybsza: 10 min szybciej niż trasa przez DK19/);
  assert.ok(t.some((x) => /Drogi szybkiego ruchu.*40,0 km.*67%/.test(x)));
  assert.ok(t.some((x) => /Ominięto 800 m/.test(x)));
  assert.ok(t.some((x) => /2 zgłoszonych miejsc/.test(x)));
  const s = explainRoute([a, b], 1, {});
  assert.match(s[0], /Najkrótsza: 8,0 km krócej/);
  assert.equal(metersAtLeast(a, 100), 40000);
  assert.deepEqual(explainRoute([], 0), []);
});
