import test from 'node:test';
import assert from 'node:assert/strict';
import { revealStops, TripRecorder, decimate, tripStats, speedStops, replayFrames, fitProjection, fmtTripTime } from '../js/trip.js';

const T0 = 1_700_000_000_000;
// jazda na wschód ze stałą prędkością v (m/s), co 1 s
function drive(rec, seconds, v, startLng = 22.5, t0 = T0, lat = 51.2) {
  const mLng = 111195 * Math.cos(lat * Math.PI / 180);
  for (let s = 0; s <= seconds; s++) rec.add({ lng: startLng + (v * s) / mLng, lat, speed: v, t: t0 + s * 1000, accuracy: 5 });
}

test('rejestrator: odległość, średnia, maksimum', () => {
  const r = new TripRecorder(); drive(r, 600, 20); // 12 km
  const s = r.summary();
  assert.ok(Math.abs(s.meters - 12000) < 60, s.meters);
  assert.ok(Math.abs(s.avgKmh - 72) < 1.5, s.avgKmh);
  assert.equal(s.maxKmh, 72);
  assert.ok(r.pts.length > 500 && r.pts.length <= 601, r.pts.length); // co ~20 m
  const slow = new TripRecorder(); drive(slow, 600, 5); // 5 m/s: punkt co ~12 m, nie co sekundę
  assert.ok(slow.pts.length < 300 && slow.pts.length > 150, slow.pts.length);
});

test('postoje: 2 min stania to jeden postój, a czas ruchu go nie zawiera', () => {
  const r = new TripRecorder(); drive(r, 100, 15);
  const endLng = r.pts[r.pts.length - 1].lng;
  for (let s = 101; s <= 220; s++) r.add({ lng: endLng, lat: 51.2, speed: 0, t: T0 + s * 1000, accuracy: 5 });
  drive(r, 100, 15, endLng, T0 + 221 * 1000);
  const s = r.summary();
  assert.equal(s.stops, 1);
  assert.ok(s.longestStopMs >= 100000 && s.longestStopMs <= 125000, s.longestStopMs);
  assert.ok(s.movingMs < s.totalMs - 100000);
});

test('rejestrator odrzuca zły GPS i teleporty, a lista nie rośnie bez końca', () => {
  const r = new TripRecorder({ maxPts: 100 });
  assert.equal(r.add({ lng: 22.5, lat: 51.2, speed: 10, t: T0, accuracy: 200 }), false);
  r.add({ lng: 22.5, lat: 51.2, speed: 10, t: T0, accuracy: 5 });
  assert.equal(r.add({ lng: 23.5, lat: 51.2, speed: 10, t: T0 + 1000, accuracy: 5 }), false); // 70 km w 1 s
  drive(r, 5000, 30, 22.5, T0 + 10000);
  assert.ok(r.pts.length <= 100);
});

test('zapis i odczyt śladu', () => {
  const r = new TripRecorder(); drive(r, 3000, 20);
  const j = JSON.parse(JSON.stringify(r.toJSON()));
  assert.ok(j.pts.length <= 600);
  const back = TripRecorder.fromJSON(j);
  assert.ok(Math.abs(back.summary().meters - r.summary().meters) / r.summary().meters < 0.02);
  assert.equal(decimate([1, 2, 3], 5).length, 3);
});

test('gradient prędkości: rosnące przystanki i kolory zależne od prędkości', () => {
  const r = new TripRecorder(); drive(r, 300, 8); drive(r, 300, 30, r.pts[r.pts.length - 1].lng, T0 + 301000);
  const st = speedStops(r.pts, 40);
  assert.equal(st[0][0], 0); assert.equal(st[st.length - 1][0], 1);
  for (let i = 1; i < st.length; i++) assert.ok(st[i][0] > st[i - 1][0]);
  assert.notEqual(st[2][1], st[st.length - 3][1]);
});

test('klatki przelotu: równo po śladzie, kierunek wygładzony, brak skoków', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ lng: 22.5 + i * 0.0005, lat: 51.2, t: T0 + i * 1000, v: 10 });
  for (let i = 1; i <= 100; i++) pts.push({ lng: 22.55, lat: 51.2 + i * 0.0004, t: T0 + (100 + i) * 1000, v: 10 }); // zakręt w lewo
  const f = replayFrames(pts, 120);
  assert.equal(f.length, 120);
  assert.equal(f[0].progress, 0); assert.ok(Math.abs(f[119].progress - 1) < 1e-9);
  assert.ok(Math.abs(f[2].bearing - 90) < 8);
  assert.ok(Math.abs(f[118].bearing - 0) < 8 || Math.abs(f[118].bearing - 360) < 8);
  for (let i = 1; i < f.length; i++) { const d = Math.abs(((f[i].bearing - f[i - 1].bearing + 540) % 360) - 180); assert.ok(d < 25, `skok kamery ${d}`); }
  assert.deepEqual(replayFrames([pts[0]], 10), []);
});

test('rzut na plakat mieści ślad w ramce; formatowanie czasu', () => {
  const pts = [{ lng: 22.5, lat: 51.2 }, { lng: 22.7, lat: 51.3 }, { lng: 22.6, lat: 51.1 }];
  const proj = fitProjection(pts, 1000, 600, 50);
  for (const p of pts) { const [x, y] = proj(p); assert.ok(x >= 49 && x <= 951 && y >= 49 && y <= 551); }
  assert.equal(fmtTripTime(25 * 60000), '25 min'); assert.equal(fmtTripTime(75 * 60000), '1 h 15 min');
  assert.equal(tripStats([]).meters, 0);
});

test('odsłanianie śladu: kolor do postępu, dalej przezroczysty, przystanki rosnące', () => {
  const st = [[0, '#111111'], [0.5, '#222222'], [1, '#333333']];
  const r = revealStops(st, 0.6);
  assert.equal(r[0][0], 0);
  for (let i = 1; i < r.length; i++) assert.ok(r[i][0] > r[i - 1][0], JSON.stringify(r));
  assert.equal(r[r.length - 1][1], 'rgba(0,0,0,0)');
  assert.equal(revealStops(st, 1)[revealStops(st, 1).length - 1][1], '#333333');
  const tiny = revealStops(st, 0);
  for (let i = 1; i < tiny.length; i++) assert.ok(tiny[i][0] > tiny[i - 1][0]);
});
