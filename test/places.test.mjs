import test from 'node:test';
import assert from 'node:assert/strict';
import { Places } from '../js/places.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
const W = { main: 'Warszawa', sub: 'mazowieckie', lng: 21.01, lat: 52.23 };

test('ostatnie cele: maksymalnie 5, najnowszy pierwszy, bez dubli', () => {
  const p = new Places(mem());
  for (let i = 0; i < 7; i++) p.addRecent({ main: `Miejsce ${i}`, sub: '', lng: 20 + i, lat: 50 + i });
  assert.equal(p.recents().length, 5);
  assert.equal(p.recents()[0].main, 'Miejsce 6');
  p.addRecent(W); p.addRecent(W); p.addRecent({ ...W, lng: 21.0105 });
  assert.equal(p.recents().filter((x) => x.main === 'Warszawa').length, 1);
  assert.equal(p.recents()[0].main, 'Warszawa');
});

test('moje adresy: dom i praca po jednym, inne z własną nazwą, usuwanie', () => {
  const p = new Places(mem());
  p.save('home', W);
  p.save('home', { ...W, main: 'Nowy dom', lng: 22.5, lat: 51.2 });
  p.save('work', W);
  p.save('other', W, 'Rodzice');
  p.save('other', W, 'rodzice');
  const s = p.saved();
  assert.deepEqual(s.map((x) => x.label), ['Dom', 'Praca', 'rodzice']);
  assert.equal(s[0].main, 'Nowy dom');
  p.removeSaved(s[1].id);
  assert.equal(p.saved().length, 2);
});

test('uszkodzone dane w pamięci nie psują listy', () => {
  const st = mem(); st.setItem('nav.recents', '{zepsute'); st.setItem('nav.saved', '"x"');
  const p = new Places(st);
  assert.deepEqual(p.recents(), []);
  assert.deepEqual(p.saved(), []);
});
