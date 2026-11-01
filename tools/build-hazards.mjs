// Buduje pliki z fotoradarami i odcinkowymi pomiarami dla całej Polski:
//   data/hazards.osm.json  – z OpenStreetMap (jedno zapytanie Overpass o cały kraj)
//   data/hazards.gitd.json – z oficjalnego wykazu lokalizacji urządzeń GITD/CANARD (załącznik XLSX)
// Uruchamiane codziennie przez GitHub Actions (.github/workflows/hazards.yml), bo tylko tam jest dostęp do tych serwerów.
// Zasada bezpieczeństwa: nieudane źródło NIE nadpisuje poprzedniego pliku.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOverpass } from '../js/hazards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (n) => path.join(ROOT, 'data', n);
const UA = 'nawigacja-hazards-builder (github.com/lewym90/nawigacja)';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERY = `[out:json][timeout:300];
area["ISO3166-1"="PL"][admin_level=2]->.pl;
(
  node(area.pl)["highway"="speed_camera"];
  node(area.pl)["enforcement"~"maxspeed|average_speed|traffic_signals"];
  relation(area.pl)["type"="enforcement"]["enforcement"="average_speed"];
);
out body;>;out skel qt;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inPoland = (lat, lng) => lat > 48.9 && lat < 55.0 && lng > 14.0 && lng < 24.3;

async function buildOsm() {
  let lastErr = null;
  for (let round = 0; round < 3; round++) {
    for (const url of OVERPASS) {
      try {
        console.log(`OSM: pytam ${url}`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(330000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseOverpass(await res.json());
        const cameras = parsed.cameras.filter((c) => inPoland(c.lat, c.lng));
        console.log(`OSM: ${cameras.length} fotoradarów, ${parsed.sections.length} odcinków`);
        if (cameras.length + parsed.sections.length < 20) throw new Error('podejrzanie mało danych');
        return { generated: new Date().toISOString(), cameras, sections: parsed.sections };
      } catch (e) {
        lastErr = e;
        console.warn(`OSM: ${url}: ${e.message}`);
      }
    }
    await sleep(20000 * (round + 1));
  }
  throw lastErr || new Error('OSM niedostępny');
}

// ---------- GITD ----------

const KNOWN_XLSX = 'https://nomando.pl/canard/gitd-zal-1-lokalizacje-2026-08-13.xlsx';
const INDEX_PAGE = 'https://nomando.pl/dane/canard';

async function findGitdUrl() {
  if (process.env.GITD_XLSX_URL) return process.env.GITD_XLSX_URL;
  try {
    const html = await (await fetch(INDEX_PAGE, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })).text();
    const found = [...html.matchAll(/(?:https?:\/\/nomando\.pl)?\/?(canard\/gitd-zal-1-lokalizacje-[\d-]+\.xlsx)/g)].map((m) => m[1]).sort();
    if (found.length) return `https://nomando.pl/${found[found.length - 1]}`;
  } catch (e) {
    console.warn(`GITD: strona zbioru niedostępna (${e.message}), używam znanego adresu`);
  }
  return KNOWN_XLSX;
}

