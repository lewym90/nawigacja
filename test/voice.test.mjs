import test from 'node:test';
import assert from 'node:assert/strict';

// Atrapa syntezatora: nigdy nie zgłasza końca wypowiedzi (tak potrafi się zachować Safari).
const spoken = [];
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.speechSynthesis = { getVoices: () => [{ lang: 'pl-PL', name: 'Zosia' }], speak: (u) => spoken.push(u.text), cancel() {}, addEventListener() {} };
const { Voice } = await import('../js/voice.js');

test('kolejka nie zawiesza się, gdy przeglądarka nie zgłosi końca wypowiedzi', async () => {
  const v = new Voice({ maxUtteranceMs: 30 });
  v.say('pierwsza');
  v.say('druga');
  assert.deepEqual(spoken, ['pierwsza']);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(spoken.includes('druga'), `wypowiedziano: ${spoken.join(', ')}`);
});

test('wyłączony głos nic nie mówi, a test diagnostyczny zgłasza polski głos', () => {
  const v = new Voice();
  const n = spoken.length;
  v.enabled = false;
  v.say('cicho');
  assert.equal(spoken.length, n);
  assert.equal(v.test().pl, 'Zosia');
});
