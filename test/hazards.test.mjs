import test from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../js/geo.js';
import { parseOverpass, mergeHazards, onRoute, sectionsOnRoute, HazardWatch, SectionTracker, ReportStore, overpassQuery } from '../js/hazards.js';
import { fakeRoute } from './helpers.mjs';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test('parseOverpass: fotoradary, kamery na światłach i odcinek z relacji', () => {
  const json = {
    elements: [
      { type: 'node', id: 1, lat: 51.21, lon: 22.55, tags: { highway: 'speed_camera', maxspeed: '50', direction: '0' } },
      { type: 'node', id: 2, lat: 51.22, lon: 22.55, tags: { enforcement: 'traffic_signals' } },
      { type: 'node', id: 3, lat: 51.23, lon: 22.55 },
      { type: 'node', id: 4, lat: 51.24, lon: 22.55 },
      { type: 'node', id: 5, lat: 51.25, lon: 22.55, tags: { highway: 'bus_stop' } },
      {
        type: 'relation', id: 9, tags: { type: 'enforcement', enforcement: 'average_speed', maxspeed: '70' },
        members: [{ type: 'node', ref: 3, role: 'from' }, { type: 'node', ref: 4, role: 'to' }],
      },
    ],
  };
  const r = parseOverpass(json);
  assert.equal(r.cameras.length, 2);
  assert.equal(r.cameras[0].limit, 50);
  assert.equal(r.cameras[0].dir, 0);
  assert.equal(r.cameras[1].type, 'redlight');
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].limit, 70);
  assert.deepEqual(r.sections[0].start, [22.55, 51.23]);
});

test('parseOverpass: puste i błędne dane nie wywracają programu', () => {
  assert.deepEqual(parseOverpass(null), { cameras: [], sections: [] });
  assert.deepEqual(parseOverpass({ elements: [{ type: 'relation', id: 1, tags: {}, members: [] }] }), { cameras: [], sections: [] });
});

test('overpassQuery zawiera obwiednię w kolejności S,W,N,E', () => {
  const q = overpassQuery([22.5, 51.2, 22.6, 51.3]);
  assert.match(q, /51\.20000,22\.50000,51\.30000,22\.60000/);
});

test('mergeHazards: własna warstwa wygrywa i potrafi wyciszyć wpis OSM', () => {
  const osm = { cameras: [{ id: 'osm:n1', type: 'camera', lng: 1, lat: 1, limit: 50 }, { id: 'osm:n2', type: 'camera', lng: 2, lat: 2 }], sections: [] };
  const local = { cameras: [{ id: 'osm:n1', type: 'camera', lng: 1, lat: 1, limit: 40 }], sections: [], suppress: ['osm:n2'] };
  const m = mergeHazards(osm, local);
  assert.equal(m.cameras.length, 1);
  assert.equal(m.cameras[0].limit, 40);
  assert.equal(m.cameras[0].source, 'own');
});

test('onRoute: bierze punkty przy trasie, odrzuca dalekie i prostopadłe', () => {
  const route = fakeRoute();
  const at = (along, off = 0, brg = 90) => destination(route.line.coords[Math.round(along / 100)], brg, off);
  const near = at(3000, 10);
  const far = at(3000, 200);
  const perp = at(3000, 5);
  const items = [
    { id: 'a', type: 'camera', lng: near[0], lat: near[1] },
    { id: 'b', type: 'camera', lng: far[0], lat: far[1] },
    { id: 'c', type: 'camera', lng: perp[0], lat: perp[1], dir: 90 }, // trasa idzie na północ: kamera patrzy na wschód
  ];
  const res = onRoute(route, items);
  assert.deepEqual(res.map((r) => r.id), ['a']);
  assert.ok(Math.abs(res[0].along - 3000) < 5);
});

test('onRoute: kierunek zgodny lub przeciwny jest dopuszczony', () => {
  const route = fakeRoute();
  const p = route.line.coords[30];
  const res = onRoute(route, [
    { id: 'n', type: 'camera', lng: p[0], lat: p[1], dir: 0 },
    { id: 's', type: 'camera', lng: p[0], lat: p[1], dir: 180 },
  ]);
  assert.equal(res.length, 2);
});

test('HazardWatch: ostrzega raz na poziom, mówi limit, ostrzega o prędkości', () => {
  const items = [{ id: 'c1', type: 'camera', along: 3000, limit: 50 }];
  const w = new HazardWatch(items);
  const said = [];
  let finalSeen = false;
  for (let a = 2000; a <= 3100; a += 20) {
    const r = w.update(a, 16 /* 57,6 km/h */);
    said.push(...r.say);
    if (r.level === 'final') finalSeen = true;
  }
  assert.ok(finalSeen);
  assert.equal(said.filter((s) => /^Fotoradar za/.test(s)).length, 1);
  assert.ok(said.some((s) => /limit 50/.test(s)));
  assert.equal(said.filter((s) => /^Zwolnij/.test(s)).length, 1);
});

test('HazardWatch: jadąc zgodnie z limitem nie każe zwalniać', () => {
  const w = new HazardWatch([{ id: 'c1', type: 'camera', along: 1000, limit: 50 }]);
  const said = [];
  for (let a = 500; a <= 1100; a += 20) said.push(...w.update(a, 13 /* 46,8 km/h */).say);
  assert.equal(said.filter((s) => /^Zwolnij/.test(s)).length, 0);
});

