import test from 'node:test';
import assert from 'node:assert/strict';
import { destination, pointAt } from '../js/geo.js';
import { instruct, fmtDist, fmtDuration, parseRoutes, routeUrl, limitAt } from '../js/routing.js';
import { Guidance } from '../js/guidance.js';
import { fakeOsrmRoute, fakeRoute } from './helpers.mjs';

test('instrukcje po polsku', () => {
  assert.equal(instruct({ name: 'ul. Lipowa', maneuver: { type: 'turn', modifier: 'right' } }).text, 'Skręć w prawo w ulicę Lipową');
  assert.equal(instruct({ name: '', maneuver: { type: 'turn', modifier: 'sharp left' } }).text, 'Skręć ostro w lewo');
  assert.equal(instruct({ name: 'Al. X', maneuver: { type: 'roundabout', exit: 2 } }).text, 'Na rondzie zjedź drugim zjazdem w aleję X');
  assert.equal(instruct({ maneuver: { type: 'arrive', modifier: 'left' } }).text, 'Cel podróży po lewej');
  assert.equal(instruct({ maneuver: { type: 'turn', modifier: 'uturn' } }).text, 'Zawróć');
});

test('formatowanie odległości i czasu', () => {
  assert.equal(fmtDist(304), '300 m');
  assert.equal(fmtDist(1234), '1,2 km');
  assert.equal(fmtDist(15400), '15 km');
  assert.equal(fmtDuration(88 * 60), '1 h 28 min');
  assert.equal(fmtDuration(18 * 60), '18 min');
});

test('parseRoutes: kroki mają narastające położenie', () => {
  const r = parseRoutes(fakeOsrmRoute())[0];
  assert.equal(r.steps.length, 3);
  assert.equal(r.steps[0].at, 0);
  assert.equal(r.steps[1].at, 6000);
  assert.ok(Math.abs(r.distance - 10000) < 50);
});

test('parseRoutes: błąd silnika zgłasza wyjątek', () => {
  assert.throws(() => parseRoutes({ code: 'NoRoute', message: 'brak' }), /brak/);
});

test('routeUrl składa adres z kolejnością lng,lat', () => {
  const u = routeUrl('https://x.test/', [[22.5, 51.2], [23, 50.7]]);
  assert.match(u, /^https:\/\/x\.test\/route\/v1\/driving\/22\.500000,51\.200000;23\.000000,50\.700000\?/);
  assert.match(u, /alternatives=true/);
});

test('limitAt czyta limity z adnotacji', () => {
  const route = { limits: [{ from: 0, to: 500, kmh: 50 }, { from: 500, to: 900, kmh: 70 }, { from: 900, to: 1000, kmh: null }] };
  assert.equal(limitAt(route, 100), 50);
  assert.equal(limitAt(route, 600), 70);
  assert.equal(limitAt(route, 950), null);
});

test('Guidance: pozycja na trasie, pozostały dystans, następny manewr', () => {
  const route = fakeRoute();
  const g = new Guidance(route);
  const p = route.line.coords[20]; // ok. 2000 m
  const s = g.update({ lng: p[0], lat: p[1], speed: 13, accuracy: 5 });
  assert.ok(Math.abs(s.along - 2000) < 5);
  assert.equal(s.offRoute, false);
  assert.equal(s.nextIdx, 1);
  assert.ok(Math.abs(s.distToNext - 4000) < 10);
  assert.ok(Math.abs(s.remaining - 8000) < 50);
});

test('Guidance: dwie zapowiedzi na manewr, bez powtórek', () => {
  const route = fakeRoute();
  const g = new Guidance(route);
  const said = [];
  for (let along = 3500; along <= 6000; along += 20) {
    const p = pointAt(route.line, along).point;
    const s = g.update({ lng: p[0], lat: p[1], speed: 13.9, accuracy: 5 });
    said.push(...s.spoken);
  }
  // zapowiedź z odległością, ewentualne przypomnienie i komenda „teraz”
  assert.ok(said.length >= 2 && said.length <= 3, said.join(' | '));
  assert.ok(said.some((t) => /^Za .+ (metrów|kilometr).* skręć w prawo w/.test(t)), said.join(' | '));
  assert.ok(said.includes('Skręć w prawo'), said.join(' | '));
  assert.equal(new Set(said).size, said.length);
});

test('Guidance: zjechanie z trasy dopiero po kilku odczytach', () => {
  const route = fakeRoute();
  const g = new Guidance(route);
  const on = route.line.coords[10];
  const off = destination(on, 90, 120); // 120 m od trasy
  const r1 = g.update({ lng: off[0], lat: off[1], speed: 10, accuracy: 5 });
  const r2 = g.update({ lng: off[0], lat: off[1], speed: 10, accuracy: 5 });
  const r3 = g.update({ lng: off[0], lat: off[1], speed: 10, accuracy: 5 });
  assert.equal(r1.offRoute, false);
  assert.equal(r2.offRoute, false);
  assert.equal(r3.offRoute, true);
});

test('Guidance: słaby sygnał GPS nie wywołuje fałszywego przeliczania', () => {
  const route = fakeRoute();
  const g = new Guidance(route);
  const off = destination(route.line.coords[10], 90, 150);
  let flagged = false;
  for (let i = 0; i < 6; i++) flagged ||= g.update({ lng: off[0], lat: off[1], speed: 8, accuracy: 120 }).offRoute;
  assert.equal(flagged, false);
});

test('Guidance: dojazd do celu', () => {
  const route = fakeRoute();
  const g = new Guidance(route);
  const end = route.line.coords[route.line.coords.length - 1];
  const s = g.update({ lng: end[0], lat: end[1], speed: 0, accuracy: 4 });
  assert.equal(s.arrived, true);
});

test('fetchRoutes: ponawia bez adnotacji, gdy silnik odrzuci zapytanie (400)', async () => {
  const { fetchRoutes } = await import('../js/routing.js');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (/annotations=maxspeed/.test(url)) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => fakeOsrmRoute() };
  };
  const rs = await fetchRoutes('https://x.test', [[22.5, 51.2], [22.6, 51.3]]);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /annotations=false/);
  assert.equal(rs.length, 1);
});
