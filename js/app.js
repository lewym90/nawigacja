import { CONFIG, APP_VERSION, loadSettings, saveSettings, STORAGE } from './config.js';
import { buildStyle, isNight } from './mapstyle.js';
import { fetchRoutes, fmtDist, fmtDuration, limitAt } from './routing.js';
import { Guidance } from './guidance.js';
import { SpeedFilter } from './speed.js';
import { loadRouteLimits } from './limits.js';
import {
  parseOverpass, overpassQuery, mergeHazards, mergeSources, onRoute, sectionsOnRoute,
  HazardWatch, SectionTracker, ReportStore, TYPES,
} from './hazards.js';
import { corridorBoxesRange, haversine, bearing, sliceLine } from './geo.js';
import { Voice, qualityLabel } from './voice.js';
import { Simulator } from './sim.js';
import { icon, arrow, hazardPin } from './icons.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const voice = new Voice();
voice.enabled = settings.voice;
voice.engine = settings.ttsEngine === 'robot' ? 'robot' : 'system';
voice.prefName = settings.voiceName || '';
const reports = new ReportStore();

const S = {
  mode: 'idle', // idle | preview | nav
  pos: null,
  dest: null,
  routes: [],
  sel: 0,
  osm: { cameras: [], sections: [] },
  local: { cameras: [], sections: [], suppress: [] },
  hazardsReady: false,
  nav: null,
  follow: true,
  sim: null,
  markers: new Map(),
  heading: 0,
  lastFix: null,
  wl: null,
};

// ---------- Interfejs: ikony i drobiazgi ----------
$('search-ico').innerHTML = icon.search(22);
$('btn-menu').innerHTML = icon.menu(24);
$('btn-menu-x').innerHTML = icon.close(22);
$('btn-cancel').innerHTML = icon.close(22);
$('btn-report-x').innerHTML = icon.close(22);
$('btn-locate').innerHTML = icon.locate(24);
$('btn-report').innerHTML = icon.warn(24);
$('go-ico').innerHTML = icon.play(20);
$('resume-ico').innerHTML = icon.locate(22);

const REPORT_TYPES = ['police', 'accident', 'obstacle', 'jam', 'roadwork'];
$('report-grid').innerHTML = REPORT_TYPES.map(
  (t) => `<button data-t="${t}">${icon[t](30)}<span>${TYPES[t].label}</span></button>`
).join('');

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function show(id, on) { $(id).hidden = !on; }

// ---------- Mapa ----------
let night = isNight(settings.theme);
document.body.classList.toggle('day', !night);

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(night ? 'night' : 'day', CONFIG),
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  maxPitch: 70,
  attributionControl: false,
  dragRotate: true,
  pitchWithRotate: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
{ const fold = () => document.querySelectorAll('.maplibregl-ctrl-attrib').forEach((el) => { el.classList.remove('maplibregl-compact-show'); el.removeAttribute('open'); });
  map.on('load', fold); map.on('resize', fold); setTimeout(fold, 300); }