test('HazardWatch: miniętych punktów już nie pokazuje', () => {
  const w = new HazardWatch([{ id: 'c1', type: 'camera', along: 1000 }]);
  assert.equal(w.update(1200, 10).ahead.length, 0);
});

test('sectionsOnRoute: tylko w kierunku jazdy i na trasie', () => {
  const route = fakeRoute();
  const s1 = { id: 's1', type: 'section', start: route.line.coords[20], end: route.line.coords[40], limit: 70 };
  const s2 = { id: 's2', type: 'section', start: route.line.coords[40], end: route.line.coords[20], limit: 70 };
  const res = sectionsOnRoute(route, [s1, s2]);
  assert.deepEqual(res.map((s) => s.id), ['s1']);
  assert.ok(Math.abs(res[0].length - 2000) < 5);
});

test('SectionTracker: średnia i dozwolona prędkość na reszcie odcinka', () => {
  // Odcinek 2000 m, limit 72 km/h (20 m/s): budżet czasu to 100 s.
  const s = { startAlong: 1000, endAlong: 3000, length: 2000 };
  const t = new SectionTracker(s, 72);
  t.update(900, 0);
  // Wjazd o t=10 s (jedziemy 25 m/s od 900 m: 1000 m osiągamy po 4 s => próbki co 1 s)
  let st;
  let tt = 0;
  for (let a = 900; a <= 1500; a += 25) { st = t.update(a, tt * 1000); tt++; }
  assert.equal(st.phase, 'inside');
  assert.ok(st.over, 'jazda 25 m/s = 90 km/h przy limicie 72 powinna przekraczać średnią');
  assert.ok(st.allowedKmh < 72, `na reszcie trzeba zwolnić poniżej limitu, jest ${st.allowedKmh}`);
  // Dokończ odcinek z prędkością dozwoloną: średnia powinna zejść do limitu.
  const v = (st.allowedKmh / 3.6);
  let a = 1500;
  while (t.phase !== 'done') { a += v; st = t.update(Math.min(a, 3001), tt * 1000); tt++; }
  assert.ok(Math.abs(st.avgKmh - 72) < 2, `średnia końcowa ${st.avgKmh}`);
});

test('SectionTracker: spokojna jazda poniżej limitu nie przekracza', () => {
  const s = { startAlong: 500, endAlong: 1500, length: 1000 };
  const t = new SectionTracker(s, 70);
  let st;
  for (let i = 0; i <= 100; i++) st = t.update(i * 18, i * 1000); // 18 m/s = 64,8 km/h
  assert.equal(st.phase, 'done');
  assert.equal(st.over, false);
  assert.ok(Math.abs(st.avgKmh - 64.8) < 1);
});

test('ReportStore: zgłoszenia wygasają i przeżywają ponowne uruchomienie', () => {
  const storage = mem();
  const a = new ReportStore(storage);
  const now = 1_000_000_000_000;
  a.add('police', 22.5, 51.2, now);
  a.add('accident', 22.6, 51.2, now);
  const b = new ReportStore(storage);
  assert.equal(b.active(now + 60 * 60000).length, 2);
  assert.deepEqual(b.active(now + 100 * 60000).map((i) => i.type), ['accident']); // policja wygasa po 90 min
});

test('mergeSources: ten sam fotoradar z OSM i GITD to jeden punkt, z uzupełnionym limitem', async () => {
  const { mergeSources } = await import('../js/hazards.js');
  const osm = { cameras: [{ id: 'osm:n1', type: 'camera', lng: 22.5, lat: 51.2, limit: null, dir: 90, source: 'osm' }], sections: [] };
  const gitd = {
    cameras: [
      { id: 'gitd:1', type: 'camera', lng: 22.50015, lat: 51.20008, limit: 50, dir: null, source: 'gitd' }, // ok. 14 m dalej
      { id: 'gitd:2', type: 'camera', lng: 22.6, lat: 51.2, limit: 70, source: 'gitd' },
    ],
    sections: [],
  };
  const m = mergeSources([osm, gitd], null);
  assert.equal(m.cameras.length, 2);
  const a = m.cameras.find((c) => c.id === 'osm:n1');
  assert.equal(a.limit, 50);
  assert.equal(a.dir, 90);
});

test('mergeSources: odcinki o tych samych końcach z dwóch źródeł łączą się, suppress działa', async () => {
  const { mergeSources } = await import('../js/hazards.js');
  const a = { cameras: [], sections: [{ id: 'osm:r1', type: 'section', start: [22.5, 51.2], end: [22.52, 51.2], limit: null }] };
  const b = { cameras: [{ id: 'gitd:9', type: 'camera', lng: 23, lat: 51, source: 'gitd' }], sections: [{ id: 'gitd:s1', type: 'section', start: [22.5002, 51.2001], end: [22.5201, 51.2], limit: 70 }] };
  const m = mergeSources([a, b], { suppress: ['gitd:9'] });
  assert.equal(m.sections.length, 1);
  assert.equal(m.sections[0].limit, 70);
  assert.equal(m.cameras.length, 0);
});