const norm = (v) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** Liczba z tekstu: „50,123” / „50.123”. */
function num(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Współrzędna w stopniach dziesiętnych albo DMS („50°03'12.5\"N”). */
function degrees(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(',', '.');
  const dms = s.match(/(\d+)\D+(\d+)\D+(\d+(?:\.\d+)?)/);
  if (dms && /[°'’"]/.test(s)) return +dms[1] + +dms[2] / 60 + +dms[3] / 3600;
  return num(s);
}

/** Para „lat, lng” w jednej komórce (kolejność rozpoznajemy po zakresach). */
function pairCell(v) {
  const m = String(v ?? '').replace(/,/g, '.').match(/(-?\d{1,3}\.\d+)\D+(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  if (inPoland(a, b)) return { lat: a, lng: b };
  if (inPoland(b, a)) return { lat: b, lng: a };
  return null;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm).filter(Boolean);
    if (cells.length >= 3 && cells.some((c) => /rodzaj|typ|urzadz|lokalizacj|wspolrzedn|szerok|dlugosc/.test(c))) return i;
  }
  return 0;
}

export function parseGitdRows(rows, sheetName = '') {
  const h = findHeaderRow(rows);
  const head = rows[h].map(norm);
  const col = (re, skip = []) => head.findIndex((c, i) => !skip.includes(i) && re.test(c));
  const cType = col(/rodzaj|typ urzadz|typ$|urzadzen/);
  const cLimit = col(/limit|ograniczen|dopuszczaln|predkosc dop/);
  const cRoad = col(/^droga|nr drogi|numer drogi|ulica|^nazwa/);
  const cId = col(/^lokalizacj|kod|identyfik|^id$|^nr$|numer lok/);
  // współrzędne: osobne kolumny, jedna kolumna z parą albo (dla odcinków) początek i koniec
  const cLat = col(/szerok|^lat|wspolrzedna y|\by\b/);
  const cLng = col(/dlugosc|^lon|^lng|wspolrzedna x|\bx\b/);
  const cPair = col(/wspolrzedn|wsp\.|gps|polozenie/, [cLat, cLng]);
  const cStart = col(/pocz|start|wjazd/);
  const cEnd = col(/koniec|konc|wyjazd|meta/);

  const items = [];
  let skipped = 0;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((x) => x !== '' && x != null)) continue;
    let pos = null;
    if (cLat >= 0 && cLng >= 0) {
      const a = degrees(r[cLat]), b = degrees(r[cLng]);
      if (a != null && b != null) pos = inPoland(a, b) ? { lat: a, lng: b } : inPoland(b, a) ? { lat: b, lng: a } : null;
    }
    if (!pos && cPair >= 0) pos = pairCell(r[cPair]);
    let endPos = null;
    if (!pos && cStart >= 0) pos = pairCell(r[cStart]);
    if (cEnd >= 0) endPos = pairCell(r[cEnd]);
    if (!pos) { skipped++; continue; }
    const t = norm(cType >= 0 ? r[cType] : '');
    const kind = /odcink/.test(t) ? 'section' : /czerwon|redlight|swiatl|skrzyz|przejazd|kolej/.test(t) ? 'redlight' : /mobiln|przenosn/.test(t) ? 'skip' : 'camera';
    if (kind === 'skip') continue;
    const lim = cLimit >= 0 ? num(r[cLimit]) : null;
    items.push({
      kind,
      lat: pos.lat,
      lng: pos.lng,
      end: endPos,
      limit: lim && lim >= 20 && lim <= 140 ? Math.round(lim) : null,
      road: cRoad >= 0 ? String(r[cRoad] ?? '').trim() : '',
      code: cId >= 0 ? String(r[cId] ?? '').trim() : '',
      sheet: sheetName,
    });
  }
  return { items, skipped, header: rows[h] };
}

/** Wiersze -> format aplikacji. Odcinki parujemy: z kolumn początek/koniec albo kolejne wiersze tej samej drogi. */
export function toHazards(items) {
  const cameras = [];
  const sections = [];
  const pending = [];
  const hav = (a, b) => {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  let n = 0;
  for (const it of items) {
    n++;
    if (it.kind === 'camera' || it.kind === 'redlight') {
      cameras.push({ id: `gitd:${it.code || n}:${n}`, type: it.kind, lng: it.lng, lat: it.lat, limit: it.limit, dir: null, source: 'gitd' });
    } else if (it.end) {
      sections.push({ id: `gitd:s${n}`, type: 'section', start: [it.lng, it.lat], end: [it.end.lng, it.end.lat], limit: it.limit, source: 'gitd' });
    } else {
      pending.push({ ...it, n });
    }
  }
  // dwa punkty tej samej drogi i kodu bazowego, 300 m – 25 km od siebie, to początek i koniec odcinka
  const used = new Set();
  for (let i = 0; i < pending.length; i++) {
    if (used.has(i)) continue;
    const a = pending[i];
    let best = -1, bd = Infinity;
    for (let j = i + 1; j < pending.length; j++) {
      if (used.has(j)) continue;
      const b = pending[j];
      const d = hav(a, b);
      const sameKey = (a.road && a.road === b.road) || (a.code && b.code && a.code.split(/[.\s-]/).slice(0, 2).join() === b.code.split(/[.\s-]/).slice(0, 2).join());
      if (sameKey && d > 300 && d < 25000 && d < bd) { best = j; bd = d; }
    }
    if (best >= 0) {
      used.add(i); used.add(best);
      const b = pending[best];
      sections.push({ id: `gitd:s${a.n}`, type: 'section', start: [a.lng, a.lat], end: [b.lng, b.lat], limit: a.limit ?? b.limit, source: 'gitd' });
    }
  }
  // niesparowane punkty zostają jako ostrzeżenie punktowe „odcinkowy pomiar”
  pending.forEach((p, i) => {
    if (!used.has(i)) cameras.push({ id: `gitd:sp${p.n}`, type: 'section', lng: p.lng, lat: p.lat, limit: p.limit, dir: null, source: 'gitd' });
  });
  return { cameras, sections };
}

async function buildGitd() {
  const url = await findGitdUrl();
  console.log(`GITD: pobieram ${url}`);
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const XLSX = (await import('xlsx')).default || (await import('xlsx'));
  const wb = XLSX.read(buf, { type: 'buffer' });
  const all = [];
  for (const name of wb.SheetNames) {
    if (/zdemont|nieaktyw|archiw/i.test(name)) { console.log(`GITD: pomijam arkusz „${name}”`); continue; }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    const { items, skipped, header } = parseGitdRows(rows, name);
    console.log(`GITD: arkusz „${name}”: ${rows.length} wierszy, ${items.length} z położeniem, ${skipped} bez; nagłówki: ${JSON.stringify(header)}`);
    all.push(...items);
  }
  const { cameras, sections } = toHazards(all);
  console.log(`GITD: ${cameras.length} punktów, ${sections.length} odcinków`);
  if (cameras.length + sections.length < 50) throw new Error('podejrzanie mało danych z GITD (zmieniły się nagłówki?)');
  return { generated: new Date().toISOString(), source: url, cameras, sections };
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  let ok = 0;
  for (const [name, fn] of [['hazards.osm.json', buildOsm], ['hazards.gitd.json', buildGitd]]) {
    try {
      const data = await fn();
      fs.writeFileSync(OUT(name), JSON.stringify(data));
      ok++;
    } catch (e) {
      console.error(`::warning::${name}: ${e.message} (zostaje poprzednia wersja pliku)`);
    }
  }
  if (!ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