// iOS potrafi zmienić wysokość okna po starcie (pasek adresu, obszar bezpieczny): dopasuj mapę.
const fitMap = () => map.resize();
window.addEventListener('resize', fitMap);
window.addEventListener('orientationchange', () => setTimeout(fitMap, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitMap);
[300, 1200, 3000].forEach((ms) => setTimeout(fitMap, ms));

function installLayers() {
  if (!map.getSource('alt')) {
    map.addSource('alt', { type: 'geojson', data: emptyFC() });
    map.addSource('sel', { type: 'geojson', data: emptyFC() });
  }
  if (!map.getSource('secs')) map.addSource('secs', { type: 'geojson', data: emptyFC() });
  const before = map.getLayer('road-label') ? 'road-label' : undefined;
  const route = night ? '#4c9bff' : '#1f6fe0';
  const routeCase = night ? '#0a2a52' : '#ffffff';
  const add = (def) => { if (!map.getLayer(def.id)) map.addLayer(def, before); };
  add({ id: 'alt-line', type: 'line', source: 'alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': night ? '#5a5a66' : '#9a9588', 'line-width': 6, 'line-opacity': 0.9 } });
  add({ id: 'sel-case', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': routeCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 8, 16, 20] } });
  add({ id: 'sel-line', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': route, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 16, 11] } });
  add({ id: 'sec-line', type: 'line', source: 'secs', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#ffcf3a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 6], 'line-dasharray': [2, 1.3] } });
  drawRoutes();
  drawSections(S.routes[S.sel]);
}
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
map.on('style.load', installLayers);

function drawRoutes() {
  if (!map.getSource('sel')) return;
  const sel = S.routes[S.sel];
  map.getSource('sel').setData(sel ? { type: 'Feature', geometry: { type: 'LineString', coordinates: sel.coords } } : emptyFC());
  const alts = S.routes.filter((_, i) => i !== S.sel);
  map.getSource('alt').setData(
    S.mode === 'preview' && alts.length
      ? { type: 'FeatureCollection', features: alts.map((r) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords } })) }
      : emptyFC()
  );
}

function applyTheme() {
  const n = isNight(settings.theme);
  if (n === night) return;
  night = n;
  document.body.classList.toggle('day', !night);
  document.querySelector('meta[name=theme-color]').content = night ? '#0b0b0d' : '#f4f1ea';
  map.setStyle(buildStyle(night ? 'night' : 'day', CONFIG));
}
setInterval(applyTheme, 60000);

// ---------- Pozycja ----------
let meMarker = null;
let destMarker = null;

function meEl() {
  const d = document.createElement('div');
  d.className = 'me-dot';
  return d;
}

const speedFilter = new SpeedFilter();
function startGeo() {
  if (!navigator.geolocation) { toast('Ta przeglądarka nie ma GPS'); return; }
  navigator.geolocation.watchPosition(
    (p) => {
      if (S.sim) return; // w symulacji ignorujemy prawdziwy GPS
      const c = p.coords;
      const speed = speedFilter.update({ lng: c.longitude, lat: c.latitude, speed: c.speed, accuracy: c.accuracy, t: p.timestamp });
      onFix({ lng: c.longitude, lat: c.latitude, speed, accuracy: c.accuracy, heading: c.heading, t: p.timestamp });
    },
    (e) => toast(e.code === 1 ? 'Zezwól na lokalizację w ustawieniach' : 'Brak sygnału GPS', 4000),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
}

let firstFixDone = false;
function onFix(fix) {
  S.lastFix = fix;
  S.pos = fix;
  if (S.mode !== 'nav') {
    if (!meMarker) meMarker = new maplibregl.Marker({ element: meEl() }).setLngLat([fix.lng, fix.lat]).addTo(map);
    else meMarker.setLngLat([fix.lng, fix.lat]);
    if (!firstFixDone) {
      firstFixDone = true;
      map.easeTo({ center: [fix.lng, fix.lat], zoom: 14.5, duration: 900 });
    }
  } else {
    navTick(fix);
  }
}

$('btn-locate').onclick = () => {
  S.follow = true;
  if (S.mode === 'nav') return;
  if (S.pos) map.easeTo({ center: [S.pos.lng, S.pos.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 600 });
  else toast('Czekam na sygnał GPS…');
};

// ---------- Wyszukiwanie ----------
let searchCtrl = null;
let searchTimer;
const input = $('q');

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (q.length < 3) { show('results', false); return; }
  searchTimer = setTimeout(() => runSearch(q), 300);
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); const q = input.value.trim(); if (q.length >= 2) runSearch(q); input.blur(); } });

async function runSearch(q) {
  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();
  const c = S.pos ? [S.pos.lng, S.pos.lat] : map.getCenter().toArray();
  const url = `${CONFIG.geocodeUrl}?${new URLSearchParams({ q, limit: '6', lang: 'default', lon: c[0].toFixed(4), lat: c[1].toFixed(4) })}`;
  try {
    const res = await fetch(url, { signal: searchCtrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    renderResults(parsePhoton(await res.json()));
  } catch (e) {
    if (e.name === 'AbortError') return;
    $('results').innerHTML = '<li class="empty">Nie udało się wyszukać. Sprawdź połączenie.</li>';
    show('results', true);
  }
}

export function parsePhoton(json) {
  return ((json && json.features) || []).map((f) => {
    const p = f.properties || {};
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const main = p.name || street || p.city || 'Miejsce';
    const sub = [p.name && street ? street : null, [p.postcode, p.city || p.county].filter(Boolean).join(' '), p.state]
      .filter(Boolean).join(', ');
    return { main, sub, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  });
}

function renderResults(list) {
  const ul = $('results');
  if (!list.length) ul.innerHTML = '<li class="empty">Brak wyników.</li>';
  else {
    ul.innerHTML = list.map((r, i) => `<li><button data-i="${i}"><span class="r-ico">${icon.pin(22)}</span><span><div class="r-main">${esc(r.main)}</div><div class="r-sub">${esc(r.sub)}</div></span></button></li>`).join('');
    ul.querySelectorAll('button').forEach((b) => (b.onclick = () => chooseDest(list[+b.dataset.i])));
  }
  show('results', true);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Trasa: podgląd ----------
async function chooseDest(d) {
  show('results', false);
  input.value = d.main;
  S.dest = d;
  try { localStorage.setItem(STORAGE.lastDest, JSON.stringify(d)); } catch { /* ignoruj */ }
  await planRoute();
}

async function planRoute() {
  const d = S.dest;
  const from = S.pos ? [S.pos.lng, S.pos.lat] : map.getCenter().toArray();
  toast('Wyznaczam trasę…', 8000);
  try {
    S.routes = await fetchRoutes(CONFIG.routingUrl, [from, [d.lng, d.lat]]);
  } catch (e) {
    toast('Nie udało się wyznaczyć trasy. Spróbuj ponownie.', 4000);
    return;
  }
  $('toast').hidden = true;
  S.sel = 0;
  S.mode = 'preview';
  S.hazardsReady = false;
  setMode('preview');
  $('p-dest').textContent = d.main;
  renderRouteCards();
  drawRoutes();
  fitRoutes();
  if (destMarker) destMarker.remove();
  const pin = document.createElement('div');
  pin.className = 'dest-pin';
  pin.innerHTML = icon.pin(40);
  destMarker = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([d.lng, d.lat]).addTo(map);
  S.osm = { cameras: [], sections: [] };
  const routesNow = S.routes;
  loadHazards(routesNow).then(({ live }) => {
    if (S.mode !== 'preview' || S.routes !== routesNow) return;
    S.hazardsReady = true;
    applyHazards(routesNow);
    renderRouteCards();
    renderHazardMarkers(routesNow[S.sel]);
    // Overpass na żywo dopełnia dane po chwili.
    live.then(() => {
      if (S.routes !== routesNow) return;
      applyHazards(routesNow);
      if (S.mode === 'preview') { renderRouteCards(); renderHazardMarkers(routesNow[S.sel]); }
    });
  });
}

function fitRoutes() {
  const all = S.routes.flatMap((r) => r.coords);
  const b = all.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
  const h = window.innerHeight;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 150, bottom: Math.round(h * 0.5), left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 800, maxZoom: 15 });
}

function routeName(r, i) {
  if (i === 0) return `Najszybsza${r.summary ? ` · przez ${r.summary}` : ''}`;
  return r.summary ? `Alternatywa · przez ${r.summary}` : `Alternatywa ${i}`;
}

function renderRouteCards() {
  const box = $('routes');
  box.innerHTML = S.routes.map((r, i) => {
    let tags;
    if (!S.hazardsReady) tags = '<span class="tag load">sprawdzam ostrzeżenia…</span>';
    else {
      const cams = (r.hz.cams || []).filter((h) => h.type === 'camera' || h.type === 'redlight').length;
      const secs = (r.hz.secs || []).length;
      const other = (r.hz.cams || []).length - cams;
      tags = '';
      if (cams) tags += `<span class="tag cam">${cams} ${plural(cams, 'fotoradar', 'fotoradary', 'fotoradarów')}</span>`;
      if (secs) tags += `<span class="tag sec">${secs} ${plural(secs, 'odcinkowy', 'odcinkowe', 'odcinkowych')}</span>`;
      if (other) tags += `<span class="tag sec">${other} ${plural(other, 'zgłoszenie', 'zgłoszenia', 'zgłoszeń')}</span>`;
    }
    return `<button class="route-card ${i === S.sel ? 'sel' : ''}" data-i="${i}">
      <div class="rc-top"><span class="rc-time">${fmtDuration(r.duration)}</span><span class="rc-dist">${fmtDist(r.distance)}</span></div>
      <div class="rc-name">${esc(routeName(r, i))}</div><div class="rc-tags">${tags}</div></button>`;
  }).join('');
  box.querySelectorAll('.route-card').forEach((b) => (b.onclick = () => {
    S.sel = +b.dataset.i;
    renderRouteCards();
    drawRoutes();
    if (S.hazardsReady) renderHazardMarkers(S.routes[S.sel]);
  }));
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const t = n % 10, h = n % 100;
  return t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? few : many;
}

// ---------- Dane o zagrożeniach ----------
const ovCache = new Map();

const WINDOW_M = 60000;

async function loadLocal() {
  if (S.localLoaded) return;
  S.localLoaded = true;
  try {
    const r = await fetch(CONFIG.localHazardsUrl, { cache: 'no-cache' });
    if (r.ok) S.local = await r.json();
  } catch { /* brak pliku: pracujemy na samym OSM */ }
}

async function loadStatic() {
  if (S.staticLoaded) return;
  S.staticLoaded = true;
  const get = async (u) => {
    try { const r = await fetch(u, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
  };
  const [osm, gitd] = await Promise.all([get(CONFIG.staticOsmUrl), get(CONFIG.staticGitdUrl)]);
  S.static = { osm, gitd };
  const n = (x) => (x ? (x.cameras || []).length + (x.sections || []).length : 0);
  S.hzStatus = { ...(S.hzStatus || {}), osmFile: n(osm), gitd: n(gitd) };
}

// Publiczny Overpass odrzuca zbyt wiele zapytań naraz: dwa równoległe, z ponowieniami.
async function fetchBoxes(boxes) {
  const parts = [];
  let failed = 0;
  const queue = [...boxes];
  const worker = async () => {
    while (queue.length) {
      const b = queue.shift();
      const key = b.map((v) => v.toFixed(3)).join();
      if (ovCache.has(key)) { parts.push(ovCache.get(key)); continue; }
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 30000);
          const res = await fetch(CONFIG.overpassUrl, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(b) }), signal: ctrl.signal });
          clearTimeout(t);
          if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
          if (!res.ok) break;
          const parsed = parseOverpass(await res.json());
          ovCache.set(key, parsed);
          parts.push(parsed);
          ok = true;
        } catch {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      if (!ok) failed++;
    }
  };
  await Promise.all([worker(), worker()]);
  return { parts, failed };
}

function addOsm(parts) {
  const seen = new Set(S.osm.cameras.map((c) => c.id));
  const seenS = new Set(S.osm.sections.map((c) => c.id));
  for (const p of parts) {
    for (const c of p.cameras) if (!seen.has(c.id)) { seen.add(c.id); S.osm.cameras.push(c); }
    for (const c of p.sections) if (!seenS.has(c.id)) { seenS.add(c.id); S.osm.sections.push(c); }
  }
}

/** Trasy krótkie: jedno zapytanie na obwiednię. Długie (>80 km): okno [fromM, toM] wzdłuż trasy. */
// Trzy źródła: plik OSM (cała Polska), plik GITD i Overpass na żywo. Pliki są dostępne od razu;
// Overpass dochodzi w tle i niepowodzenie niczego nie psuje (nie pokazujemy o nim komunikatów).
async function loadHazards(routes, { fromM = 0, toM = WINDOW_M } = {}) {
  await Promise.all([loadLocal(), loadStatic()]);
  const live = (async () => {
    const boxes = new Map();
    const long = routes.some((r) => r.distance > 80000);
    if (!long) {
      const all = routes.flatMap((r) => r.coords);
      const ub = all.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
      boxes.set('u', [ub[0] - 0.005, ub[1] - 0.004, ub[2] + 0.005, ub[3] + 0.004]);
    } else {
      for (const r of routes) corridorBoxesRange(r.line, fromM, toM).forEach((b) => boxes.set(b.map((v) => v.toFixed(3)).join(), b));
    }
    try {
      const { parts, failed } = await fetchBoxes([...boxes.values()]);
      addOsm(parts);
      S.hzStatus = { ...(S.hzStatus || {}), live: failed ? (parts.length ? 'częściowo' : 'niedostępne') : 'ok' };
      return { failed };
    } catch {
      S.hzStatus = { ...(S.hzStatus || {}), live: 'niedostępne' };
      return { failed: 1 };
    }
  })();
  return { live };
}

function itemsFor(route) {
  return [
    ...route.hz.cams,
    ...route.hz.secs.map((s) => ({ id: s.id, type: 'section', along: s.startAlong, limit: s.limit, lng: s.start[0], lat: s.start[1] })),
  ].sort((a, b) => a.along - b.along);
}

function rebuildWatch(N) {
  applyHazards([N.route]);
  const done = N.watch.done;
  N.watch = new HazardWatch(itemsFor(N.route));
  N.watch.done = done;
  const known = new Map(N.trackers.map((t) => [t.s.id, t]));
  N.trackers = N.route.hz.secs.map((s) => known.get(s.id) || { s, t: new SectionTracker(s, s.limit) });
  renderHazardMarkers(N.route);
}

// Na długich trasach dane wczytujemy partiami, z wyprzedzeniem 25 km.
function maybeExtendHazards(N, along) {
  const route = N.route;
  if (route.distance <= 80000 || N.loading || N.loadedTo >= route.distance) return;
  if (along < N.loadedTo - 25000) return;
  N.loading = true;
  const from = N.loadedTo;
  const to = Math.min(route.distance, from + WINDOW_M);
  loadHazards([route], { fromM: from, toM: to }).then(({ live }) => live).then(({ failed }) => {
    if (S.nav !== N) return;
    if (!failed) N.loadedTo = to;
    rebuildWatch(N);
  }).finally(() => { N.loading = false; });
}

function allPoints() {
  const st = S.static || {};
  const merged = mergeSources([S.osm, st.osm, st.gitd], S.local);
  return { cameras: merged.cameras, sections: merged.sections };
}

function applyHazards(routes) {
  const { cameras, sections } = allPoints();
  const rep = reports.active();
  for (const r of routes) {
    r.hz = {
      cams: onRoute(r, [...cameras, ...rep.map((x) => ({ ...x }))]),
      secs: sectionsOnRoute(r, sections),
    };
  }
}

// ---------- Znaczniki zagrożeń ----------
function clearMarkers() {
  for (const m of S.markers.values()) m.remove();
  S.markers.clear();
}

function drawSections(route) {
  const src = map.getSource('secs');
  if (!src) return;
  const feats = route && route.hz ? route.hz.secs.map((x) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: sliceLine(route.line, x.startAlong, x.endAlong) } })) : [];
  src.setData({ type: 'FeatureCollection', features: feats });
}

