import test from 'node:test';
import assert from 'node:assert/strict';
import { Voice } from '../js/voice.js';

test('silnik chmury: gdy serwer nie odpowiada, mówi głos telefonu i po 2 błędach wstrzymuje chmurę', async () => {
  const spoken = [];
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.speechSynthesis = { getVoices: () => [], speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 1); }, cancel() {}, paused: false, speaking: false };
  globalThis.fetch = async () => { throw new Error('offline'); };
  const v = new Voice();
  v.engine = 'cloud'; v.cloudUrl = 'https://x.test/nav-tts';
  v.say('Skręć w lewo'); await new Promise((r) => setTimeout(r, 40));
  v.say('Skręć w prawo'); await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(spoken, ['Skręć w lewo', 'Skręć w prawo']);
  assert.ok(v.cloudBlockedUntil > Date.now());
  v.say('Ruszaj'); await new Promise((r) => setTimeout(r, 40));
  assert.equal(spoken.length, 3);
});
