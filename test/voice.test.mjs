import test from 'node:test';
import assert from 'node:assert/strict';

// Atrapa syntezatora: nigdy nie zgłasza końca wypowiedzi (tak potrafi się zachować Safari).
const spoken = [];
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.speechSynthesis = { getVoices: () => [{ lang: 'pl-PL', name: 'Zosia' }], speak: (u) => spoken.push(u.text), cancel() {}, addEventListener() {} };
const { Voice } = await import('../js/voice.js');

test('kolejka nie zawiesza się, gdy przeglądarka nie zgłosi końca wypowiedzi', async () => {
  const v = new Voice({ maxUtteranceMs: 30 }); v.engine = 'system';
  v.say('pierwsza');
  v.say('druga');
  assert.deepEqual(spoken, ['pierwsza']);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(spoken.includes('druga'), `wypowiedziano: ${spoken.join(', ')}`);
});

test('wyłączony głos nic nie mówi, a test diagnostyczny zgłasza polski głos', () => {
  const v = new Voice(); v.engine = 'system';
  const n = spoken.length;
  v.enabled = false;
  v.say('cicho');
  assert.equal(spoken.length, n);
  assert.equal(v.test().pl, 'Zosia');
});

test('toneWavUri: poprawny nagłówek WAV i długość', async () => {
  const { toneWavUri } = await import('../js/voice.js');
  const uri = toneWavUri(880, 100, 8000);
  assert.match(uri, /^data:audio\/wav;base64,/);
  const bytes = Buffer.from(uri.split(',')[1], 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(40), 800 * 2); // 100 ms przy 8 kHz, 16 bitów
  assert.equal(bytes.length, 44 + 1600);
});