function pinEl(kind, label, { limit = null, tag = '' } = {}) {
  const el = document.createElement('div');
  el.className = `hz ${kind}`;
  el.innerHTML = `<div class="in">${hazardPin(kind, { limit })}</div>${tag ? `<span class="hz-tag ${kind === 'end' ? 'end' : ''}">${tag}</span>` : ''}`;
  el.title = label;
  return el;
}

function renderHazardMarkers(route) {
  clearMarkers();
  drawSections(route);
  if (!route || !route.hz) return;
  const put = (id, el, lng, lat) => { S.markers.set(id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map)); };
  for (const h of route.hz.cams) {
    const label = TYPES[h.type] ? TYPES[h.type].label : 'Ostrzeżenie';
    if (h.type === 'camera') put(h.id, pinEl('camera', label, { limit: h.limit }), h.lng, h.lat);
    else if (h.type === 'redlight') put(h.id, pinEl('redlight', label), h.lng, h.lat);
    else if (h.type === 'section') put(h.id, pinEl('start', label, { limit: h.limit, tag: 'ODCINKOWY' }), h.lng, h.lat);
    else {
      const el = document.createElement('div');
      el.className = `hzr ${h.type}`;
      el.innerHTML = icon[h.type] ? icon[h.type](22) : icon.warn(22);
      el.title = label;
      S.markers.set(h.id, new maplibregl.Marker({ element: el }).setLngLat([h.lng, h.lat]).addTo(map));
    }
  }
  for (const x of route.hz.secs) {
    put(`${x.id}:s`, pinEl('start', `${TYPES.section.label}: początek`, { limit: x.limit, tag: 'START' }), x.start[0], x.start[1]);
    put(`${x.id}:e`, pinEl('end', `${TYPES.section.label}: koniec`, { tag: 'KONIEC' }), x.end[0], x.end[1]);
  }
}

