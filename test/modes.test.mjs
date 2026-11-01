import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeOf, DEFAULT_MODE } from '../js/modes.js';
import { valhallaRequest } from '../js/valhalla.js';

test('tryby podróży mają komplet ustawień i mapują się na costing Valhalli', () => {
  for (const m of Object.values(MODES)) {
    for (const k of ['id', 'label', 'costing', 'hazards', 'limits', 'guide', 'say', 'zoom', 'pitch']) assert.ok(k in m, `${m.id}: brak ${k}`);
    assert.equal(valhallaRequest([[1, 2], [3, 4]], { costing: m.costing }).costing, m.costing);
  }
  assert.equal(modeOf('nieznany').id, DEFAULT_MODE);
  assert.equal(MODES.pedestrian.hazards, false);
  assert.equal(MODES.auto.hazards, true);
});
