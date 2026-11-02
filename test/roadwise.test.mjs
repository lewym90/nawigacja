import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLine, destination } from '../js/geo.js';
import {
  findCurves, adviseKmh, parseRoadPoints, packRoadPoints, unpackRoadPoints, pointsOnRoute, describe, RoadWatch, buildRoadItems,
} from '../js/roadwise.js';

// Linia z odcinków: ['straight', metry] albo ['arc', promień, kąt (+ w prawo, - w lewo)]; krok 5 m.
function build(parts, start = [22.5, 51.2]) {
  let p = start; let hd = 0; const pts = [p];
  const STEP = 5;
  for (const [kind, a, b] of parts) {
    if (kind === 'straight') for (let d = 0; d < a; d += STEP) { p = destination(p, hd, STEP); pts.push(p); }
    else {
      const R = a; const total = Math.abs(b); const sign = Math.sign(b);
      const per = (STEP / R) * (180 / Math.PI); let done = 0;
      while (done < total) { hd = (hd + sign * per + 360) % 360; p = destination(p, hd, STEP); pts.push(p); done += per; }
    }
  }
  return buildLine(pts);
}

test('zalecana prędkość z promienia łuku', () => {
  assert.equal(adviseKmh(55), 40);
  assert.equal(adviseKmh(100), 55);
  assert.equal(adviseKmh(400), 105);
  assert.equal(adviseKmh(5), 20);
});

test('zakręty: prosta droga nie ma zakrętów, łagodne odchylenie też nie', () => {
  assert.deepEqual(findCurves(build([['straight', 1500]])), []);
  assert.deepEqual(findCurves(build([['straight', 400], ['arc', 600, 10], ['straight', 400]])), []);
});

test('zakręty: ostry łuk R=60 m, 90° w prawo', () => {
  const line = build([['straight', 300], ['arc', 60, 90], ['straight', 300]]);
  const c = findCurves(line);
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.equal(c[0].dir, 'right');
  assert.equal(c[0].sharp, true);
  assert.ok(c[0].advised >= 35 && c[0].advised <= 45, `zalecana ${c[0].advised}`);
  assert.ok(c[0].angle >= 80 && c[0].angle <= 100, `kąt ${c[0].angle}`);
  assert.ok(c[0].along > 240 && c[0].along < 320, `początek ${c[0].along}`);
  const left = findCurves(build([['straight', 300], ['arc', 60, -90], ['straight', 300]]));
  assert.equal(left[0].dir, 'left');
});

test('zakręty: R=400 m (zalecana >100 km/h) bez ostrzeżenia, R=150 m to zakręt nieostry z zalecaną ok. 65', () => {
  assert.deepEqual(findCurves(build([['straight', 300], ['arc', 400, 45], ['straight', 300]])), []);
  const c = findCurves(build([['straight', 300], ['arc', 150, 60], ['straight', 300]]));
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.equal(c[0].sharp, false);
  assert.ok(c[0].advised >= 60 && c[0].advised <= 75, `zalecana ${c[0].advised}`);
});

test('zakręty: skręt na skrzyżowaniu (jest manewr) nie jest ostrzeżeniem o zakręcie', () => {
  const line = build([['straight', 300], ['arc', 20, 90], ['straight', 300]]);
  assert.equal(findCurves(line, []).length, 1);
  assert.equal(findCurves(line, [{ type: 'turn', at: 310 }]).length, 0);
  assert.equal(findCurves(line, [{ type: 'arrive', at: 600 }]).length, 1); // cel to nie skrzyżowanie
});

test('zakręty: seria przeciwnych łuków blisko siebie jest jednym ostrzeżeniem', () => {
  const line = build([['straight', 300], ['arc', 80, 70], ['straight', 40], ['arc', 80, -70], ['straight', 300]]);
  const c = findCurves(line);
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.equal(c[0].series, true);
  assert.equal(c[0].dir, null);
  assert.equal(describe(c[0], 200).title, 'Seria zakrętów');
});