// ---------- Tryby ekranu ----------
function setMode(m) {
  S.mode = m;
  show('search', m !== 'nav');
  show('hint', m === 'idle' && !S.dest);
  show('preview', m === 'preview');
  show('nav-panel', m === 'nav');
  show('maneuver', m === 'nav');
  show('speedbox', m === 'nav');
  show('btn-report', m === 'nav');
  show('btn-sound', m === 'nav');
  show('btn-locate', m !== 'nav');
  show('puck', m === 'nav');
  show('btn-resume', false);
  if (m !== 'nav') { show('banner', false); show('section', false); document.body.classList.remove('has-section'); }
  const lift = m === 'preview' ? window.innerHeight * 0.5 : m === 'nav' ? 110 : 0;
  document.documentElement.style.setProperty('--attr-lift', `${Math.round(lift)}px`);
  $('fabs').style.bottom = m === 'preview' ? `calc(var(--safe-b) + ${Math.round(window.innerHeight * 0.5)}px)` : '';
}

$('btn-cancel').onclick = () => {
  S.routes = []; S.dest = null; clearMarkers(); drawRoutes();
  if (destMarker) { destMarker.remove(); destMarker = null; }
  input.value = '';
  setMode('idle');
};

// ---------- Nawigacja ----------
function startNav({ sim = false } = {}) {
  const route = S.routes[S.sel];
  if (!route) return;
  if (!sim && !S.pos) { toast('Brak sygnału GPS. Wyjdź na otwartą przestrzeń albo użyj symulacji.', 4000); return; }
  voice.unlock();
  lockScreen();
  if (!route.limitsTried) {
    route.limitsTried = true;
    loadRouteLimits(CONFIG.limitsUrl, route).then((r) => { S.hzStatus = { ...(S.hzStatus || {}), limits: r.ok ? `ok (${Math.round(r.covered * 100)}% trasy ma znany limit)` : 'niedostępne' }; }).catch(() => {});
  }
  if (!route.hz) applyHazards([route]);

  const items = itemsFor(route);

  S.nav = {
    route,
    guidance: new Guidance(route),
    watch: new HazardWatch(items),
    loadedTo: route.distance > 80000 ? WINDOW_M : route.distance,
    loading: false,
    trackers: route.hz.secs.map((s) => ({ s, t: new SectionTracker(s, s.limit) })),
    lastReroute: 0,
    lastAdvice: 0,
    sectionHold: null,
    arrivedTimer: null,
  };
  S.follow = true;
  S.heading = route.line.coords.length > 1 ? bearing(route.line.coords[0], route.line.coords[1]) : 0;
  setMode('nav');
  renderHazardMarkers(route);
  $('btn-sound').innerHTML = voice.enabled ? icon.sound(24) : icon.mute(24);
  if (meMarker) { meMarker.remove(); meMarker = null; }
  document.activeElement && document.activeElement.blur();
  $('results').hidden = true;
  const start = S.pos ? [S.pos.lng, S.pos.lat] : route.coords[0];
  map.easeTo({ center: start, zoom: 16, pitch: settings.tilt ? 55 : 0, bearing: S.heading, duration: 900, padding: camPadding() });
  placePuck();
  voice.say('Ruszaj', { prio: 2 });
}

