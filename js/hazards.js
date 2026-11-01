// Ostrzeżenia: fotoradary, odcinkowe pomiary prędkości, zgłoszenia kierowców.
// Źródła: OpenStreetMap (Overpass) + własna warstwa poprawek (data/hazards.local.json)
// + zgłoszenia użytkowników. Własna warstwa wygrywa z OSM przy tym samym id.

import { project, pointAt, bearing, angleDiff, haversine } from './geo.js';
import { fmtDist } from './routing.js';

export const TYPES = {
  camera: { label: 'Fotoradar', say: 'Fotoradar' },
  redlight: { label: 'Kamera na światłach', say: 'Kamera na światłach' },
  section: { label: 'Odcinkowy pomiar prędkości', say: 'Odcinkowy pomiar prędkości' },
  police: { label: 'Policja', say: 'Policja na trasie' },
  accident: { label: 'Wypadek', say: 'Wypadek' },
  obstacle: { label: 'Przeszkoda na drodze', say: 'Przeszkoda na drodze' },
  jam: { label: 'Korek', say: 'Korek' },
  roadwork: { label: 'Roboty drogowe', say: 'Roboty drogowe' },
};

// Czas życia zgłoszeń użytkowników (minuty).
export const TTL_MIN = { police: 90, accident: 180, obstacle: 120, jam: 60, roadwork: 24 * 60 };

// ---------- OpenStreetMap ----------

/** Zapytanie Overpass dla jednej obwiedni [minLng,minLat,maxLng,maxLat]. */
export function overpassQuery(b) {
  const bb = `${b[1].toFixed(5)},${b[0].toFixed(5)},${b[3].toFixed(5)},${b[2].toFixed(5)}`;
  return (
    `[out:json][timeout:25];(` +
    `node["highway"="speed_camera"](${bb});` +
    `node["enforcement"~"maxspeed|average_speed|traffic_signals"](${bb});` +
    `relation["type"="enforcement"]["enforcement"="average_speed"](${bb});` +
    `);out body;>;out skel qt;`
  );
}

function parseKmh(v) {
  if (v == null) return null;
  const m = String(v).match(/^(\d{2,3})(\s*km\/h)?$/);
  return m ? parseInt(m[1], 10) : null;
}

/** JSON z Overpass -> { cameras, sections }. */
export function parseOverpass(json) {
  const els = (json && json.elements) || [];
  const nodes = new Map();
  for (const e of els) if (e.type === 'node') nodes.set(e.id, e);
  const cameras = [];
  const sections = [];
  const inSection = new Set();

  for (const e of els) {
    if (e.type !== 'relation' || !e.tags) continue;
    const from = (e.members || []).find((m) => m.role === 'from' && m.type === 'node');
    const to = (e.members || []).find((m) => m.role === 'to' && m.type === 'node');
    const a = from && nodes.get(from.ref);
    const b = to && nodes.get(to.ref);
    if (!a || !b) continue;
    for (const m of e.members) if (m.type === 'node') inSection.add(m.ref);
    sections.push({
      id: `osm:r${e.id}`,
      type: 'section',
      start: [a.lon, a.lat],
      end: [b.lon, b.lat],
      limit: parseKmh(e.tags.maxspeed),
      source: 'osm',
    });
  }

  for (const e of els) {
    if (e.type !== 'node' || !e.tags || inSection.has(e.id)) continue;
    const t = e.tags;
    const isCam = t.highway === 'speed_camera' || /maxspeed|average_speed|traffic_signals/.test(t.enforcement || '');
    if (!isCam) continue;
    const dirNum = t.direction != null && /^\d+(\.\d+)?$/.test(t.direction) ? parseFloat(t.direction) : null;
    cameras.push({
      id: `osm:n${e.id}`,
      type: t.enforcement === 'traffic_signals' ? 'redlight' : 'camera',
      lng: e.lon,
      lat: e.lat,
      limit: parseKmh(t.maxspeed),
      dir: dirNum,
      source: 'osm',
    });
  }
  return { cameras, sections };
}

/**
 * Łączy warstwy. Własna warstwa (local) wygrywa po id, a lista `suppress`
 * usuwa błędne wpisy z OSM (np. fotoradar zdjęty, atrapa).
 */
/**
 * Scala kilka źródeł (np. OSM na żywo, OSM z pliku, GITD) w jedną listę bez dubli.
 * Pierwsze źródło wygrywa; z kolejnych dopełniamy brakujący limit i kierunek.
 * Dwa fotoradary bliżej niż 40 m uznajemy za ten sam, dwa odcinki o początkach i końcach
 * bliżej niż 150 m też.
 */
