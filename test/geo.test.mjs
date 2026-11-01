import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, bearing, angleDiff, destination, buildLine, project, pointAt, bbox } from '../js/geo.js';

test('haversine: 1 stopień szerokości to ok. 111,2 km', () => {
  const d = haversine([20, 50], [20, 51]);
  assert.ok(Math.abs(d - 111195) < 200);
});

test('bearing: północ, wschód, południe', () => {
  assert.ok(Math.abs(bearing([20, 50], [20, 51]) - 0) < 0.01);
  assert.ok(Math.abs(bearing([20, 50], [21, 50]) - 90) < 0.5);
  assert.ok(Math.abs(bearing([20, 51], [20, 50]) - 180) < 0.01);
});

test('angleDiff przechodzi przez 0/360', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
});

test('destination i haversine są spójne', () => {
  const p = destination([22.5, 51.2], 37, 1234);
  assert.ok(Math.abs(haversine([22.5, 51.2], p) - 1234) < 1);
});

test('project: punkt obok linii daje właściwą odległość i położenie', () => {
  const a = [22.5, 51.2];
  const line = buildLine([a, destination(a, 0, 1000), destination(destination(a, 0, 1000), 90, 1000)]);
  const off = destination(destination(a, 0, 400), 90, 25); // 25 m na wschód od osi
  const p = project(line, off);
  assert.ok(Math.abs(p.dist - 25) < 1);
  assert.ok(Math.abs(p.along - 400) < 2);
});

test('project z podpowiedzią daje ten sam wynik co pełne przeszukanie', () => {
  const a = [22.5, 51.2];
  const pts = [a];
  for (let i = 1; i <= 200; i++) pts.push(destination(a, 10 + i * 0.1, i * 50));
  const line = buildLine(pts);
  const q = destination(pts[120], 100, 8);
  const full = project(line, q);
  const hinted = project(line, q, 118);
  assert.equal(full.idx, hinted.idx);
  assert.ok(Math.abs(full.along - hinted.along) < 0.01);
});

test('project: podpowiedź z dala od prawdy nie psuje wyniku', () => {
  const a = [22.5, 51.2];
  const pts = [a];
  for (let i = 1; i <= 200; i++) pts.push(destination(a, 0, i * 50));
  const line = buildLine(pts);
  const q = destination(pts[180], 90, 5);
  assert.equal(project(line, q, 5).idx, 180);
});

test('pointAt: odwrotność project', () => {
  const a = [22.5, 51.2];
  const line = buildLine([a, destination(a, 0, 1000), destination(destination(a, 0, 1000), 90, 1000)]);
  const p = pointAt(line, 1500);
  assert.ok(Math.abs(haversine(p.point, destination(destination(a, 0, 1000), 90, 500)) ) < 1);
  assert.ok(Math.abs(p.bearing - 90) < 1);
});

test('bbox zawiera punkty z marginesem', () => {
  const b = bbox([[22.5, 51.2], [22.6, 51.3]], 500);
  assert.ok(b[0] < 22.5 && b[1] < 51.2 && b[2] > 22.6 && b[3] > 51.3);
});
