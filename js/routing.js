// Trasy: klient silnika zgodnego z API OSRM + polskie instrukcje skrętów.
// Adres silnika jest w config.js: docelowo własny serwer (Valhalla/OSRM).

import { buildLine } from './geo.js';
import { intoSuffix } from './speech-pl.js';

const MOD_PL = {
  left: 'w lewo',
  right: 'w prawo',
  'slight left': 'lekko w lewo',
  'slight right': 'lekko w prawo',
  'sharp left': 'ostro w lewo',
  'sharp right': 'ostro w prawo',
  straight: 'prosto',
  uturn: 'zawróć',
};

const ORD = ['', 'pierwszy', 'drugi', 'trzeci', 'czwarty', 'piąty', 'szósty', 'siódmy', 'ósmy', 'dziewiąty'];

/** Odległość do mowy i ekranu: „300 m”, „1,2 km”. */
export function fmtDist(m) {
  if (m == null || !isFinite(m)) return '';
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function fmtDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function onStreet(name, ref) {
  const n = (name || '').trim();
  if (n) return /^(ul\.|al\.|pl\.|os\.)/i.test(n) ? n : n;
  return (ref || '').trim();
}

/**
 * Instrukcja skrętu w jednym kroku.
 * Zwraca { text, icon } gdzie icon: nazwa strzałki dla UI.
 */
export function instruct(step) {
  const r = instructFull(step);
  const on = intoSuffix(step.name, step.ref);
  r.short = on && r.text.endsWith(on) ? r.text.slice(0, -on.length).trim() : r.text;
  return r;
}

function instructFull(step) {
  const m = step.maneuver || {};
  const type = m.type;
  const mod = m.modifier;
  const on = intoSuffix(step.name, step.ref); // „ w ulicę Krężnicką” (biernik)
  const toward = on;
  const dir = MOD_PL[mod] || '';

  // Cechy dróg pieszych: schody, przejścia, windy.
  if (m.feature === 'stairs') return { text: `Idź po schodach${toward}`, icon: iconFor(mod) };
  if (m.feature === 'escalator') return { text: 'Wjedź schodami ruchomymi', icon: 'straight' };
  if (m.feature === 'elevator') return { text: 'Skorzystaj z windy', icon: 'straight' };
  if (m.feature === 'crossing') {
    // Valhalla: „Skręć w lewo w przejście dla pieszych” = wchodzimy na przejście skręcając
    if (dir && dir !== 'prosto') return { text: `Skręć ${dir} na przejście dla pieszych`, icon: iconFor(mod) };
    return { text: 'Przejdź przez ulicę', icon: 'straight' };
  }

  switch (type) {
    case 'depart':
      return { text: 'Ruszaj', icon: 'straight' };
    case 'arrive': {
      const side = mod === 'left' ? ' po lewej' : mod === 'right' ? ' po prawej' : '';
      return { text: `Cel podróży${side}`, icon: 'arrive' };
    }
    case 'roundabout':
    case 'rotary': {
      const ex = m.exit;
      if (ex && ORD[ex]) return { text: `Na rondzie zjedź ${ORD[ex]}m zjazdem${toward}`, icon: 'roundabout' };
      return { text: `Wjedź na rondo${toward}`, icon: 'roundabout' };
    }
    case 'roundabout turn':
      return { text: `Na rondzie ${dir}${toward}`.trim(), icon: iconFor(mod) };
    case 'exit roundabout':
    case 'exit rotary':
      return { text: `Zjedź z ronda${toward}`, icon: 'straight' };
    case 'merge':
      return { text: `Włącz się do ruchu${toward}`, icon: 'merge' };
    case 'on ramp':
      return { text: `Wjedź${on || ' na drogę'}`, icon: iconFor(mod) };
    case 'off ramp':
      return { text: `Zjedź ${dir}${toward}`.replace('  ', ' ').trim(), icon: iconFor(mod) };
    case 'fork':
      return { text: `Na rozwidleniu trzymaj się ${mod && mod.includes('left') ? 'lewej' : mod && mod.includes('right') ? 'prawej' : 'środka'}${toward}`, icon: iconFor(mod) };
    case 'end of road':
      return { text: `Na końcu drogi skręć ${dir}${on}`, icon: iconFor(mod) };
    case 'continue':
      return { text: mod === 'uturn' ? 'Zawróć' : `Jedź dalej ${dir === 'prosto' ? 'prosto' : dir}`.trim(), icon: iconFor(mod) };
    case 'new name':
      return { text: 'Jedź prosto', icon: 'straight' };
    case 'turn':
    default:
      if (mod === 'uturn') return { text: 'Zawróć', icon: 'uturn' };
      if (mod === 'straight' || !mod) return { text: 'Jedź prosto', icon: 'straight' };
      return { text: `Skręć ${dir}${on}`, icon: iconFor(mod) };
  }
}

function iconFor(mod) {
  switch (mod) {
    case 'left': return 'left';
    case 'right': return 'right';
    case 'slight left': return 'slight-left';
    case 'slight right': return 'slight-right';
    case 'sharp left': return 'sharp-left';
    case 'sharp right': return 'sharp-right';
    case 'uturn': return 'uturn';
    default: return 'straight';
  }
}

/** Zapytanie do silnika: punkty [lng,lat] -> trasy (do 3). */
export function routeUrl(base, points, { alternatives = true, annotate = true } = {}) {
  const coords = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
  const q = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    alternatives: alternatives ? 'true' : 'false',
    annotations: annotate ? 'maxspeed,distance' : 'false',
  });
  return `${base.replace(/\/$/, '')}/route/v1/driving/${coords}?${q}`;
}