export function mergeSources(layers, local) {
  const cams = [];
  const secs = [];
  const camCell = new Map();
  const cell = (lng, lat) => `${Math.floor(lng * 500)}:${Math.floor(lat * 500)}`; // ok. 130 x 220 m
  const near = (a, b, m) => haversine([a.lng, a.lat], [b.lng, b.lat]) <= m;
  const ids = new Set();
  for (const layer of layers) {
    if (!layer) continue;
    for (const c of layer.cameras || []) {
      if (ids.has(c.id)) continue;
      let dup = null;
      const cx = Math.floor(c.lng * 500), cy = Math.floor(c.lat * 500);
      for (let dx = -1; dx <= 1 && !dup; dx++) for (let dy = -1; dy <= 1 && !dup; dy++) {
        for (const o of camCell.get(`${cx + dx}:${cy + dy}`) || []) if ((o.type === 'redlight') === (c.type === 'redlight') && near(o, c, 40)) { dup = o; break; }
      }
      if (dup) {
        if (dup.limit == null && c.limit != null) dup.limit = c.limit;
        if (dup.dir == null && c.dir != null) dup.dir = c.dir;
        (dup.sources = dup.sources || [dup.source]).push(c.source);
        continue;
      }
      ids.add(c.id);
      const copy = { ...c };
      cams.push(copy);
      const k = cell(c.lng, c.lat);
      if (!camCell.has(k)) camCell.set(k, []);
      camCell.get(k).push(copy);
    }
    for (const x of layer.sections || []) {
      if (ids.has(x.id)) continue;
      const dup = secs.find((o) => haversine(o.start, x.start) <= 150 && haversine(o.end, x.end) <= 150);
      if (dup) { if (dup.limit == null && x.limit != null) dup.limit = x.limit; continue; }
      ids.add(x.id);
      secs.push({ ...x });
    }
  }
  return mergeHazards({ cameras: cams, sections: secs }, local);
}

export function mergeHazards(osm, local) {
  const suppress = new Set((local && local.suppress) || []);
  const cams = new Map();
  for (const c of (osm && osm.cameras) || []) if (!suppress.has(c.id)) cams.set(c.id, c);
  for (const c of (local && local.cameras) || []) cams.set(c.id, { ...c, source: 'own' });
  const secs = new Map();
  for (const s of (osm && osm.sections) || []) if (!suppress.has(s.id)) secs.set(s.id, s);
  for (const s of (local && local.sections) || []) secs.set(s.id, { ...s, source: 'own' });
  return { cameras: [...cams.values()], sections: [...secs.values()] };
}

// ---------- Dopasowanie do trasy ----------

/**
 * Wybiera z listy punktów te, które leżą na trasie (do maxOff m od osi)
 * i są zwrócone w tym samym lub przeciwnym kierunku niż jazda (prostopadłe odrzucamy).
 */
export function onRoute(route, items, { maxOff = 30 } = {}) {
  const out = [];
  for (const h of items) {
    const p = project(route.line, [h.lng, h.lat]);
    if (p.dist > maxOff) continue;
    if (h.dir != null) {
      const brg = pointAt(route.line, p.along).bearing;
      const d1 = angleDiff(brg, h.dir);
      const d2 = angleDiff(brg, (h.dir + 180) % 360);
      if (Math.min(d1, d2) > 70) continue;
    }
    out.push({ ...h, along: p.along, off: p.dist });
  }
  return out.sort((a, b) => a.along - b.along);
}

/** Odcinki, których oba końce leżą na trasie w kolejności jazdy. */
export function sectionsOnRoute(route, sections, { maxOff = 35 } = {}) {
  const out = [];
  for (const s of sections) {
    const a = project(route.line, s.start);
    const b = project(route.line, s.end);
    if (a.dist > maxOff || b.dist > maxOff) continue;
    if (b.along - a.along >= 100) {
      out.push({ ...s, startAlong: a.along, endAlong: b.along, length: b.along - a.along });
    } else if (s.bidir && a.along - b.along >= 100) {
      // źródło nie podaje kierunku (GITD): jedziemy odcinkiem „od końca”, więc zamieniamy końce
      out.push({ ...s, start: s.end, end: s.start, startAlong: b.along, endAlong: a.along, length: a.along - b.along });
    } // reszta: przeciwny kierunek albo błąd danych
  }
  return out.sort((x, y) => x.startAlong - y.startAlong);
}

// ---------- Zgłoszenia kierowców ----------

export class ReportStore {
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null, key = 'nav.reports') {
    this.storage = storage;
    this.key = key;
    this.items = [];
    try {
      this.items = JSON.parse((storage && storage.getItem(key)) || '[]');
    } catch {
      this.items = [];
    }
  }
  add(type, lng, lat, now = Date.now()) {
    const item = { id: `own:${now}:${Math.random().toString(36).slice(2, 6)}`, type, lng, lat, ts: now, source: 'report' };
    this.items.push(item);
    this._save();
    return item;
  }
  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this._save();
  }
  /** Aktualne (nie wygasłe) zgłoszenia. */
  active(now = Date.now()) {
    const alive = this.items.filter((i) => now - i.ts < (TTL_MIN[i.type] || 60) * 60000);
    if (alive.length !== this.items.length) {
      this.items = alive;
      this._save();
    }
    return alive;
  }
  _save() {
    try {
      this.storage && this.storage.setItem(this.key, JSON.stringify(this.items));
    } catch {
      /* pełny magazyn: zgłoszenia i tak żyją w pamięci */
    }
  }
}