function camPadding() {
  const h = window.innerHeight;
  return { top: Math.round(h * 0.34), bottom: 120, left: 0, right: 0 };
}

function placePuck() {
  const h = window.innerHeight;
  const p = camPadding();
  const y = p.top + (h - p.top - p.bottom) / 2;
  const puck = $('puck');
  puck.style.top = `${y}px`;
  puck.innerHTML = `<svg viewBox="0 0 64 64" id="puck-svg" aria-hidden="true"><path d="M32 8 L47 50 L32 42 L17 50Z" fill="#f3efe6" stroke="#0b0b0d" stroke-width="3.5" stroke-linejoin="round"/></svg>`;
}
window.addEventListener('resize', () => { if (S.mode === 'nav') placePuck(); });

let wlWanted = false;
async function lockScreen() {
  wlWanted = true;
  try { if (navigator.wakeLock) S.wl = await navigator.wakeLock.request('screen'); } catch { /* np. słaba bateria */ }
}
function unlockScreen() {
  wlWanted = false;
  try { S.wl && S.wl.release(); } catch { /* ignoruj */ }
  S.wl = null;
}
document.addEventListener('visibilitychange', () => { if (wlWanted && document.visibilityState === 'visible') lockScreen(); });

function smoothHeading(target) {
  const d = ((target - S.heading + 540) % 360) - 180;
  S.heading = (S.heading + d * 0.45 + 360) % 360;
  return S.heading;
}

