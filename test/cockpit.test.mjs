import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLine, destination, haversine, bearing } from '../js/geo.js';
import {
  sunPosition, atmosphere, limitColor, routeGradient, gradientExpr, maneuverArrow, wantsArrow,
  lookAheadBearing, signedAngle, turnZoomBoost, speedRing,
} from '../js/cockpit.js';

const LUBLIN = [51.2465, 22.5684];

test('słońce: południe słoneczne w Lublinie latem i zimą', () => {
  // południe słoneczne ~ 12:00 UTC - 22,57°/15 h = 10:29 UTC; wysokość = 90 - szerokość + deklinacja
  const summer = sunPosition(new Date('2026-06-21T10:29:00Z'), ...LUBLIN);
  assert.ok(Math.abs(summer.altitude - 62.2) < 1.2, `lato: ${summer.altitude}`);
  assert.ok(Math.abs(summer.azimuth - 180) < 6, `azymut ${summer.azimuth}`);
  const winter = sunPosition(new Date('2026-12-21T10:29:00Z'), ...LUBLIN);
  assert.ok(Math.abs(winter.altitude - 15.3) < 1.2, `zima: ${winter.altitude}`);
  const night = sunPosition(new Date('2026-11-02T00:30:00Z'), ...LUBLIN);
  assert.ok(night.altitude < -20);
});

test('atmosfera: noc zimna i ciemna, dzień ciepły ze słońcem po właściwej stronie', () => {
  const n = atmosphere(true, new Date('2026-11-02T20:00:00Z'), ...LUBLIN);
  assert.ok(n.light.intensity < 0.4 && n.sky['sky-color'] === '#040716');
  const d = atmosphere(false, new Date('2026-06-21T10:29:00Z'), ...LUBLIN);
  assert.ok(Math.abs(d.light.position[1] - 180) < 6);
  assert.ok(d.light.position[2] > 20 && d.light.position[2] < 45); // polar = 90 - wysokość
  const low = atmosphere(false, new Date('2026-11-02T15:00:00Z'), ...LUBLIN); // ~16:00 lokalnie, słońce nisko
  assert.equal(low.light.color, '#ffd3a0');
});

