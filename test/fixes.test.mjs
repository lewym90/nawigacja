import test from 'node:test';
import assert from 'node:assert/strict';
import { FixStore, pickExclusions, distToSegM, FIXES, newClientId } from '../js/fixes.js';
import { fetchValhallaRoutes } from '../js/valhalla.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const A = [22.5, 51.2]; const B = [22.9, 51.3];

test('odległość punktu od odcinka', () => {
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  assert.ok(distToSegM(mid, A, B) < 1);
  assert.ok(Math.abs(distToSegM([22.5, 51.21], A, A) - 1112) < 15);
});

test('pickExclusions: korytarz, kolejność i limit', () => {
  const fx = [
    { lng: 22.7, lat: 51.25 }, { lng: 22.7, lat: 51.251 }, // ~100 m od prostej
    { lng: 22.7, lat: 51.9 },                              // daleko
    { lng: 22.70001, lat: 51.25001 },                      // duplikat pierwszego (<15 m)
  ];
  const out = pickExclusions(fx, A, B);
  assert.equal(out.length, 2);
  assert.equal(pickExclusions(fx, A, B, { max: 1 }).length, 1);
  assert.ok(!out.some((p) => p[1] > 51.5));
});

test('własne „unikaj” działa od razu, cudze dopiero od n>=2, „ok” nie wyklucza', async () => {
  const calls = [];
  const fetchFn = async (url, opt = {}) => {
    calls.push([url, opt.method || 'GET']);
    if (opt.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 7 }) };
    return { ok: true, status: 200, json: async () => [
      { id: 1, kind: 'avoid', mode: 'auto', lat: 51.25, lng: 22.7, n: 1 },
      { id: 2, kind: 'avoid', mode: 'auto', lat: 51.26, lng: 22.6, n: 3 },
      { id: 3, kind: 'ok', mode: 'auto', lat: 51.24, lng: 22.65, n: 5 },
    ] };
  };
  const s = new FixStore({ url: 'https://x/fixes', storage: mem(), fetchFn });
  s.add('avoid', 'auto', 51.2501, 22.55);
  s.add('avoid', 'pedestrian', 51.25, 22.56);
  const ex = await s.exclusionsFor(A, B, 'auto');
  assert.equal(ex.length, 2);                       // własne auto + cudze n=3
  assert.ok(ex.some((p) => Math.abs(p[0] - 22.55) < 1e-6));
  assert.ok(!ex.some((p) => Math.abs(p[0] - 22.7) < 1e-6)); // n=1 pominięte
  assert.ok(calls.some(([, m]) => m === 'POST'));
});

test('synchronizacja: błąd sieci nie gubi wpisu, ponowienie wysyła', async () => {
  let fail = true; let posts = 0;
  const fetchFn = async () => { posts++; if (fail) throw new Error('offline'); return { ok: true, status: 200, json: async () => ({ id: 9 }) }; };
  const st = mem();
  const s = new FixStore({ url: 'https://x/fixes', storage: st, fetchFn });
  s.add('avoid', 'auto', 51.25, 22.6);
  await s.sync();
  assert.equal(s.own()[0].sid, null);
  fail = false;
  assert.equal(await s.sync(), 1);
  assert.equal(s.own()[0].sid, 9);
  assert.equal(JSON.parse(st.getItem('nav.fixes.own'))[0].sid, 9);
  assert.ok(posts >= 2);
});

test('serwer niedostępny: trasowanie dalej działa na własnych poprawkach', async () => {
  const s = new FixStore({ url: 'https://x/fixes', storage: mem(), fetchFn: async () => { throw new Error('down'); } });
  s.add('avoid', 'auto', 51.25, 22.7);
  const ex = await s.exclusionsFor(A, B, 'auto');
  assert.equal(ex.length, 1);
});

test('usuwanie własnej poprawki i stały identyfikator klienta', () => {
  const s = new FixStore({ url: '', storage: mem(), fetchFn: null });
  const f = s.add('ok', 'auto', 51.25, 22.7);
  assert.equal(s.own().length, 1);
  assert.ok(s.remove(f.lid));
  assert.equal(s.own().length, 0);
  assert.equal(s.clientId, s.clientId);
  assert.notEqual(newClientId(), newClientId());
  assert.ok(FIXES.confirmN >= 2);
});

test('fetchValhallaRoutes: poprawki trafiają do exclude_locations na początku listy', async () => {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url); bodies.push(JSON.parse(u.searchParams.get('json')));
    return { ok: true, status: 200, json: async () => ({ trip: { status: 0, legs: [], locations: [], summary: { length: 1, time: 1 } } }) };
  };
  try { await fetchValhallaRoutes('https://v/valhalla', [A, B], { avoidMinor: false, fixExclude: [[22.7, 51.25], [22.71, 51.26]] }); } catch { /* odpowiedź atrapy nie ma geometrii */ }
  globalThis.fetch = realFetch;
  assert.ok(bodies.length >= 1);
  assert.deepEqual(bodies[0].exclude_locations, [{ lat: 51.25, lon: 22.7 }, { lat: 51.26, lon: 22.71 }]);
});