function navTick(fix) {
  const N = S.nav;
  if (!N) return;
  const g = N.guidance.update(fix);
  const speedMs = fix.speed || 0;
  const kmh = Math.round(speedMs * 3.6);

  // Kierunek kamery: z GPS przy ruchu, inaczej wg trasy.
  let target = S.heading;
  if (fix.heading != null && isFinite(fix.heading) && speedMs > 1.5) target = fix.heading;
  else if (g.next && N.route.line) target = trackBearing(N.route, g.along);
  const hd = smoothHeading(target);

  // Prędkość i limit
  $('speed-v').textContent = String(kmh);
  const lim = limitAt(N.route, g.along);
  const limEl = $('limit');
  limEl.hidden = !lim;
  if (lim) { limEl.textContent = lim; }
  const over = lim ? kmh > lim + 2 : false;
  limEl.classList.toggle('over', over);
  $('speed').classList.toggle('over', over);

  // Karta manewru
  const nx = g.next;
  $('m-arrow').innerHTML = arrow(nx.icon, 50);
  $('m-dist').textContent = nx.type === 'arrive' && g.distToNext < 30 ? 'Cel' : fmtDist(g.distToNext);
  $('m-text').textContent = nx.text;

  // Czas i dystans
  const arr = new Date((fix.t || Date.now()) + g.remTime * 1000);
  $('n-time').textContent = fmtDuration(g.remTime);
  $('n-sub').textContent = `${fmtDist(g.remaining)} · przyjazd ${String(arr.getHours()).padStart(2, '0')}:${String(arr.getMinutes()).padStart(2, '0')}`;

  // Ostrzeżenia
  const w = N.watch.update(g.along, speedMs, lim);
  showBanner(w, kmh, lim);
  if (settings.hazardsVoice) {
    for (const t of w.say) voice.say(t, { prio: w.level === 'final' ? 4 : 2 });
  }
  if (w.level === 'final' && w.say.length) voice.beep(1000, 160);
  for (const t of g.spoken) voice.say(t, { prio: /^Za /.test(t) ? 1 : 3 });

  // Odcinkowe pomiary
  updateSections(N, g, fix);

  // Chip z dalszym zdarzeniem (nie fotoradar)
  const far = N.route.hz.cams.find((h) => h.along > g.along + 1000 && !['camera', 'redlight'].includes(h.type) && h.along - g.along < 12000);
  const chip = $('n-chip');
  chip.hidden = !far;
  if (far) chip.innerHTML = `${icon.warn(16)}${TYPES[far.type].label} za ${fmtDist(far.along - g.along)}`;

  maybeExtendHazards(N, g.along);

  // Kamera i znacznik pojazdu
  const useSnap = g.offDist < 25 && g.point;
  const c = useSnap ? g.point : [fix.lng, fix.lat];
  const zoom = kmh > 100 ? 14.8 : kmh > 70 ? 15.4 : kmh > 40 ? 16 : 16.6;
  N.cam = { c, hd, zoom };
  if (!S.follow && navMarker) { navMarker.setLngLat(c); navMarker.setRotation(hd); }
  if (S.follow) {
    const dur = fix.sim ? Math.max(120, 900 / (S.simSpeedup || 1)) : 950;
    map.easeTo({ center: c, bearing: hd, zoom, pitch: settings.tilt ? 55 : 0, duration: dur, easing: (t) => t, padding: camPadding() });
  }

  // Zjechanie z trasy
  const now = Date.now();
  if (g.offRoute && now - N.lastReroute > 10000) {
    N.lastReroute = now;
    reroute(fix);
  }
  if (g.arrived && !N.arrivedTimer) {
    voice.say('Dojechałeś do celu', { prio: 3 });
    toast('Dojechałeś do celu', 5000);
    N.arrivedTimer = setTimeout(endNav, 6000);
  }
}

function trackBearing(route, along) {
  const a = Math.min(route.line.total, along);
  let i = 0;
  while (i < route.line.cum.length - 2 && route.line.cum[i + 1] < a) i++;
  return bearing(route.line.coords[i], route.line.coords[i + 1]);
}

function showBanner(w, kmh, lim) {
  const b = $('banner');
  const h = w.ahead[0];
  if (!h || w.level === 'none') { b.hidden = true; return; }
  b.hidden = false;
  b.className = `glass ${w.level === 'final' ? 'final' : w.level === 'alert' ? 'alert' : 'info'}`;
  $('b-ico').innerHTML = (icon[h.type] || icon.warn)(26);
  $('b-title').textContent = `${TYPES[h.type].label} za ${fmtDist(h.dist)}`;
  const hl = h.limit || lim;
  const parts = [];
  if (hl && (h.type === 'camera' || h.type === 'redlight' || h.type === 'section')) parts.push(`Limit ${hl} km/h`);
  parts.push(`jedziesz ${kmh}`);
  $('b-sub').textContent = parts.join(' · ');
}

function updateSections(N, g, fix) {
  const t = fix.t || Date.now();
  let active = null;
  for (const tr of N.trackers) {
    const st = tr.t.update(g.along, t);
    tr.st = st;
    if (st.phase === 'inside') active = tr;
    if (st.phase === 'done' && !tr.announced) {
      tr.announced = true;
      N.sectionHold = { tr, until: Date.now() + 9000 };
      voice.say(`Koniec odcinka. Średnia ${Math.round(st.avgKmh)}${st.over ? ', powyżej limitu' : ''}`);
    }
  }
  const hold = N.sectionHold && Date.now() < N.sectionHold.until ? N.sectionHold.tr : null;
  const tr = active || hold;
  const el = $('section');
  if (!tr) { el.hidden = true; document.body.classList.remove('has-section'); return; }
  const st = tr.st;
  el.hidden = false;
  document.body.classList.add('has-section');
  el.className = `glass ${st.phase === 'done' ? 'done' : ''}`;
  const lim = st.limit;
  if (st.phase === 'inside') {
    let advice = '';
    if (st.over && lim && st.allowedKmh != null) {
      // Gdy średnia jest już nie do odrobienia, podawanie „zwolnij do 3 km/h” byłoby absurdem.
      const lost = st.allowedKmh < lim * 0.35;
      advice = lost
        ? `<div class="s-advice">Średnia już powyżej limitu. Jedź zgodnie z ograniczeniem do końca odcinka</div>`
        : `<div class="s-advice">Zwolnij do ${Math.floor(st.allowedKmh)} km/h, żeby zmieścić się w limicie średniej</div>`;
      if (Date.now() - N.lastAdvice > 25000) {
        N.lastAdvice = Date.now();
        voice.say(lost ? `Średnia ${Math.round(st.avgKmh)}, powyżej limitu. Jedź zgodnie z ograniczeniem` : `Zwolnij do ${Math.floor(st.allowedKmh)}. Średnia ${Math.round(st.avgKmh)}, limit ${lim}`);
      }
    }
    el.innerHTML = `<div class="s-head"><span><i class="s-dot"></i>${TYPES.section.label}</span><span>${fmtDist(st.length)}</span></div>
      <div class="s-row"><div><div class="s-lbl">Twoja średnia na odcinku</div><div class="s-avg ${st.over ? 'over' : ''}">${Math.round(st.avgKmh)}<small>km/h</small></div></div>
      ${lim ? `<div><div class="s-lbl" style="text-align:right">Limit</div><div class="s-lim">${lim}</div></div>` : ''}</div>
      <div class="s-bar"><i style="width:${Math.round(st.progress * 100)}%"></i></div>
      <div class="s-rem"><span>Do końca odcinka</span><b>${fmtDist(st.remaining)}</b></div>${advice}`;
  } else {
    el.innerHTML = `<div class="s-head"><span><i class="s-dot"></i>Koniec odcinka</span><span>${fmtDist(st.length)}</span></div>
      <div class="s-row"><div><div class="s-lbl">Średnia na odcinku</div><div class="s-avg ${st.over ? 'over' : ''}">${Math.round(st.avgKmh)}<small>km/h</small></div></div>
      ${lim ? `<div><div class="s-lbl" style="text-align:right">Limit</div><div class="s-lim">${lim}</div></div>` : ''}</div>`;
  }
}

