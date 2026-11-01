// Polszczyzna dla komunikatów: liczby słownie, odległości, numery dróg i odmiana nazw ulic.
// Czyste funkcje bez zależności, żeby dało się je testować w Node.

const ONES = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć',
  'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

/** Liczba całkowita 0..999999 słownie (mianownik). */
export function plNum(n) {
  n = Math.floor(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
  if (n < 1000) return HUNDREDS[Math.floor(n / 100)] + (n % 100 ? ` ${plNum(n % 100)}` : '');
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  let head;
  if (th === 1) head = 'tysiąc';
  else {
    const last = th % 10;
    const few = last >= 2 && last <= 4 && !(th % 100 >= 12 && th % 100 <= 14);
    head = `${plNum(th)} ${few ? 'tysiące' : 'tysięcy'}`;
  }
  return head + (rest ? ` ${plNum(rest)}` : '');
}

/** 0 = liczba pojedyncza, 1 = „dwa, trzy, cztery”, 2 = reszta (dopełniacz liczby mnogiej). */
function form(n) {
  n = Math.floor(Math.abs(n));
  if (n === 1) return 0;
  const last = n % 10;
  if (last >= 2 && last <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return 1;
  return 2;
}

const METER = ['metr', 'metry', 'metrów'];
const KM = ['kilometr', 'kilometry', 'kilometrów'];

/** Odległość po „za …”: „dziewięćset metrów”, „półtora kilometra”, „trzy kilometry”. */
export function distWords(m) {
  if (m == null || !isFinite(m)) return '';
  if (m < 100) { const r = Math.max(10, Math.round(m / 10) * 10); return `${plNum(r)} ${METER[form(r)]}`; }
  if (m < 2000) { const r = Math.round(m / 50) * 50; return `${plNum(r)} ${METER[form(r)]}`; }
  const km = m / 1000;
  if (km < 10) {
    const half = Math.round(km * 2) / 2;
    const whole = Math.floor(half);
    if (half !== whole) return whole === 1 ? 'półtora kilometra' : `${plNum(whole)} i pół kilometra`;
    return `${plNum(whole)} ${KM[form(whole)]}`;
  }
  const r = Math.round(km);
  return `${plNum(r)} ${KM[form(r)]}`;
}

// ---------- Numery dróg ----------

/** „DK17”, „S17”, „A2”, „848”, „DW 835” -> { kind, num } albo null. */
export function parseRoadRef(ref) {
  const r = String(ref || '').trim().split(';')[0].trim().toUpperCase().replace(/\s+/g, '');
  let m;
  if ((m = r.match(/^A(\d{1,2})$/))) return { kind: 'autostrada', letter: 'A', num: +m[1] };
  if ((m = r.match(/^S(\d{1,3})$/))) return { kind: 'ekspresowa', letter: 'S', num: +m[1] };
  if ((m = r.match(/^(?:DK|K)?(\d{1,3})$/)) && /^DK/.test(r)) return { kind: 'krajowa', num: +m[1] };
  if ((m = r.match(/^(?:DW|W)(\d{3})$/))) return { kind: 'wojewodzka', num: +m[1] };
  if ((m = r.match(/^(\d{1,3})$/))) return +m[1] >= 100 ? { kind: 'wojewodzka', num: +m[1] } : { kind: 'krajowa', num: +m[1] };
  return null;
}

/** Fraza po przyimku „w”, np. „w drogę krajową 17”, „w autostradę A2”. */
function refPhrase(ref) {
  const p = parseRoadRef(ref);
  if (!p) return null;
  if (p.kind === 'autostrada') return { prep: 'w', text: `autostradę A${p.num}` };
  if (p.kind === 'ekspresowa') return { prep: 'w', text: `drogę ekspresową S${p.num}` };
  if (p.kind === 'krajowa') return { prep: 'w', text: `drogę krajową ${p.num}` };
  return { prep: 'w', text: `drogę wojewódzką ${p.num}` };
}

// ---------- Odmiana nazw ulic (biernik: „w ulicę Krężnicką”) ----------

// Przymiotniki żeńskie, których nie da się rozpoznać po końcówce.
const FEM_ADJ = new Set(['długa', 'szeroka', 'wąska', 'stara', 'cicha', 'wysoka', 'sucha', 'gruba', 'zielona', 'czerwona', 'biała', 'czarna', 'żółta',
  'wschodnia', 'zachodnia', 'środkowa', 'dolna', 'górna', 'nowa', 'mała', 'wielka', 'krótka', 'ładna', 'polna', 'leśna', 'słoneczna', 'spokojna',
  'przemysłowa', 'kolejowa', 'szkolna', 'parkowa', 'rzeczna', 'boczna', 'główna', 'prosta', 'kręta', 'pusta', 'jasna', 'ciemna', 'zimna', 'ciepła',
  'dobra', 'zła', 'lipowa', 'brzozowa', 'dębowa', 'sosnowa', 'akacjowa', 'jodłowa', 'świerkowa', 'wiśniowa', 'jabłoniowa', 'różana', 'tęczowa']);
const VOWELS = 'aąeęioóuy';
const DIGRAPHS = ['cz', 'sz', 'ch', 'dz', 'rz', 'dż', 'dź', 'dż'];

/** Czy słowo to przymiotnik rodzaju żeńskiego na „-a” (Krężnicka, Północna, Diamentowa). */
export function isFemAdjective(word) {
  const w = word.toLowerCase();
  if (!/a$/.test(w) || w.length < 4) return false;
  if (FEM_ADJ.has(w)) return true;
  if (/(sk|ck|dzk|zk)a$/.test(w)) return true; // Lubelska, Zemborzycka, Gdańska
  if (/(ow|ew)a$/.test(w) && w.length > 5) return true; // Diamentowa, Kościuszkowa
  let stem = w.slice(0, -1);
  // końcowa grupa spółgłosek; dwuznaki liczymy za jedną
  let run = 0;
  while (stem.length && !VOWELS.includes(stem[stem.length - 1])) {
    const two = stem.slice(-2);
    if (DIGRAPHS.includes(two)) stem = stem.slice(0, -2);
    else stem = stem.slice(0, -1);
    run++;
  }
  return run >= 2; // Północna, Krótka; „Kopernika”, „Mickiewicza” (jedna) zostają
}

function accWord(word) {
  // części złożone z myślnikiem odmieniamy osobno
  if (word.includes('-')) return word.split('-').map(accWord).join('-');
  if (!isFemAdjective(word)) return word;
  return word.replace(/a$/, 'ą').replace(/A$/, 'Ą');
}

const GENITIVE_END = /(ego|iej|ej|ów|ości|ści|ści|ci|ii|ych|ich)$/i;

/** Nazwa ulicy bez przedrostka -> biernik (cała fraza rzeczownikowa). */
function accName(rest) {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  // dopełniacz (nazwiska, „Armii Krajowej”, „Wolności”) zostaje jak jest
  if (words.some((w) => GENITIVE_END.test(w))) return words.join(' ');
  return words.map(accWord).join(' ');
}

const PREFIX = [
  [/^(?:ulica|ul\.)\s+/i, 'w', 'ulicę', true],
  [/^(?:aleja|al\.)\s+/i, 'w', 'aleję', true],
  [/^aleje\s+/i, 'w', 'Aleje', false],
  [/^(?:plac|pl\.)\s+/i, 'na', 'plac', false],
  [/^rondo\s+/i, 'na', 'rondo', false],
  [/^(?:most|skwer|bulwar|rynek)\s+/i, 'na', null, false],
  [/^droga\s+/i, 'w', 'drogę', true],
  [/^trasa\s+/i, 'w', 'trasę', true],
  [/^osiedle\s+/i, 'w', 'osiedle', false],
];

/**
 * Dokąd skręcamy: { prep, text } -> „w ulicę Krężnicką”, „na plac Litewski”, „w drogę krajową 17”.
 * Bez nazwy i numeru zwraca null.
 */
export function intoPhrase(name, ref) {
  const n = String(name || '').trim();
  if (!n) return refPhrase(ref);
  // sama nazwa będąca numerem drogi (OSRM bywa tak podaje)
  const asRef = parseRoadRef(n);
  if (asRef && !/[a-ząćęłńóśźż]{3,}/i.test(n)) return refPhrase(n);
  for (const [re, prep, noun, declinesRest] of PREFIX) {
    if (re.test(n)) {
      const rest = n.replace(re, '');
      const restText = declinesRest ? accName(rest) : rest;
      if (noun === null) return { prep, text: `${n.match(/^\S+/)[0].toLowerCase()} ${rest}` };
      return { prep, text: `${noun} ${restText}` };
    }
  }
  return { prep: 'w', text: `ulicę ${accName(n)}` };
}

/** Wygodny skrót: „ w ulicę Krężnicką” (ze spacją na początku) albo pusty napis. */
export function intoSuffix(name, ref) {
  const p = intoPhrase(name, ref);
  return p ? ` ${p.prep} ${p.text}` : '';
}

// ---------- Tekst do syntezatora ----------

const ABBR = [
  [/\bAl\.\s*/g, 'aleja '], [/\bul\.\s*/gi, 'ulica '], [/\bpl\.\s*/gi, 'plac '], [/\bos\.\s*/gi, 'osiedle '],
  [/\bim\.\s*/gi, 'imienia '], [/\bśw\.\s*/gi, 'świętego '], [/\bks\.\s*/gi, 'księdza '], [/\bgen\.\s*/gi, 'generała '],
  [/\bprof\.\s*/gi, 'profesora '], [/\bdr\.?\s+/gi, 'doktora '], [/\bmjr\.?\s+/gi, 'majora '], [/\bpłk\.?\s+/gi, 'pułkownika '],
];

/** Zamienia cyfry, jednostki i skróty na słowa, żeby syntezator niczego nie przekręcił. */
export function forSpeech(text) {
  let t = String(text || '');
  for (const [re, to] of ABBR) t = t.replace(re, to);
  t = t.replace(/(\d+)\s*km\/h/gi, (_, n) => `${plNum(+n)} ${KM[form(+n)]} na godzinę`);
  t = t.replace(/(\d+),(\d)\s*km\b/g, (_, a, b) => distWords((+a + +b / 10) * 1000));
  t = t.replace(/(\d+)\s*km\b/g, (_, n) => `${plNum(+n)} ${KM[form(+n)]}`);
  t = t.replace(/(\d+)\s*m\b/g, (_, n) => `${plNum(+n)} ${METER[form(+n)]}`);
  t = t.replace(/\b([ASD]W?|DK)\s?(\d+)/g, (_, k, n) => `${k.split('').join(' ')} ${plNum(+n)}`);
  t = t.replace(/(\d+)/g, (_, n) => plNum(+n));
  return t.replace(/\s{2,}/g, ' ').trim();
}