test('kolor wg limitu: skala rośnie, brak limitu = zwykły kolor', () => {
  assert.equal(limitColor(null, '#123456'), '#123456');
  assert.equal(limitColor(10), limitColor(20));
  assert.equal(limitColor(50), '#4cb8ff');
  assert.equal(limitColor(140), '#ff4f9a');
  assert.equal(limitColor(200), '#ff4f9a');
  assert.notEqual(limitColor(60), limitColor(50));
  assert.match(limitColor(80), /^#[0-9a-f]{6}$/);
});

function straightRoute(len, limits) {
  const coords = [[22.5, 51.2]];
  for (let m = 100; m <= len; m += 100) coords.push(destination(coords[0], 0, m));
  const line = buildLine(coords);
  return { line, distance: line.total, limits };
}

test('gradient trasy: ściśle rosnący 0..1, kolory wg limitu, scalanie krótkich odcinków', () => {
  const r = straightRoute(5000, [
    { from: 0, to: 1000, kmh: 50 }, { from: 1000, to: 1060, kmh: 30 }, { from: 1060, to: 3000, kmh: 50 }, { from: 3000, to: 5000, kmh: 90 },
  ]);
  const s = routeGradient(r);
  assert.equal(s[0][0], 0); assert.equal(s[s.length - 1][0], 1);
  for (let i = 1; i < s.length; i++) assert.ok(s[i][0] > s[i - 1][0], `rośnie przy ${i}`);
  assert.equal(s[0][1], limitColor(50)); // 60 m przy 30 km/h scalone w sąsiedni kolor
  assert.equal(s[s.length - 1][1], limitColor(90));
  assert.equal(s.some(([, c]) => c === limitColor(30)), false);
  const expr = gradientExpr(s);
  assert.deepEqual(expr.slice(0, 3), ['interpolate', ['linear'], ['line-progress']]);
  assert.equal(expr.length, 3 + s.length * 2);
});

test('gradient trasy: bez limitów i bez kolorowania zwykły kolor; przejechany fragment znika', () => {
  const r = straightRoute(2000, null);
  const plain = routeGradient(r, { plain: '#abcdef' });
  assert.ok(plain.every(([, c]) => c === '#abcdef'));
  const lim = straightRoute(2000, [{ from: 0, to: 2000, kmh: 70 }]);
  const off = routeGradient(lim, { colorByLimit: false, plain: '#111111' });
  assert.ok(off.every(([, c]) => c === '#111111'));
  const eaten = routeGradient(lim, { consumed: 500 });
  assert.equal(eaten[0][1], 'rgba(0,0,0,0)');
  const cutP = eaten.find(([, c]) => c !== 'rgba(0,0,0,0)')[0];
  assert.ok(Math.abs(cutP - 0.25) < 0.001, `cięcie przy ${cutP}`);
  for (let i = 1; i < eaten.length; i++) assert.ok(eaten[i][0] > eaten[i - 1][0]);
});

test('strzałka na jezdni: trzon wzdłuż trasy, grot na końcu skierowany zgodnie z trasą', () => {
  const r = straightRoute(1000, null);
  const a = maneuverArrow(r.line, 500);
  assert.ok(a && a.shaft.length >= 2 && a.head.length === 4);
  assert.deepEqual(a.head[0], a.head[3]);
  const tip = a.head[1];
  const lastShaft = a.shaft[a.shaft.length - 1];
  assert.ok(tip[1] > lastShaft[1]); // trasa na północ, grot dalej na północ niż koniec trzonu
  const len = haversine(a.shaft[0], tip);
  assert.ok(len > 38 && len < 55, `długość ${len}`);
  const width = haversine(a.head[0], a.head[2]);
  assert.ok(width > 8 && width < 12);
  assert.equal(maneuverArrow(r.line, 3, { before: 1, after: 2 }), null); // za krótka
});

test('wantsArrow: skręty tak, prosto i cel nie', () => {
  assert.equal(wantsArrow({ type: 'turn', modifier: 'right' }), true);
  assert.equal(wantsArrow({ type: 'roundabout' }), true);
  assert.equal(wantsArrow({ type: 'turn', modifier: 'straight' }), false);
  assert.equal(wantsArrow({ type: 'arrive' }), false);
  assert.equal(wantsArrow(null), false);
});

test('kamera patrzy w zakręt, ale o ograniczony kąt', () => {
  // trasa: 300 m na północ, potem ostro na wschód
  const p0 = [22.5, 51.2]; const p1 = destination(p0, 0, 300); const p2 = destination(p1, 90, 600);
  const line = buildLine([p0, destination(p0, 0, 100), destination(p0, 0, 200), p1, destination(p1, 90, 100), destination(p1, 90, 300), p2]);
  const route = { line, distance: line.total };
  const far = lookAheadBearing(route, 20, 0);
  assert.ok(far < 5 || far > 355, 'daleko od zakrętu: bez zmiany'); // 20+120 m jeszcze prosto
  const near = lookAheadBearing(route, 260, 0);
  assert.ok(near > 15 && near <= 55, `przy zakręcie: ${near}`);
  const way = lookAheadBearing(route, 260, 350); // GPS już skręca w lewo, trasa w prawo: nadal max 55°
  assert.ok(Math.abs(signedAngle(350, way)) <= 55.01);
  assert.equal(lookAheadBearing({ line: { total: 10 } }, 0, 77), 77);
});

test('signedAngle i dodatkowy zoom przed skrętem', () => {
  assert.equal(signedAngle(350, 10), 20);
  assert.equal(signedAngle(10, 350), -20);
  assert.equal(turnZoomBoost(300, { type: 'turn', modifier: 'left' }), 0);
  assert.equal(turnZoomBoost(10, { type: 'turn', modifier: 'left' }), 0.35);
  const mid = turnZoomBoost(120, { type: 'turn', modifier: 'left' });
  assert.ok(mid > 0 && mid < 0.35);
  assert.equal(turnZoomBoost(10, { type: 'arrive' }), 0);
});

test('pierścień prędkości: stany względem limitu, limit na 80% skali', () => {
  assert.deepEqual(speedRing(40, 50), { pct: 64, state: 'ok', notch: 80 });
  assert.equal(speedRing(48, 50).state, 'near');
  assert.equal(speedRing(54, 50).state, 'over');
  assert.equal(speedRing(65, 50).state, 'way');
  assert.equal(speedRing(50, 50).pct, 80);
  assert.equal(speedRing(300, 50).pct, 100);
  const nl = speedRing(70, null);
  assert.equal(nl.state, 'ok'); assert.equal(nl.notch, null); assert.equal(nl.pct, 50);
});
