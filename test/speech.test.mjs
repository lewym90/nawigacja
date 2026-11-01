import test from 'node:test';
import assert from 'node:assert/strict';
import { plNum, distWords, intoSuffix, intoPhrase, parseRoadRef, forSpeech, isFemAdjective, withPauses } from '../js/speech-pl.js';

test('liczby słownie', () => {
  assert.equal(plNum(0), 'zero');
  assert.equal(plNum(13), 'trzynaście');
  assert.equal(plNum(21), 'dwadzieścia jeden');
  assert.equal(plNum(848), 'osiemset czterdzieści osiem');
  assert.equal(plNum(2012), 'dwa tysiące dwanaście');
  assert.equal(plNum(1000), 'tysiąc');
});

test('odległości z poprawną odmianą', () => {
  assert.equal(distWords(900), 'dziewięćset metrów');
  assert.equal(distWords(1240), 'tysiąc dwieście pięćdziesiąt metrów');
  assert.equal(distWords(2500), 'dwa i pół kilometra');
  assert.equal(distWords(3100), 'trzy kilometry');
  assert.equal(distWords(12400), 'dwanaście kilometrów');
  assert.equal(distWords(22000), 'dwadzieścia dwa kilometry');
  assert.equal(distWords(1500 + 600), 'dwa kilometry'); // 2,1 km -> 2 km
});

test('odmiana nazw ulic: biernik', () => {
  assert.equal(intoSuffix('Krężnicka'), ' w ulicę Krężnicką');
  assert.equal(intoSuffix('Północna'), ' w ulicę Północną');
  assert.equal(intoSuffix('Diamentowa'), ' w ulicę Diamentową');
  assert.equal(intoSuffix('Szymanowskiego'), ' w ulicę Szymanowskiego');
  assert.equal(intoSuffix('Narutowicza'), ' w ulicę Narutowicza');
  assert.equal(intoSuffix('Mickiewicza'), ' w ulicę Mickiewicza');
  assert.equal(intoSuffix('Armii Krajowej'), ' w ulicę Armii Krajowej');
  assert.equal(intoSuffix('Marii Curie-Skłodowskiej'), ' w ulicę Marii Curie-Skłodowskiej');
  assert.equal(intoSuffix('Aleja Warszawska'), ' w aleję Warszawską');
  assert.equal(intoSuffix('Aleja Unii Lubelskiej'), ' w aleję Unii Lubelskiej');
  assert.equal(intoSuffix('Plac Litewski'), ' na plac Litewski');
  assert.equal(intoSuffix('Rondo Dmowskiego'), ' na rondo Dmowskiego');
  assert.equal(intoSuffix(''), '');
});

test('numery dróg', () => {
  assert.deepEqual(parseRoadRef('DK17'), { kind: 'krajowa', num: 17 });
  assert.deepEqual(parseRoadRef('S17'), { kind: 'ekspresowa', letter: 'S', num: 17 });
  assert.deepEqual(parseRoadRef('A2'), { kind: 'autostrada', letter: 'A', num: 2 });
  assert.deepEqual(parseRoadRef('848'), { kind: 'wojewodzka', num: 848 });
  assert.equal(intoSuffix('', '848'), ' w drogę wojewódzką 848');
  assert.equal(intoSuffix('', 'A2'), ' w autostradę A2');
  assert.equal(intoPhrase('', ''), null);
});

test('przymiotniki żeńskie rozpoznane, nazwiska nie', () => {
  for (const w of ['Lubelska', 'Zemborzycka', 'Osmolicka', 'Długa', 'Wschodnia', 'Rzeczna']) assert.ok(isFemAdjective(w), w);
  for (const w of ['Kopernika', 'Chopina', 'Wyzwolenia', 'Mickiewicza', 'Narutowicza']) assert.ok(!isFemAdjective(w), w);
});

test('forSpeech: cyfry, jednostki i skróty', () => {
  assert.equal(forSpeech('limit 70 km/h'), 'limit siedemdziesiąt kilometrów na godzinę');
  assert.equal(forSpeech('w drogę wojewódzką 848'), 'w drogę wojewódzką osiemset czterdzieści osiem');
  assert.equal(forSpeech('Al. Racławickie'), 'aleja Racławickie');
  assert.equal(forSpeech('za 300 m'), 'za trzysta metrów');
});

test('withPauses: oddech po odległości i kierunku, kropka na końcu', () => {
  assert.equal(withPauses('Za sześćset metrów skręć w lewo w ulicę Krężnicką'), 'Za sześćset metrów, skręć w lewo, w ulicę Krężnicką.');
  assert.equal(withPauses('Za półtora kilometra zjedź drogą ekspresową S siedemnaście'), 'Za półtora kilometra, zjedź drogą ekspresową S siedemnaście.');
  assert.equal(withPauses('Skręć w lewo'), 'Skręć w lewo.');
  assert.equal(withPauses('Zwolnij. Fotoradar'), 'Zwolnij, Fotoradar.'.replace('Zwolnij, F', 'Zwolnij. F'));
});