async function reroute(fix) {
  const N = S.nav;
  toast('Zjechałeś z trasy. Przeliczam…', 4000);
  voice.say('Przeliczam trasę', { prio: 3 });
  try {
    const rs = await fetchRoutes(CONFIG.routingUrl, [[fix.lng, fix.lat], [S.dest.lng, S.dest.lat]], { alternatives: false });
    if (S.mode !== 'nav' || S.nav !== N) return;
    const route = rs[0];
    applyHazards([route]);
    const items = itemsFor(route);
    N.route = route;
    N.guidance.reset(route);
    N.loadedTo = 0;
    N.loading = false;
    N.watch = new HazardWatch(items);
    N.trackers = route.hz.secs.map((s) => ({ s, t: new SectionTracker(s, s.limit) }));
    S.routes = [route];
    S.sel = 0;
    drawRoutes();
    renderHazardMarkers(route);
  } catch {
    toast('Nie udało się przeliczyć trasy', 3500);
  }
}

function endNav() {
  voice.hold(false);
  clearTimeout(resumeTimer);
  if (navMarker) { navMarker.remove(); navMarker = null; }
  if (S.nav && S.nav.arrivedTimer) clearTimeout(S.nav.arrivedTimer);
  if (S.sim) { S.sim.stop(); S.sim = null; S.simSpeedup = 1; }
  S.nav = null;
  unlockScreen();
  clearMarkers();
  S.routes = []; S.dest = null;
  drawRoutes();
  if (destMarker) { destMarker.remove(); destMarker = null; }
  input.value = '';
  setMode('idle');
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, zoom: 14, duration: 700 });
  if (S.pos) { meMarker = new maplibregl.Marker({ element: meEl() }).setLngLat([S.pos.lng, S.pos.lat]).addTo(map); }
}

$('btn-start').onclick = () => startNav();
$('btn-sim').onclick = () => {
  const route = S.routes[S.sel];
  if (!route) return;
  startNav({ sim: true });
  S.simSpeedup = 4;
  S.sim = new Simulator(route, { speedKmh: 50, speedup: S.simSpeedup, onFix: (f) => onFix(f) });
  S.sim.start();
  toast('Symulacja jazdy: dotknij prędkości, by ją zmienić', 4000);
};
$('btn-end').onclick = endNav;

// Dotknięcie prędkości w symulacji zmienia ją (30/50/90/130).
$('speed').onclick = () => {
  if (!S.sim) return;
  const seq = [30, 50, 90, 130];
  const cur = Math.round(S.sim.v * 3.6);
  const i = seq.findIndex((v) => v > cur + 1);
  const next = seq[i === -1 ? 0 : i];
  S.sim.setSpeed(next);
  toast(`Symulacja: ${next} km/h`, 1500);
};

// Każdy gest użytkownika na mapie (przeciągnięcie, szczypanie, obrót) wstrzymuje podążanie.
// Wtedy zamiast stałej strzałki na ekranie pojawia się znacznik w prawdziwym miejscu na mapie.
let navMarker = null;
let resumeTimer = null;

function pauseFollow() {
  S.follow = false;
  show('btn-resume', true);
  show('puck', false);
  if (!navMarker && S.lastFix) {
    const el = document.createElement('div');
    el.className = 'nav-arrow';
    el.innerHTML = '<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true"><path d="M32 8 L47 50 L32 42 L17 50Z" fill="#f3efe6" stroke="#0b0b0d" stroke-width="3.5" stroke-linejoin="round"/></svg>';
    const at = (S.nav && S.nav.cam && S.nav.cam.c) || [S.lastFix.lng, S.lastFix.lat];
    navMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat(at).setRotation(S.heading).addTo(map);
  }
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(resumeFollow, 15000); // po 15 s bez dotyku wracamy do jazdy
}

function resumeFollow() {
  clearTimeout(resumeTimer);
  S.follow = true;
  show('btn-resume', false);
  if (navMarker) { navMarker.remove(); navMarker = null; }
  if (S.mode !== 'nav') return;
  show('puck', true);
  // Od razu wracamy kamerą za pojazd, nie czekamy na kolejny odczyt GPS.
  const cam = S.nav && S.nav.cam;
  if (cam) map.easeTo({ center: cam.c, bearing: cam.hd, zoom: cam.zoom, pitch: settings.tilt ? 55 : 0, duration: 600, padding: camPadding() });
}

map.on('movestart', (e) => { if (S.mode === 'nav' && e.originalEvent) pauseFollow(); });
$('btn-resume').onclick = resumeFollow;
$('btn-locate').addEventListener('click', () => { if (S.mode === 'nav') resumeFollow(); });