/** Odpowiedź OSRM -> lista tras w naszym formacie. */
export function parseRoutes(json) {
  if (!json || json.code !== 'Ok' || !Array.isArray(json.routes)) {
    throw new Error(json && json.message ? json.message : 'Brak trasy');
  }
  const routes = json.routes.map((r, i) => parseRoute(r, i));
  labelRoutes(routes);
  return routes;
}

/**
 * Opis „przez ...” dla każdej trasy: ulica, która ją odróżnia od pozostałych (a nie ta, którą
 * wspólnie zaczynają wszystkie warianty). Ustawia route.via.
 */
export function labelRoutes(routes) {
  const per = routes.map((r) => {
    const m = new Map();
    for (const st of r.steps) {
      const n = (st.name || '').trim();
      if (n) m.set(n, (m.get(n) || 0) + (st.distance || 0));
    }
    return m;
  });
  routes.forEach((r, i) => {
    r.via = r.summary || '';
    if (routes.length < 2) return;
    let best = null;
    let bestScore = 250; // ulica musi się różnić o co najmniej ~250 m względem każdej innej trasy
    for (const [name, d] of per[i]) {
      let other = 0;
      per.forEach((m, j) => { if (j !== i) other = Math.max(other, m.get(name) || 0); });
      const score = d - other;
      if (score > bestScore) { bestScore = score; best = name; }
    }
    if (best) r.via = best;
  });
}

export function parseRoute(r, index = 0) {
  const coords = r.geometry.coordinates;
  const line = buildLine(coords);
  const steps = [];
  let acc = 0;
  for (const leg of r.legs || []) {
    for (const st of leg.steps || []) {
      const ins = instruct(st);
      steps.push({
        text: ins.text,
        short: ins.short,
        icon: ins.icon,
        name: onStreet(st.name, st.ref),
        type: st.maneuver && st.maneuver.type,
        modifier: st.maneuver && st.maneuver.modifier,
        feature: st.maneuver && st.maneuver.feature,
        location: st.maneuver && st.maneuver.location,
        // Odległość od początku trasy, w której wykonuje się ten manewr.
        at: acc,
        distance: st.distance,
        duration: st.duration,
      });
      acc += st.distance;
    }
  }
  // Limity prędkości z adnotacji (jeśli silnik je zwraca): lista odcinków.
  const limits = [];
  let off = 0;
  for (const leg of r.legs || []) {
    const an = leg.annotation;
    if (an && an.maxspeed && an.distance) {
      for (let i = 0; i < an.distance.length; i++) {
        const ms = an.maxspeed[i];
        const kmh = ms && typeof ms.speed === 'number' && ms.unit === 'km/h' ? ms.speed : null;
        limits.push({ from: off, to: off + an.distance[i], kmh });
        off += an.distance[i];
      }
    }
  }
  return {
    id: `r${index}`,
    index,
    coords,
    line,
    distance: r.distance,
    duration: r.duration,
    steps,
    limits,
    summary: (r.legs && r.legs[0] && r.legs[0].summary) || '',
  };
}

/** Limit prędkości obowiązujący na danym kilometrze trasy (lub null). */
export function limitAt(route, along) {
  if (!route.limits || !route.limits.length) return null;
  // wyszukiwanie binarne po `from`
  let lo = 0;
  let hi = route.limits.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.limits[mid].from <= along) lo = mid;
    else hi = mid - 1;
  }
  const seg = route.limits[lo];
  return seg && along <= seg.to + 1 ? seg.kmh : null;
}

export async function fetchRoutes(base, points, opts = {}) {
  // Nie każdy silnik zna adnotację „maxspeed”: przy odrzuceniu zapytania próbujemy bez niej.
  for (const annotate of [true, false]) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
    try {
      const res = await fetch(routeUrl(base, points, { ...opts, annotate }), { signal: ctrl.signal });
      if (res.status === 400 && annotate) continue;
      if (!res.ok) throw new Error(`Serwer tras: ${res.status}`);
      return parseRoutes(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Brak trasy');
}