// ---------- Ostrzeganie w czasie jazdy ----------

function sayDist(m) {
  if (m >= 200) return fmtDist(Math.round(m / 50) * 50);
  return fmtDist(m);
}

export class HazardWatch {
  /** items: wynik onRoute (posortowane). */
  constructor(items) {
    this.items = items;
    this.done = new Set(); // `${id}:${level}`
    this.cursor = 0;
  }

  /**
   * along – położenie na trasie, speedMs – prędkość, limit – limit dla miejsca (km/h) lub null.
   * Zwraca { ahead: [...najbliższe z odległością], say: [...zapowiedzi], level }.
   */
  update(along, speedMs, limit = null) {
    const kmh = speedMs * 3.6;
    while (this.cursor < this.items.length && this.items[this.cursor].along < along - 20) this.cursor++;
    const lookahead = Math.max(900, speedMs * 25);
    const ahead = [];
    const say = [];
    let level = 'none';
    for (let i = this.cursor; i < this.items.length; i++) {
      const h = this.items[i];
      const dist = h.along - along;
      if (dist > lookahead) break;
      if (dist < -20) continue;
      ahead.push({ ...h, dist: Math.max(0, dist) });
      const lim = h.limit || limit;
      const speeding = lim ? kmh > lim + 2 : false;
      const alertAt = kmh > 90 ? 700 : 400;
      const mark = (lv) => this.done.has(`${h.id}:${lv}`) || (this.done.add(`${h.id}:${lv}`), false);
      if (dist <= 150) {
        level = 'final';
        if (!mark('final') && speeding) say.push(`Zwolnij. ${TYPES[h.type].say}${lim ? `, limit ${lim}` : ''}`);
      } else if (dist <= alertAt) {
        if (level !== 'final') level = 'alert';
        if (!mark('alert')) {
          const limTxt = lim && (h.type === 'camera' || h.type === 'redlight') ? `, limit ${lim}` : '';
          say.push(`${TYPES[h.type].say} za ${sayDist(dist)}${limTxt}`);
        }
      } else if (level === 'none') {
        level = 'info';
      }
    }
    return { ahead, say, level };
  }
}

// ---------- Odcinkowy pomiar prędkości ----------

/**
 * Własne liczenie średniej prędkości na odcinku z odczytów GPS.
 * Podpowiada też, jak jechać, by nie przekroczyć limitu średniej.
 * To pomoc dla kierowcy, nie wiarygodny dowód: urządzenia pomiarowe mierzą po swojemu.
 */
export class SectionTracker {
  constructor(section, limitKmh) {
    this.s = section;
    this.limit = limitKmh || section.limit || null;
    this.phase = 'before'; // before | inside | done
    this.prev = null;
    this.tCross = null;
    this.result = null;
  }

  update(along, tMs) {
    const s = this.s;
    const prev = this.prev;
    this.prev = { along, t: tMs };
    if (this.phase === 'before' && along >= s.startAlong) {
      // Interpolacja chwili wjazdu między odczytami.
      this.tCross = prev && along > prev.along
        ? prev.t + ((s.startAlong - prev.along) / (along - prev.along)) * (tMs - prev.t)
        : tMs;
      this.phase = 'inside';
    }
    if (this.phase === 'inside' && along >= s.endAlong) {
      const tEnd = prev && along > prev.along
        ? prev.t + ((s.endAlong - prev.along) / (along - prev.along)) * (tMs - prev.t)
        : tMs;
      const sec = Math.max(0.001, (tEnd - this.tCross) / 1000);
      const avg = (s.length / sec) * 3.6;
      this.phase = 'done';
      this.result = { avgKmh: avg, over: this.limit ? avg > this.limit : false };
      return this.state(along, tMs);
    }
    return this.state(along, tMs);
  }

  state(along, tMs) {
    const s = this.s;
    if (this.phase === 'before') {
      return { phase: 'before', distToStart: Math.max(0, s.startAlong - along), length: s.length, limit: this.limit };
    }
    if (this.phase === 'done') {
      return { phase: 'done', length: s.length, limit: this.limit, ...this.result };
    }
    const elapsed = Math.max(0.001, (tMs - this.tCross) / 1000);
    const covered = Math.max(0, along - s.startAlong);
    const avgKmh = (covered / elapsed) * 3.6;
    const remaining = Math.max(0, s.endAlong - along);
    let allowedKmh = null;
    if (this.limit) {
      const budget = s.length / (this.limit / 3.6) - elapsed; // ile sekund zostało na resztę odcinka
      allowedKmh = budget > 0 ? (remaining / budget) * 3.6 : 0;
    }
    return {
      phase: 'inside',
      length: s.length,
      limit: this.limit,
      avgKmh,
      remaining,
      progress: Math.min(1, covered / s.length),
      allowedKmh, // maksymalna średnia na reszcie odcinka, by nie przekroczyć limitu
      over: this.limit ? avgKmh > this.limit : false,
    };
  }
}

export { haversine, bearing };