// ---------- Zgłoszenia ----------
$('btn-report').onclick = () => show('report', true);
$('btn-report-x').onclick = () => show('report', false);
$('report-grid').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  const t = b.dataset.t;
  if (!S.pos) { toast('Brak pozycji GPS'); return; }
  reports.add(t, S.pos.lng, S.pos.lat);
  show('report', false);
  toast(`Zgłoszono: ${TYPES[t].label}`);
  voice.say('Dziękuję za zgłoszenie');
  if (S.nav) {
    // dołącz do bieżącej trasy i odśwież znaczniki
    applyHazards([S.nav.route]);
    renderHazardMarkers(S.nav.route);
  }
}));

// ---------- Głos i menu ----------
$('btn-sound').onclick = () => {
  voice.enabled = !voice.enabled;
  settings.voice = voice.enabled;
  saveSettings(settings);
  $('btn-sound').innerHTML = voice.enabled ? icon.sound(24) : icon.mute(24);
  toast(voice.enabled ? 'Głos włączony' : 'Głos wyłączony', 1500);
};

function syncMenu() {
  const sw = (id, on) => { $(id).classList.toggle('on', !!on); $(id).setAttribute('aria-checked', String(!!on)); };
  sw('sw-voice', settings.voice);
  sw('sw-hz', settings.hazardsVoice);
  sw('sw-tilt', settings.tilt);
  document.querySelectorAll('#seg-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.theme));
  document.querySelectorAll('#seg-engine button').forEach((b) => b.classList.toggle('on', b.dataset.v === (settings.ttsEngine === 'robot' ? 'robot' : 'system')));
}
$('btn-menu').onclick = () => { syncMenu(); show('menu', true); };
$('btn-menu-x').onclick = () => show('menu', false);
$('sw-voice').onclick = () => { settings.voice = !settings.voice; voice.enabled = settings.voice; saveSettings(settings); syncMenu(); };
$('sw-hz').onclick = () => { settings.hazardsVoice = !settings.hazardsVoice; saveSettings(settings); syncMenu(); };
$('sw-tilt').onclick = () => { settings.tilt = !settings.tilt; saveSettings(settings); syncMenu(); };
document.querySelectorAll('#seg-theme button').forEach((b) => (b.onclick = () => {
  settings.theme = b.dataset.v; saveSettings(settings); syncMenu(); applyTheme();
}));

document.querySelectorAll('#seg-engine button').forEach((b) => (b.onclick = () => {
  settings.ttsEngine = b.dataset.v; voice.engine = b.dataset.v; voice.hold(false); saveSettings(settings); syncMenu();
}));

$('btn-voice-pick').onclick = () => {
  const v = voice.cycleVoice();
  if (!v) { toast('Brak polskich głosów w telefonie', 3000); return; }
  settings.voiceName = voice.prefName; saveSettings(settings);
  voice.say('Tak będę mówić. Za trzysta metrów skręć w prawo.', { urgent: true });
  toast(`Głos: ${v.name} (${qualityLabel(v)}). Dotknij ponownie, by zmienić.`, 4000);
};
$('btn-voice-log').onclick = () => {
  const el = $('voice-log');
  el.hidden = !el.hidden;
  const hz = S.hzStatus || {};
  el.textContent = `Wersja ${APP_VERSION}, silnik: ${voice.engine}, głos: ${voice.voice ? voice.voice.name : 'brak'}, mowa włączona: ${voice.enabled}\nDane: plik OSM ${hz.osmFile ?? '?'} pkt, GITD ${hz.gitd ?? '?'} pkt, Overpass ${hz.live || '…'}, limity prędkości ${hz.limits || '…'}\n` + (voice.events.length ? voice.events.join('\n') : 'Brak zdarzeń. Uruchom symulację i wróć tutaj.');
};

// ---------- Start ----------
setMode('idle');
startGeo();
$('app-ver').textContent = APP_VERSION;
let voiceErrShown = false;
voice.onError = (e) => { if (voiceErrShown) return; voiceErrShown = true; toast(`Głos: błąd (${e}). Sprawdź menu, Sprawdź głos`, 4500); };
$('btn-voice-test').onclick = () => {
  voice.unlock();
  const i = voice.test();
  const msg = !i.supported ? 'Ta przeglądarka nie ma syntezatora mowy'
    : i.robot ? 'Głos wbudowany. Po sygnale powinieneś usłyszeć mowę. Brak mowy? Napisz mi, co dalej słychać.'
    : i.pl ? `Głos polski: ${i.pl}. Teraz bez sygnału, sama mowa. Słychać Zosię?`
    : `Brak polskiego głosu (głosów: ${i.voices}). Dodaj go: Ustawienia, Dostępność, Treści czytane, Głosy.`;
  toast(msg, 9000);
};
$('btn-refresh').onclick = async () => {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await window.caches?.keys()) || [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* przeładujemy mimo błędu */ }
  location.reload();
};
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Gdy nowa wersja przejmie stronę, przeładuj raz (nie w trakcie jazdy).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (S.mode === 'nav') { toast('Nowa wersja gotowa: zamknij i otwórz aplikację po jeździe', 6000); return; }
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => reg.update().catch(() => {})).catch(() => {});
}

// Haki do testów i diagnostyki (nie zmieniają działania aplikacji).
window.__nav = { S, map, voice, settings, onFix, chooseDest, startNav, endNav, parsePhoton, reports };