test('punkty OSM: parsowanie i pakowanie', () => {
  const j = { elements: [
    { type: 'node', id: 1, lat: 51.2, lon: 22.5, tags: { railway: 'level_crossing', 'crossing:barrier': 'no' } },
    { type: 'node', id: 2, lat: 51.21, lon: 22.51, tags: { railway: 'level_crossing', 'crossing:barrier': 'full' } },
    { type: 'node', id: 3, lat: 51.22, lon: 22.52, tags: { traffic_calming: 'table' } },
    { type: 'node', id: 4, lat: 51.23, lon: 22.53, tags: { traffic_calming: 'chicane' } },
    { type: 'way', id: 5, center: { lat: 51.24, lon: 22.54 }, tags: { amenity: 'school' } },
    { type: 'node', id: 6, lat: 51.25, lon: 22.55, tags: { amenity: 'cafe' } },
  ] };
  const p = parseRoadPoints(j);
  assert.deepEqual(p.map((x) => x.k), ['rail', 'rail', 'bump', 'school']);
  assert.equal(p[0].f, 'nobarrier'); assert.equal(p[1].f, undefined);
  const back = unpackRoadPoints(packRoadPoints(p));
  assert.deepEqual(back.map((x) => [x.k, x.f]), p.map((x) => [x.k, x.f]));
  assert.ok(Math.abs(back[3].lat - 51.24) < 1e-5);
});

test('punkty przy trasie: tylko w zasięgu, szkoła szerzej, duplikaty scalone', () => {
  const line = build([['straight', 2000]]);
  const at = (m, off = 0) => { const p = destination(line.coords[0], 0, m); return destination(p, 90, off); };
  const mk = (k, m, off) => { const p = at(m, off); return { k, lat: p[1], lng: p[0] }; };
  const pts = [mk('rail', 500, 8), mk('bump', 800, 100), mk('bump', 1000, 5), mk('bump', 1015, 5), mk('school', 1500, 40), mk('rail', 5000, 0)];
  const on = pointsOnRoute(pts, line);
  assert.deepEqual(on.map((o) => o.kind), ['rail', 'bump', 'school']);
  assert.ok(Math.abs(on[0].along - 500) < 6, `rail ${on[0].along}`);
  assert.ok(Math.abs(on[1].along - 1000) < 6);
  assert.ok(Math.abs(on[2].along - 1500) < 6);
  assert.deepEqual(pointsOnRoute([], line), []);
});

test('obserwator: zakręt tylko gdy za szybko, przejazd zawsze, próg tylko >35 km/h, raz na obiekt', () => {
  const line = build([['straight', 1000], ['arc', 60, 90], ['straight', 600]]);
  const rail = destination(line.coords[0], 0, 500);
  const bump = destination(line.coords[0], 0, 700);
  const items = buildRoadItems({ line, steps: [] }, [{ k: 'rail', lat: rail[1], lng: rail[0] }, { k: 'bump', lat: bump[1], lng: bump[0] }]);
  assert.deepEqual(items.map((i) => i.kind), ['rail', 'bump', 'curve']);
  // wolno (20 km/h): przejazd tak, próg nie, zakręt nie
  const slow = new RoadWatch(items); const sayS = [];
  for (let a = 0; a < 1100; a += 5) sayS.push(...slow.update(a, 20 / 3.6).say);
  assert.equal(sayS.length, 1); assert.match(sayS[0], /^Przejazd kolejowy za /);
  // szybko (90 km/h): wszystko, po razie
  const fast = new RoadWatch(items); const sayF = [];
  for (let a = 0; a < 1100; a += 5) sayF.push(...fast.update(a, 25).say);
  assert.equal(sayF.length, 3, sayF.join(' | '));
  assert.match(sayF[2], /^Ostry zakręt w prawo za .+, zalecana prędkość (trzydzieści|czterdzieści)/);
  const again = []; for (let a = 0; a < 1100; a += 5) again.push(...fast.update(a, 25).say);
  assert.equal(again.length, 0);
  // ostry zakręt pokazuje się na pasku także gdy jedziesz zalecaną prędkością (bez głosu)
  const ok = new RoadWatch(items); const r = ok.update(900, 40 / 3.6);
  assert.equal(r.say.length, 0); assert.equal(r.ahead && r.ahead.kind, 'curve');
  // limit niższy od zalecanej: nie ostrzegamy głosem
  const lim = new RoadWatch(items); const s2 = [];
  for (let a = 800; a < 1100; a += 5) s2.push(...lim.update(a, 11, 30).say);
  assert.equal(s2.length, 0);
});

test('opisy: przejazd bez zapór i szkoła', () => {
  assert.equal(describe({ kind: 'rail', f: 'nobarrier' }, 300).sub, 'Bez zapór: rozejrzyj się');
  assert.match(describe({ kind: 'school' }, 120).say, /^Szkoła za sto/);
  assert.match(describe({ kind: 'bump' }, 100).say, /^Próg zwalniający za /);
});
