import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitdRows, toHazards } from '../tools/build-hazards.mjs';

const head = ['Lp.', 'Kod lokalizacji', 'Rodzaj urządzenia', 'Droga', 'Miejscowość', 'Limit prędkości [km/h]', 'Szerokość geograficzna', 'Długość geograficzna'];

test('GITD: osobne kolumny szerokość/długość, typy urządzeń i limity', () => {
  const rows = [
    ['Załącznik nr 1'], [''], head,
    [1, 'LUB.1.001', 'Fotoradar stacjonarny', 'DK19', 'Lublin', 50, 51.2465, 22.5684],
    [2, 'LUB.1.002', 'Rejestrator przejazdu na czerwonym świetle', 'ul. Zana', 'Lublin', 50, '51,2300', '22,5500'],
    [3, 'LUB.2.001', 'Odcinkowy pomiar prędkości', 'S17', 'A', 70, 51.1, 22.4],
    [4, 'LUB.2.001', 'Odcinkowy pomiar prędkości', 'S17', 'B', 70, 51.1, 22.6],
  ];
  const { items } = parseGitdRows(rows, 'czynne');
  assert.equal(items.length, 4);
  const h = toHazards(items);
  assert.equal(h.cameras.filter((c) => c.type === 'camera').length, 1);
  assert.equal(h.cameras.filter((c) => c.type === 'redlight').length, 1);
  assert.equal(h.cameras[0].limit, 50);
  assert.equal(h.sections.length, 1); // dwa punkty tej samej drogi sparowane w odcinek
  assert.equal(h.sections[0].limit, 70);
});

test('GITD: współrzędne w jednej komórce, w tym w odwrotnej kolejności, i stopnie z minutami', () => {
  const rows = [
    ['Rodzaj', 'Lokalizacja', 'Współrzędne', 'Ograniczenie'],
    ['fotoradar', 'x', '51.5, 21.0', 90],
    ['fotoradar', 'y', '19.9; 50.06', 60],
    ['fotoradar', 'z', '', 50],
  ];
  const { items, skipped } = parseGitdRows(rows);
  assert.equal(items.length, 2);
  assert.equal(skipped, 1);
  assert.ok(Math.abs(items[1].lat - 50.06) < 1e-6 && Math.abs(items[1].lng - 19.9) < 1e-6);
});

test('GITD: odcinek z kolumnami początek i koniec', () => {
  const rows = [
    ['Rodzaj urządzenia', 'Początek odcinka', 'Koniec odcinka', 'Limit'],
    ['odcinkowy pomiar prędkości', '51.1, 22.4', '51.1, 22.5', 70],
  ];
  const h = toHazards(parseGitdRows(rows).items);
  assert.equal(h.sections.length, 1);
  assert.deepEqual(h.sections[0].end, [22.5, 51.1]);
});
