import { Places } from './places.js';
import { CONFIG, APP_VERSION, VOICES, loadSettings, saveSettings, STORAGE } from './config.js';
import { buildStyle, isNight } from './mapstyle.js';
import { ROUTE_PREFS, DEFAULT_PREF } from './valhalla.js';
import { getRoutes } from './provider.js';
import { FixStore, FIX_LABEL } from './fixes.js';
import { unpackFuel, candidatesAhead, fuelDetours, bestStation, fmtExtra } from './fuel.js';
import { explainRoute } from './explain.js';
import { TripRecorder, TRIP, speedStops, revealStops, replayFrames, drawPoster, fmtTripTime } from './trip.js';
import { modeOf, DEFAULT_MODE, MODES } from './modes.js';
import { Compass } from './compass.js';
import { buildRoadItems, unpackRoadPoints, RoadWatch, describe as describeRoad } from './roadwise.js';
import {
  atmosphere, routeGradient, gradientExpr, ROUTE_PLAIN, maneuverArrow, wantsArrow, speedRing,
} from './cockpit.js';
import { fmtDist, fmtDuration, limitAt } from './routing.js';
import { Guidance } from './guidance.js';
import { SpeedFilter } from './speed.js';
import { loadRouteLimits } from './limits.js';
import {
  HazardWatch, SectionTracker, ReportStore, TYPES,
} from './hazards.js';
import { ChaseCam } from './camera.js';
import { lanesHtml, laneAdvice } from './lanes.js';
import { routePoints, fetchTraffic, jamsOnLine, jamFeatures, worthSwitch, nextJam, departAt } from './traffic.js';
import { City3D } from './city3d.js';
import { addFacades, loadFacades } from './facades.js';
import { prefetchOrto } from './orto.js';
import { corridorBoxesRange, haversine, bearing, sliceLine, project } from './geo.js';
import { createHazardData, WINDOW_M } from './hazard-data.js';
import { Voice } from './voice.js';
import { Simulator } from './sim.js';
import { icon, arrow, hazardPin } from './icons.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const voice = new Voice();
voice.enabled = settings.voice;
voice.setVoice(settings.ttsEngine);
voice.cloudUrl = CONFIG.ttsUrl || '';
voice.prefName = settings.voiceName || '';
const reports = new ReportStore();
const fixStore = new FixStore({ url: CONFIG.fixesUrl });
const compass = new Compass();
const hd = createHazardData(CONFIG, reports);
const { loadHazards, itemsFor, applyHazards } = hd;

const S = {
  travel: modeOf(settings.travel).id, // auto | pedestrian | bicycle (modes.js)
  pref: ROUTE_PREFS[settings.routePref] ? settings.routePref : DEFAULT_PREF, // samochód: fast | balanced | short
  mode: 'idle', // idle | preview | nav
  pos: null,
  dest: null,
  routes: [],
  sel: 0,
  hazardsReady: false,
  nav: null,
  follow: true,
  sim: null,
  markers: new Map(),
  heading: 0,
  lastFix: null,
  wl: null,
};

const travel = () => modeOf(S.travel);

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
).join('') + ['avoid', 'okroad'].map((k) => `<button data-fix="${k === 'avoid' ? 'avoid' : 'ok'}" class="fixbtn">${icon[k](30)}<span>${FIX_LABEL[k === 'avoid' ? 'avoid' : 'ok']}</span></button>`).join('');

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

await loadFacades(); // tekstury muszą być gotowe, zanim mapa zbuduje kafelki
const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(night ? 'night' : 'day', CONFIG, S.travel),
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  maxPitch: 85,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2), // ostrość telefonu kosztuje płynność: 2× wystarcza w aucie
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
    map.addSource('sel', { type: 'geojson', data: emptyFC(), lineMetrics: true }); // lineMetrics: gradient wzdłuż trasy
  }
  if (!map.getSource('orto') && CONFIG.ortoUrl) {
    map.addSource('orto', { type: 'raster', tiles: [CONFIG.ortoUrl], tileSize: 512, minzoom: 12, maxzoom: 17, attribution: 'Ortofotomapa: GUGiK' });
    const under = map.getLayer('minor-case') ? 'minor-case' : undefined;
    const vis = settings.ortho === false ? 'none' : 'visible';
    // podkład w kolorze zdjęcia: póki kafel się wczytuje, nie ma jasnej plamy
    map.addLayer({ id: 'orto-base', type: 'background', layout: { visibility: vis }, paint: { 'background-color': night ? '#0D1A2C' : '#7F8872', 'background-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 1] } }, under);
    map.addLayer({ id: 'orto', type: 'raster', source: 'orto', minzoom: 12.5, layout: { visibility: vis }, paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 1], 'raster-brightness-max': night ? 0.3 : 1, 'raster-saturation': night ? -0.5 : 0.08, 'raster-fade-duration': 250 } }, under);
  }
  if (!map.getSource('secs')) map.addSource('secs', { type: 'geojson', data: emptyFC() });
  // Trasa leży POD budynkami 3D, żeby bloki ją zasłaniały jak w rzeczywistości.
  const before = map.getLayer('building-3d') ? 'building-3d' : (map.getLayer('road-label') ? 'road-label' : undefined);
  addFacades(map, night);
  const route = '#00D9FF';
  const routeCase = '#74CFFF';
  const add = (def) => { if (!map.getLayer(def.id)) map.addLayer(def, before); };
  add({ id: 'alt-line', type: 'line', source: 'alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': night ? '#5a5a66' : '#9a9588', 'line-width': 6, 'line-opacity': 0.9 } });
  const grad = ['interpolate', ['linear'], ['line-progress'], 0, route, 1, route];
  add({ id: 'sel-glow', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': grad, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 9, 14, 19.8, 20, 170], 'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 8, 6, 14, 12, 20, 110], 'line-opacity': night ? 0.7 : 0.45 } });
  add({ id: 'sel-case', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, routeCase, 1, routeCase], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 6.5, 14, 14.3, 20, 89] } });
  add({ id: 'sel-line', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': grad, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 4.5, 14, 9.9, 20, 77], 'line-opacity': 0.92 } });
  add({ id: 'sec-line', type: 'line', source: 'secs', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#ffcf3a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 6], 'line-dasharray': [2, 1.3] } });
  if (!map.getSource('jam')) map.addSource('jam', { type: 'geojson', data: emptyFC() });
  add({ id: 'jam-line', type: 'line', source: 'jam', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'sev'], 1, '#FFB547', 2, '#FF5364', '#A3122A'], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 4.5, 14, 9.9, 20, 77] } });
  // szewrony na wstędze: stałe, leżą na jezdni i pokazują kierunek przed autem (bez animacji w czasie jazdy)
  if (!map.getSource('ahead')) map.addSource('ahead', { type: 'geojson', data: emptyFC() });
  if (!map.hasImage('chevron')) map.addImage('chevron', chevronImage());
  add({ id: 'sel-chevron', type: 'symbol', source: 'ahead', layout: { 'symbol-placement': 'line', 'symbol-spacing': 64, 'icon-image': 'chevron', 'icon-size': ['interpolate', ['exponential', 2], ['zoom'], 14, 0.018, 20, 1.15], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-keep-upright': false }, paint: { 'icon-opacity': 0.85 } });
  // strzałka skrętu „namalowana” na jezdni (leży na ziemi, więc w widoku 3D jest w perspektywie)
  if (!map.getSource('arrow')) map.addSource('arrow', { type: 'geojson', data: emptyFC() });
  const aw = ['interpolate', ['linear'], ['zoom'], 14, 3, 17, 9, 19, 24];
  add({ id: 'arrow-case', type: 'line', source: 'arrow', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#071426', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 17, 13, 19, 28], 'line-opacity': 0.85 } });
  add({ id: 'arrow-line', type: 'line', source: 'arrow', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#F5FAFF', 'line-width': aw } });
  add({ id: 'arrow-head-case', type: 'line', source: 'arrow', filter: ['==', ['geometry-type'], 'Polygon'], layout: { 'line-join': 'round' }, paint: { 'line-color': '#071426', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 19, 8], 'line-opacity': 0.85 } });
  add({ id: 'arrow-head', type: 'fill', source: 'arrow', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#F5FAFF' } });
  if (!map.getSource('trip')) map.addSource('trip', { type: 'geojson', data: emptyFC(), lineMetrics: true });
  const tripGrad = ['interpolate', ['linear'], ['line-progress'], 0, '#4cb8ff', 1, '#4cb8ff'];
  add({ id: 'trip-glow', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': tripGrad, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 10, 16, 36], 'line-blur': 10, 'line-opacity': 0.55 } });
  add({ id: 'trip-line', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': tripGrad, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 16, 10] } });
  if (!map.getSource('fixes')) map.addSource('fixes', { type: 'geojson', data: emptyFC() });
  if (!map.getLayer('fixes-dot')) map.addLayer({ id: 'fixes-dot', type: 'circle', source: 'fixes', minzoom: 11, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 17, 11], 'circle-color': ['match', ['get', 'kind'], 'avoid', '#ff5a4d', '#3ddc84'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.95 } });
  if (CONFIG.cityBase && !map.getLayer('city3d')) {
    map.addLayer(new City3D(map, { base: CONFIG.cityBase, night, onCover: (on) => { for (const id of ['building', 'building-3d', 'building-roof']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible'); } }), map.getLayer('boundary') ? 'boundary' : undefined);
  }
  drawRoutes();
  drawSections(S.routes[S.sel]);
  drawTrip();
  applyAtmosphere();
  if (S.nav) { S.nav.arrowIdx = null; S.nav.paintedAlong = null; S.nav.aheadAlong = null; }
}
function chevronImage() {
  const n = 128; const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  g.strokeStyle = '#F5FAFF'; g.lineWidth = 24; g.lineCap = 'butt'; g.lineJoin = 'miter';
  g.beginPath(); g.moveTo(38, 14); g.lineTo(90, 64); g.lineTo(38, 114); g.stroke();
  return g.getImageData(0, 0, n, n);
}
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
map.on('style.load', installLayers);

// Kolor trasy: gradient wzdłuż linii wg limitu prędkości; przejechany fragment znika pod kołami.
function paintRoute(consumed = 0) {
  if (!map.getLayer('sel-line')) return;
  const r = S.nav ? S.nav.route : S.routes[S.sel];
  const plain = night ? ROUTE_PLAIN.night : ROUTE_PLAIN.day;
  const stops = r
    ? routeGradient(r, { plain, colorByLimit: settings.routeColor !== false, consumed: S.nav ? consumed : 0, shade: night ? 1 : 0.8 })
    : [[0, plain], [1, plain]];
  const expr = gradientExpr(stops);
  map.setPaintProperty('sel-line', 'line-gradient', expr);
  map.setPaintProperty('sel-glow', 'line-gradient', expr);
  // obwódka też „znika” z przejechanym fragmentem
  const caseCol = '#74CFFF';
  map.setPaintProperty('sel-case', 'line-gradient', gradientExpr(routeGradient(r || { distance: 1 }, { plain: caseCol, colorByLimit: false, consumed: r && S.nav ? consumed : 0 })));
}

// Światło i niebo zależne od pory dnia (dzień: ciepłe słońce z właściwej strony, noc: zimny księżyc).
function applyAtmosphere() {
  try {
    const at = S.pos || { lat: map.getCenter().lat, lng: map.getCenter().lng };
    const a = atmosphere(night, new Date(), at.lat, at.lng);
    map.setLight(a.light);
    if (map.setSky) map.setSky(a.sky);
  } catch { /* starsza przeglądarka bez nieba: mapa działa bez tego */ }
}
setInterval(applyAtmosphere, 300000);

function drawRoutes() {
  if (!map.getSource('sel')) return;
  const sel = S.routes[S.sel];
  map.getSource('sel').setData(sel ? { type: 'Feature', geometry: { type: 'LineString', coordinates: sel.coords } } : emptyFC());
  paintRoute();
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
  map.setStyle(buildStyle(night ? 'night' : 'day', CONFIG, S.travel));
}
setInterval(applyTheme, 60000);

// Styl mapy zależy też od sposobu poruszania się (pieszo: ścieżki i schody, rower: drogi rowerowe).
let styleTravel = S.travel;
function restyleForTravel() {
  const key = S.travel === 'auto' ? 'auto' : S.travel;
  if (key === styleTravel) return;
  styleTravel = key;
  map.setStyle(buildStyle(night ? 'night' : 'day', CONFIG, S.travel));
}

// ---------- Pozycja ----------
let meMarker = null;
let destMarker = null;

function meEl() {
  const d = document.createElement('div');
  d.className = 'me-dot';
  return d;
}

const speedFilter = new SpeedFilter();
let geoId = null;
function startGeo() {
  if (!navigator.geolocation) { toast('Ta przeglądarka nie ma GPS'); return; }
  if (geoId != null) { try { navigator.geolocation.clearWatch(geoId); } catch { /* ignoruj */ } }
  geoId = navigator.geolocation.watchPosition(
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
  if (S.restore && S.mode === 'idle' && !S.sim) { const d = S.restore.dest; S.restore = null; restoreNav(d); }
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
const places = new Places((() => { try { return localStorage; } catch { return { getItem: () => null, setItem() {} }; } })());
S.assign = null;

/** Lista pod polem: moje adresy (dom, praca, inne) i 5 ostatnich celów. */
function showQuick() {
  const ul = $('results');
  const saved = places.saved();
  const rec = places.recents();
  const rows = [];
  const items = [];
  const push = (html, fn) => { rows.push(html); items.push(fn); };
  const home = saved.find((x) => x.kind === 'home');
  const work = saved.find((x) => x.kind === 'work');
  rows.push('<li class="sec">Moje adresy</li>'); items.push(null);
  for (const x of saved) {
    push(`<li class="row2"><button data-a="go"><span class="r-ico">${x.kind === 'home' ? icon.home(22) : x.kind === 'work' ? icon.work(22) : icon.pin(22)}</span><span><div class="r-main">${esc(x.label)}</div><div class="r-sub">${esc(x.kind === 'other' ? x.sub || x.main : x.main + (x.sub ? ', ' + x.sub : ''))}</div></span></button><button class="r-x" data-a="del" aria-label="Usuń">${icon.close(18)}</button></li>`, { x, saved: true });
  }
  if (!home) push(`<li class="r-add"><button data-a="add-home"><span class="r-ico">${icon.plus(22)}</span><span><div class="r-main">Dodaj dom</div></span></button></li>`, { add: 'home' });
  if (!work) push(`<li class="r-add"><button data-a="add-work"><span class="r-ico">${icon.plus(22)}</span><span><div class="r-main">Dodaj pracę</div></span></button></li>`, { add: 'work' });
  if (rec.length) {
    rows.push('<li class="sec">Ostatnie</li>'); items.push(null);
    rec.forEach((x, i) => push(`<li class="row2"><button data-a="go"><span class="r-ico">${icon.clock(22)}</span><span><div class="r-main">${esc(x.main)}</div><div class="r-sub">${esc(x.sub)}</div></span></button><button class="r-x" data-a="del" aria-label="Usuń">${icon.close(18)}</button></li>`, { x, rec: i }));
  }
  ul.innerHTML = rows.join('');
  ul.querySelectorAll('li').forEach((li, idx) => {
    const it = items[idx];
    if (!it) return;
    li.querySelectorAll('button').forEach((b) => (b.onclick = (ev) => {
      ev.preventDefault();
      if (it.add) { S.assign = { kind: it.add }; input.value = ''; input.placeholder = it.add === 'home' ? 'Wpisz adres domu' : 'Wpisz adres pracy'; show('results', false); input.focus(); return; }
      if (b.dataset.a === 'del') { if (it.saved) places.removeSaved(it.x.id); else places.removeRecent(it.rec); showQuick(); return; }
      S.assign = null;
      chooseDest({ main: it.x.main, sub: it.x.sub, lng: it.x.lng, lat: it.x.lat });
    }));
  });
  S.quickShown = true;
  show('results', true);
}
input.addEventListener('focus', () => {
  const q = input.value.trim();
  if (S.dest && q === S.dest.main) input.select(); // dotknięcie pola po wybraniu celu: nowe wpisanie zastępuje stare
  if (input.value.trim().length < 3 || S.dest) showQuick();
});

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (q.length < 3) { if (document.activeElement === input) showQuick(); else show('results', false); return; }
  if (S.quickShown) { show('results', false); S.quickShown = false; } // nie zostawiamy starej listy pod wpisywanym tekstem
  searchTimer = setTimeout(() => runSearch(q), 300);
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); const q = input.value.trim(); if (q.length >= 2) runSearch(q); input.blur(); } });

/** „51,2465, 22,5684” lub „51.2465 22.5684” -> współrzędne (do testów i dokładnych punktów). */
export function parseCoords(q) {
  const m = /^\s*(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)\s*$/.exec(q || '');
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lng = parseFloat(m[2].replace(',', '.'));
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

async function runSearch(q) {
  const pt = parseCoords(q);
  if (pt) { renderResults([{ main: `Punkt ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`, sub: 'Współrzędne', lng: pt.lng, lat: pt.lat }]); return; }
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
  S.quickShown = false;
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
  if (S.assign) {
    const a = S.assign; S.assign = null;
    input.placeholder = 'Dokąd jedziemy?'; input.value = ''; input.blur();
    if (a.kind === 'other') { places.save('other', d, a.label); } else places.save(a.kind, d);
    toast(`Zapisano: ${a.kind === 'home' ? 'Dom' : a.kind === 'work' ? 'Praca' : a.label || d.main}`, 2500);
    return;
  }
  input.value = d.main;
  places.addRecent(d);
  S.saveFrom = d;
  document.querySelectorAll('#save-row button').forEach((b) => b.classList.remove('done'));
  S.dest = d;
  try { localStorage.setItem(STORAGE.lastDest, JSON.stringify(d)); } catch { /* ignoruj */ }
  await planRoute();
}

function renderTravelSeg() {
  $('seg-travel').innerHTML = Object.values(MODES).map((m) => `<button data-v="${m.id}" role="tab" class="${m.id === S.travel ? 'on' : ''}">${m.label}</button>`).join('');
  $('seg-travel').querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    if (b.dataset.v === S.travel) return;
    S.travel = b.dataset.v;
    settings.travel = S.travel;
    saveSettings(settings);
    renderTravelSeg();
    renderPrefSeg();
    restyleForTravel();
    if (S.dest) await planRoute();
  }));
}
function renderPrefSeg() {
  const el = $('seg-pref');
  el.hidden = S.travel !== 'auto';
  el.innerHTML = Object.entries(ROUTE_PREFS).map(([id, p]) => `<button data-v="${id}" role="tab" class="${id === S.pref ? 'on' : ''}">${p.label}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    if (b.dataset.v === S.pref) return;
    S.pref = b.dataset.v;
    settings.routePref = S.pref;
    saveSettings(settings);
    renderPrefSeg();
    if (S.dest) await planRoute();
  }));
}
renderTravelSeg();
renderPrefSeg();

async function planRoute() {
  const d = S.dest;
  const from = S.pos ? [S.pos.lng, S.pos.lat] : map.getCenter().toArray();
  toast('Wyznaczam trasę…', 8000);
  try {
    S.routes = await getRoutes(CONFIG, [from, [d.lng, d.lat]], { costing: travel().costing, alternatives: travel().alternatives, pref: S.pref, fixExclude: await fixEx(from, [d.lng, d.lat]) });
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
  S.departMin = 0; syncDepart();
  loadTraffic(S.routes);
  if (destMarker) destMarker.remove();
  const pin = document.createElement('div');
  pin.className = 'dest-pin';
  pin.innerHTML = icon.pin(40);
  destMarker = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([d.lng, d.lat]).addTo(map);
  hd.resetLive();
  const routesNow = S.routes;
  if (!travel().hazards) { S.hazardsReady = true; routesNow.forEach((r) => { r.hz = { cams: [], secs: [] }; }); renderRouteCards(); return; }
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

// Ruch w podglądzie: czasy z korkami dla każdej trasy i wybór najszybszej na wybraną godzinę.
async function loadTraffic(routes) {
  if (travel().costing !== 'auto') return;
  const depart = departAt(S.departMin || 0);
  const got = await Promise.all(routes.map((r) => fetchTraffic(routePoints(r.line), { depart, client: clientId() })));
  if (S.routes !== routes || S.mode !== 'preview') return;
  if (!got.some(Boolean)) { $('seg-depart').hidden = true; return; }
  $('seg-depart').hidden = false;
  routes.forEach((r, i) => { r.traffic = got[i]; });
  const best = routes.reduce((b, r, i) => ((r.traffic && r.traffic.time < (routes[b].traffic?.time ?? Infinity)) ? i : b), S.sel);
  const cur = routes[S.sel].traffic;
  if (best !== S.sel && cur && cur.time - routes[best].traffic.time >= 120) { S.sel = best; drawRoutes(); }
  renderRouteCards();
  drawJams(routes[S.sel]);
}
function clientId() {
  try { let c = localStorage.getItem('nav.client'); if (!c) { c = Math.random().toString(36).slice(2, 12); localStorage.setItem('nav.client', c); } return c; } catch { return 'app'; }
}
function syncDepart() {
  $('seg-depart').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.m === (S.departMin || 0)));
}
$('seg-depart').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.departMin = +b.dataset.m; syncDepart();
  loadTraffic(S.routes);
};
function drawJams(route, jams = null) {
  const src = map.getSource('jam'); if (!src) return;
  const list = jams || (route && route.traffic ? jamsOnLine(route.traffic, route.line) : []);
  src.setData({ type: 'FeatureCollection', features: route ? jamFeatures(list, route.line) : [] });
}

function fitRoutes() {
  const all = S.routes.flatMap((r) => r.coords);
  const b = all.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
  const h = window.innerHeight;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 150, bottom: Math.round(h * 0.5), left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 800, maxZoom: 15 });
}

function routeName(r, i) {
  const via = r.via || r.summary;
  // z ruchem najszybsza to ta z najkrótszym czasem, a nie pierwsza z silnika tras
  const best = S.routes.reduce((b, x, k) => ((x.traffic ? x.traffic.time : x.duration) < (S.routes[b].traffic ? S.routes[b].traffic.time : S.routes[b].duration) ? k : b), 0);
  if (i === best) return `Najszybsza${via ? ` · przez ${via}` : ''}`;
  return via ? `Alternatywa · przez ${via}` : `Alternatywa ${i}`;
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
    const tr = r.traffic;
    if (tr) {
      const d = Math.round(Math.max(0, tr.delay || 0) / 60); // opóźnienie względem zwykłego ruchu, nie względem pustych dróg
      tags = (d >= 2 ? `<span class="tag jam">korki +${d} min</span>` : '<span class="tag free">bez korków</span>') + tags;
      if (S.departMin) { const a = new Date(Date.now() + (S.departMin * 60 + tr.time) * 1000); tags = `<span class="tag ok">przyjazd ${String(a.getHours()).padStart(2, '0')}:${String(a.getMinutes()).padStart(2, '0')}</span>` + tags; }
    }
    return `<button class="route-card ${i === S.sel ? 'sel' : ''}" data-i="${i}">
      <div class="rc-top"><span class="rc-time">${fmtDuration(tr ? tr.time : r.duration)}</span><span class="rc-dist">${fmtDist(r.distance)}</span></div>
      <div class="rc-name">${esc(routeName(r, i))}</div><div class="rc-tags">${tags}</div></button>`;
  }).join('');
  renderWhy();
  box.querySelectorAll('.route-card').forEach((b) => (b.onclick = () => {
    S.sel = +b.dataset.i;
    renderRouteCards();
    drawRoutes();
    drawJams(S.routes[S.sel]);
    if (S.hazardsReady) renderHazardMarkers(S.routes[S.sel]);
  }));
}

function renderWhy() {
  const r = S.routes[S.sel];
  const meta = S.routes.meta || {};
  const cams = S.hazardsReady && r && r.hz ? (r.hz.cams || []).filter((h) => h.type === 'camera' || h.type === 'redlight').length + (r.hz.secs || []).length : null;
  const lines = explainRoute(S.routes, S.sel, { prefLabel: travel().id === 'auto' ? (ROUTE_PREFS[S.pref] || {}).label : null, avoid: S.sel === 0 ? meta.avoid : null, fixes: meta.fixes || 0, cams });
  $('why-list').innerHTML = lines.map((t) => `<li>${esc(t)}</li>`).join('');
  $('why').hidden = !lines.length;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const t = n % 10, h = n % 100;
  return t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? few : many;
}

// ---------- Dane o zagrożeniach ----------
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
  show('speedbox', m === 'nav' && travel().id !== 'pedestrian');
  show('btn-report', m === 'nav');
  show('btn-sound', m === 'nav');
  show('btn-quick', m === 'nav');
  show('btn-fuel', m === 'nav' && travel().id === 'auto');
  if (m !== 'nav') show('fuel', false);
  if (m !== 'nav') show('quick', false);
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
  if (!sim) saveSession();
  voice.prefetch([travel().say.go, 'Przeliczam trasę', travel().say.arrive, 'Koniec odcinka', 'Skręć w lewo', 'Skręć w prawo',
    ...new Set((route.steps || []).map((st) => st.short || st.text).filter(Boolean))]);
  if (travel().limits && !route.limitsTried) {
    route.limitsTried = true;
    loadRouteLimits(CONFIG.limitsUrl, route).then((r) => { hd.status = { ...hd.status, limits: r.ok ? `ok (${Math.round(r.covered * 100)}% trasy ma znany limit)` : 'niedostępne' }; if (r.ok && S.nav && S.nav.route === route) paintRoute(S.nav.paintedAlong || 0); }).catch(() => {});
  }
  if (!route.hz) applyHazards([route]);

  const items = itemsFor(route);

  S.nav = {
    route,
    guidance: new Guidance(route, { profile: travel().guide }),
    watch: new HazardWatch(items),
    loadedTo: route.distance > 80000 ? WINDOW_M : route.distance,
    loading: false,
    trackers: route.hz.secs.map((s) => ({ s, t: new SectionTracker(s, s.limit) })),
    lastReroute: 0,
    lastAdvice: 0,
    sectionHold: null,
    arrivedTimer: null,
    trip: new TripRecorder(),
  };
  setupRoad(S.nav);
  S.follow = true;
  S.heading = route.line.coords.length > 1 ? bearing(route.line.coords[0], route.line.coords[1]) : 0;
  setMode('nav');
  renderHazardMarkers(route);
  $('btn-sound').innerHTML = voice.enabled ? icon.sound(24) : icon.mute(24);
  if (meMarker) { meMarker.remove(); meMarker = null; }
  document.activeElement && document.activeElement.blur();
  $('results').hidden = true;
  const start = S.pos ? [S.pos.lng, S.pos.lat] : route.coords[0];
  setFov(NAV_FOV);
  document.body.classList.add('driving');
  cam.s = null; cam.v = 0;
  cam.place({ center: start, bearing: S.heading, zoom: travel().zoom(0), pitch: camPitch() });
  map.easeTo({ center: start, zoom: travel().zoom(0), pitch: camPitch(), bearing: S.heading, duration: 900, padding: camPadding() });
  placePuck();
  // Pierwsza wypowiedź musi wyjść od razu z dotknięcia „Start”: tylko wtedy iPhone odblokuje mowę na całą jazdę.
  voice.say(travel().say.go, { prio: 3, ttl: 4000 });
}

// Szersze pole widzenia podczas jazdy: perspektywa drogi zamiast widoku z góry.
const NAV_FOV = 50; const MAP_FOV = 36.87;
const setFov = (d) => { try { if (map.setVerticalFieldOfView) map.setVerticalFieldOfView(d); } catch { /* starsza mapa: zwykła perspektywa */ } };
const cam = new ChaseCam();
const SKY_RATIO = 2048 / 683; // proporcje obrazów nieba
let camLast = 0; let skyX = null;
function camLoop(now) {
  requestAnimationFrame(camLoop);
  if (S.mode !== 'nav' || !S.nav || !S.follow || document.hidden) { camLast = now; return; }
  if (now - camLast < 30) return;
  const dt = Math.min(0.25, (now - camLast) / 1000) * (S.sim ? (S.simSpeedup || 1) : 1); camLast = now;
  if (map.isEasing()) { const c = map.getCenter(); cam.place({ center: [c.lng, c.lat], bearing: map.getBearing(), zoom: map.getZoom(), pitch: map.getPitch() }); return; }
  const p = cam.tick(dt);
  if (!p) return;
  map.jumpTo({ center: p.center, bearing: p.bearing, zoom: p.zoom, pitch: p.pitch, padding: camPadding() });
  const pv = document.getElementById('puck-svg');
  if (pv) pv.style.transform = `rotate(${p.carOffset.toFixed(1)}deg)`;
  S.nav.cam = { c: [...p.center], hd: p.bearing, zoom: p.zoom };
  const x = (-p.bearing / 360) * ($('sky').clientHeight * SKY_RATIO); // panorama przesuwa się razem z kierunkiem jazdy
  if (skyX == null || Math.abs(x - skyX) > 0.3) { skyX = x; $('sky').style.backgroundPositionX = `${x.toFixed(1)}px`; }
}
requestAnimationFrame(camLoop);

function camPitch() {
  if (!settings.tilt) return 0;
  const t = travel();
  return t.camPitch && S.nav ? t.camPitch(S.nav.kmh || 0) : t.pitch;
}

function camPadding() {
  const h = window.innerHeight;
  return { top: Math.round(h * 0.46), bottom: 40, left: 0, right: 0 };
}

function placePuck() {
  const h = window.innerHeight;
  const p = camPadding();
  const y = p.top + (h - p.top - p.bottom) / 2;
  const puck = $('puck');
  puck.style.top = `${y}px`;
  puck.innerHTML = `<svg viewBox="0 0 64 64" id="puck-svg" aria-hidden="true"><path d="M32 8 L47 50 L32 42 L17 50Z" fill="#F5FAFF" stroke="#00D9FF" stroke-width="3" stroke-linejoin="round"/></svg>`;
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
  if (!S.sim && Date.now() - (S.sessT || 0) > 5000) saveSession();
  const N = S.nav;
  if (!N) return;
  const g = N.guidance.update(fix);
  const speedMs = fix.speed || 0;
  const kmh = Math.round(speedMs * 3.6);

  // Kierunek kamery: z GPS przy ruchu, inaczej wg trasy.
  let target = S.heading;
  const cmp = travel().compass ? compass.get() : null;
  if (fix.heading != null && isFinite(fix.heading) && speedMs > (cmp != null ? 1.1 : 1.5)) target = fix.heading;
  else if (cmp != null) target = cmp;
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
  const ring = speedRing(kmh, lim);
  const sp = $('speed');
  sp.style.setProperty('--p', ring.pct.toFixed(1));
  sp.dataset.state = ring.state;
  sp.dataset.notch = ring.notch ? '1' : '0';
  $('puck').dataset.state = ring.state;

  // Karta manewru
  const nx = g.next;
  $('m-arrow').innerHTML = arrow(nx.icon, 50);
  $('m-dist').textContent = nx.type === 'arrive' && g.distToNext < 30 ? 'Cel' : fmtDist(g.distToNext);
  $('m-text').textContent = nx.text.replace(/,? ?kierunek: [^.]+\.?$/, '');
  { // drogowskaz i pasy ruchu przed manewrem
    const sign = $('m-sign'); const near = g.distToNext < 1500;
    sign.hidden = !(nx.toward && near);
    if (!sign.hidden && sign.textContent !== nx.toward) sign.textContent = nx.toward;
    const lanes = $('m-lanes'); const showL = !!nx.lanes && g.distToNext < 600 && g.distToNext > 8;
    lanes.hidden = !showL;
    document.body.classList.toggle('has-lanes', showL);
    if (showL && N.lanesIdx !== g.nextIdx) {
      N.lanesIdx = g.nextIdx; lanes.innerHTML = lanesHtml(nx.lanes);
      const say = laneAdvice(nx.lanes);
      if (say && g.distToNext > 120) voice.say(say, { prio: 2 });
    }
  }
  { // postęp do manewru i wyróżnienie tuż przed skrętem
    const prevAt = g.nextIdx > 0 ? N.route.steps[g.nextIdx - 1].at : 0;
    const span = Math.max(150, Math.min(900, nx.at - prevAt));
    $('m-prog').style.width = `${Math.round(Math.max(0, Math.min(1, 1 - g.distToNext / span)) * 100)}%`;
    $('maneuver').classList.toggle('hot', wantsArrow(nx) && g.distToNext < 120);
  }
  $('n-prog').style.width = `${Math.round(Math.max(0, Math.min(1, g.along / (N.route.distance || 1))) * 1000) / 10}%`;

  // Czas i dystans
  if (N.trafficK) g.remTime *= N.trafficK; // czas z bieżącym ruchem
  trafficTick(N, g, fix);
  const arr = new Date((fix.t || Date.now()) + g.remTime * 1000);
  $('n-time').textContent = fmtDuration(g.remTime);
  $('n-dist').textContent = fmtDist(g.remaining);
  $('n-eta').textContent = `${String(arr.getHours()).padStart(2, '0')}:${String(arr.getMinutes()).padStart(2, '0')}`;

  // Ostrzeżenia
  N.along = g.along;
  if (N.trip) N.trip.add(fix);
  const w = N.watch.update(g.along, speedMs, lim);
  showBanner(w, kmh, lim);
  if (settings.roadAlerts !== false && N.road) {
    const rw = N.road.update(g.along, speedMs, lim);
    if (settings.hazardsVoice) for (const t of rw.say) voice.say(t, { prio: 2 });
    if ($('banner').hidden && $('section').hidden && rw.ahead) showRoadBanner(rw.ahead, kmh);
  }
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
  updateRoadArrow(N, g);
  if (N.paintedAlong == null || g.along - N.paintedAlong > 120) { N.paintedAlong = g.along; paintRoute(g.along); }
  if (N.aheadAlong == null || g.along - N.aheadAlong > 35 || g.along < N.aheadAlong) { N.aheadAlong = g.along; drawAhead(N, g.along); }
  if (settings.ortho !== false && CONFIG.ortoUrl && (N.ortoAlong == null || Math.abs(g.along - N.ortoAlong) > 300)) { N.ortoAlong = g.along; prefetchOrto(N.route.line, g.along); }

  // Kamera i znacznik pojazdu: tu tylko nowy odczyt, płynny ruch liczy camLoop w każdej klatce
  const onRoute = g.offDist < 25 && !!g.point;
  const c = onRoute ? g.point : [fix.lng, fix.lat];
  N.kmh = kmh;
  const baseZoom = travel().zoom(kmh);
  if (!cam.center) { const mc = map.getCenter(); cam.place({ center: [mc.lng, mc.lat], bearing: map.getBearing(), zoom: map.getZoom(), pitch: map.getPitch() }); }
  cam.fix({ along: g.along, line: N.route.line, onRoute, lng: fix.lng, lat: fix.lat, speed: speedMs, heading: fix.heading, zoom: settings.tilt ? baseZoom : baseZoom - 1, pitch: camPitch() });
  if (!S.follow && navMarker) { navMarker.setLngLat(c); navMarker.setRotation(hd); }

  // Zjechanie z trasy
  const now = Date.now();
  if (g.offRoute && now - N.lastReroute > 6000) {
    N.lastReroute = now;
    reroute(fix);
  }
  if (g.arrived && !N.arrivedTimer) {
    voice.say(travel().say.arrive, { prio: 3 });
    toast(travel().say.arrive, 5000);
    N.arrivedTimer = setTimeout(endNav, 6000);
  }
}

// Strzałka skrętu na jezdni: pokazujemy ją na ostatnich ~220 m przed skrętem (nie przy jeździe prosto).
// Szewrony tylko na odcinku przed autem, nie na przejechanym.
function drawAhead(N, along) {
  const src = map.getSource('ahead');
  if (!src) return;
  const coords = sliceLine(N.route.line, along + 45, Math.min(N.route.line.total, along + 1500));
  src.setData(coords && coords.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } : emptyFC());
}

function updateRoadArrow(N, g) {
  const src = map.getSource('arrow');
  if (!src) return;
  const nx = g.next;
  const want = wantsArrow(nx) && g.distToNext < 220 && g.distToNext > 6;
  const key = want ? g.nextIdx : null;
  if (key === N.arrowIdx) return;
  N.arrowIdx = key;
  if (!want) { src.setData(emptyFC()); return; }
  const arrowGeo = maneuverArrow(N.route.line, nx.at);
  if (!arrowGeo) { src.setData(emptyFC()); return; }
  src.setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: arrowGeo.shaft } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [arrowGeo.head] } },
  ] });
}

function trackBearing(route, along) {
  const a = Math.min(route.line.total, along);
  let i = 0;
  while (i < route.line.cum.length - 2 && route.line.cum[i + 1] < a) i++;
  return bearing(route.line.coords[i], route.line.coords[i + 1]);
}

function showRoadBanner(it, kmh) {
  const d = describeRoad(it, it.dist);
  const b = $('banner');
  b.hidden = false;
  b.className = `glass ${it.tooFast ? 'alert' : 'info'}`;
  $('b-ico').innerHTML = (icon[it.kind === 'curve' ? 'curve' : it.kind] || icon.warn)(26);
  $('b-title').textContent = `${d.title} za ${fmtDist(it.dist)}`;
  $('b-sub').textContent = it.kind === 'curve' ? `${d.sub} · jedziesz ${kmh}` : d.sub;
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

// Punkty drogowe (przejazdy kolejowe, progi, szkoły) z pliku budowanego przez bota; zakręty liczymy z geometrii trasy.
let roadPoints = null; let roadPointsP = null;
function loadRoadPoints() {
  if (!roadPointsP) {
    roadPointsP = fetch(CONFIG.roadPointsUrl).then((r) => (r.ok ? r.json() : null)).then((j) => { roadPoints = j ? unpackRoadPoints(j) : []; hd.status = { ...hd.status, roadPoints: roadPoints.length }; return roadPoints; }).catch(() => { roadPoints = []; return roadPoints; });
  }
  return roadPointsP;
}
function setupRoad(N) {
  N.road = new RoadWatch(buildRoadItems(N.route, roadPoints || []), N.road ? N.road.done : null);
  if (!roadPoints) loadRoadPoints().then(() => { if (S.nav === N) N.road = new RoadWatch(buildRoadItems(N.route, roadPoints), N.road.done); });
}

function applyNewRoute(N, route) {
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
  setupRoad(N);
  N.trafficK = null; N.trafficT = 0; N.jams = []; drawJams(null);
  drawRoutes();
  renderHazardMarkers(route);
}

// Ruch w jeździe: co 3 minuty czas do celu z korkami, a gdy opóźnienie jest spore, sprawdzenie szybszej trasy.
const TRAFFIC_EVERY = 180000;
async function trafficTick(N, g, fix) {
  if (travel().costing !== 'auto' || N.trafficBusy || N.rerouting || g.remaining < 800) return;
  const now = Date.now();
  if (N.trafficT && now - N.trafficT < TRAFFIC_EVERY / (S.sim ? S.simSpeedup || 1 : 1)) return;
  N.trafficT = now; N.trafficBusy = true;
  const route = N.route; const along = g.along; const base = g.remTime / (N.trafficK || 1);
  try {
    const t = await fetchTraffic(routePoints(route.line, along), { client: clientId() });
    if (!t || S.nav !== N || N.route !== route) return;
    N.trafficK = base > 0 ? t.time / base : null;
    N.jams = jamsOnLine(t, route.line, along);
    drawJams(route, N.jams);
    const j = nextJam(N.jams, along);
    if (j && N.jamSaid !== Math.round(j.from / 200)) {
      N.jamSaid = Math.round(j.from / 200);
      const m = Math.max(1, Math.round((j.delay || 0) / 60));
      toast(`Korek za ${fmtDist(j.from - along)}: +${m} min`, 5000);
      if (settings.hazardsVoice) voice.say(`Korek za ${fmtDist(j.from - along)}, około ${m} minut opóźnienia`, { prio: 2 });
    }
    if ((t.delay || 0) >= 240 && !N.fasterShown) await checkFaster(N, t, fix);
  } finally { N.trafficBusy = false; }
}

async function checkFaster(N, cur, fix) {
  const dest = [S.dest.lng, S.dest.lat];
  let rs;
  try { rs = await getRoutes(CONFIG, [[fix.lng, fix.lat], dest], { costing: 'auto', alternatives: true, pref: S.pref, heading: (fix.speed || 0) > 1.5 ? fix.heading : null, avoidMinor: false }); } catch { return; }
  const ts = await Promise.all(rs.map((r) => fetchTraffic(routePoints(r.line), { client: clientId() })));
  let best = -1; let save = 0;
  ts.forEach((t, i) => { const w = t ? worthSwitch(cur.time, t.time) : 0; if (w > save) { save = w; best = i; } });
  if (best < 0 || S.nav !== N) return;
  N.fasterShown = true;
  const min = Math.round(save / 60);
  $('f-title').textContent = `Szybciej o ${min} min`;
  $('f-sub').textContent = `Dojazd za ${fmtDuration(ts[best].time)}`;
  show('faster', true);
  if (settings.hazardsVoice) voice.say(`Jest szybsza trasa, zysk ${min} minut`, { prio: 2 });
  const close = () => { show('faster', false); clearTimeout(timer); setTimeout(() => { if (S.nav === N) N.fasterShown = false; }, 600000); };
  const timer = setTimeout(close, 25000);
  $('f-no').onclick = close;
  $('f-yes').onclick = () => { close(); if (S.nav === N) { N.trafficK = null; N.trafficT = 0; applyNewRoute(N, rs[best]); } };
}

// Zjechanie z trasy: najpierw jak najszybciej zwykła trasa od miejsca, w którym jesteśmy (jeden strzał do serwera,
// z kierunkiem jazdy, więc nie każe zawracać), a dopiero potem w tle wersja bez dróg gruntowych/serwisowych.
async function reroute(fix) {
  const N = S.nav;
  if (N.rerouting) return;
  N.rerouting = true;
  toast(travel().say.off, 4000);
  voice.say('Przeliczam trasę', { prio: 3 });
  const dest = [S.dest.lng, S.dest.lat];
  const head = (f) => ((f.speed || 0) > 1.5 ? f.heading : null);
  const fx = await Promise.race([fixEx([fix.lng, fix.lat], dest), new Promise((r) => setTimeout(() => r([]), 1500))]); // nie opóźniamy przeliczania
  try {
    const rs = await getRoutes(CONFIG, [[fix.lng, fix.lat], dest], { costing: travel().costing, alternatives: false, pref: S.pref, heading: head(fix), avoidMinor: false, fixExclude: fx });
    if (S.mode !== 'nav' || S.nav !== N) return;
    applyNewRoute(N, rs[0]);
  } catch {
    toast('Nie udało się przeliczyć trasy', 3500);
    return;
  } finally {
    N.rerouting = false;
  }
  if (travel().costing !== 'auto') return;
  const quick = N.route;
  try { // dopracowanie w tle: podmieniamy tylko gdy jest lepsze i nadal jesteśmy na jej przebiegu
    const f2 = S.lastFix || fix;
    const rs2 = await getRoutes(CONFIG, [[f2.lng, f2.lat], dest], { costing: 'auto', alternatives: false, pref: S.pref, heading: head(f2), fixExclude: fx });
    if (S.mode !== 'nav' || S.nav !== N || N.route !== quick) return;
    if (!String(rs2.meta && rs2.meta.avoid).startsWith('poprawiona')) return;
    const now = S.lastFix || f2;
    if (project(rs2[0].line, [now.lng, now.lat]).dist > 25) return;
    applyNewRoute(N, rs2[0]);
  } catch { /* zostaje szybka trasa */ }
}

function endNav() {
  const memento = S.nav && S.nav.trip && S.nav.trip.summary().meters >= TRIP.minDistM ? { ...S.nav.trip.toJSON(), title: S.dest ? S.dest.main : 'Podróż', date: Date.now() } : null;
  clearSession();
  compass.stop();
  voice.hold(false);
  clearTimeout(resumeTimer);
  if (navMarker) { navMarker.remove(); navMarker = null; }
  if (S.nav && S.nav.arrivedTimer) clearTimeout(S.nav.arrivedTimer);
  if (S.sim) { S.sim.stop(); S.sim = null; S.simSpeedup = 1; }
  S.nav = null;
  unlockScreen();
  clearMarkers();
  S.routes = []; S.dest = null;
  drawJams(null); show('faster', false);
  drawRoutes();
  if (destMarker) { destMarker.remove(); destMarker = null; }
  input.value = '';
  setMode('idle');
  setFov(MAP_FOV);
  document.body.classList.remove('driving');
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, zoom: 14, duration: 700 });
  if (S.pos) { meMarker = new maplibregl.Marker({ element: meEl() }).setLngLat([S.pos.lng, S.pos.lat]).addTo(map); }
  if (memento) { saveLastTrip(memento); setTimeout(() => showTrip(memento), 900); }
}

$('btn-start').onclick = () => { if (travel().compass) compass.start(); startNav(); };
$('btn-sim').onclick = () => {
  const route = S.routes[S.sel];
  if (!route) return;
  startNav({ sim: true });
  S.simSpeedup = 1; // tempo prawdziwej jazdy: to, co widać w symulacji, ma być tym, co widać w aucie
  S.sim = new Simulator(route, { speedKmh: travel().simKmh, speedup: S.simSpeedup, onFix: (f) => onFix(f) });
  S.sim.start();
  toast('Symulacja jazdy: dotknij prędkości, by ją zmienić', 4000);
};
$('btn-end').onclick = endNav;

// Dotknięcie prędkości w symulacji zmienia ją (30/50/90/130).
$('speed').onclick = () => {
  if (!S.sim) return;
  const seq = [30, 50, 90, 130];
  const cur = S.sim.fixed == null ? 0 : Math.round(S.sim.fixed * 3.6);
  const i = seq.findIndex((v) => v > cur + 1);
  if (i === -1) { S.sim.fixed = null; toast('Symulacja: jazda zgodnie z limitem', 1500); return; }
  S.sim.setSpeed(seq[i]);
  toast(`Symulacja: ${seq[i]} km/h`, 1500);
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
    el.innerHTML = '<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true"><path d="M32 8 L47 50 L32 42 L17 50Z" fill="#F5FAFF" stroke="#00D9FF" stroke-width="3" stroke-linejoin="round"/></svg>';
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
  if (cam) map.easeTo({ center: cam.c, bearing: cam.hd, zoom: cam.zoom, pitch: camPitch(), duration: 600, padding: camPadding() });
}

map.on('movestart', (e) => { if (S.mode === 'nav' && e.originalEvent) pauseFollow(); });
$('btn-resume').onclick = resumeFollow;
$('btn-locate').addEventListener('click', () => { if (S.mode === 'nav') resumeFollow(); });

// ---------- Zgłoszenia ----------
$('btn-report').onclick = () => show('report', true);
$('btn-report-x').onclick = () => show('report', false);
$('report-grid').querySelectorAll('button[data-t]').forEach((b) => (b.onclick = () => {
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


// ---------- Pamiątka z podróży ----------
const TRIP_KEY = 'nav.lastTrip';
function saveLastTrip(m) { try { localStorage.setItem(TRIP_KEY, JSON.stringify(m)); } catch { /* brak miejsca */ } }
function loadLastTrip() { try { return JSON.parse(localStorage.getItem(TRIP_KEY) || 'null'); } catch { return null; } }
let tripView = null; // { pts, stats, stops, title, date, frames }
function tripGeo() {
  return tripView ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: tripView.pts.map((p) => [p.lng, p.lat]) } }] } : emptyFC();
}
function setTripGradient(stops) {
  const expr = ['interpolate', ['linear'], ['line-progress'], ...stops.flat()];
  for (const id of ['trip-glow', 'trip-line']) if (map.getLayer(id)) map.setPaintProperty(id, 'line-gradient', expr);
}
function drawTrip() {
  const src = map.getSource('trip');
  if (!src) return;
  src.setData(tripGeo());
  if (tripView) setTripGradient(tripView.stops);
}
function showTrip(m) {
  if (!m || !m.pts || m.pts.length < 2) { toast('Brak zapisanej podróży'); return; }
  const rec = TripRecorder.fromJSON(m);
  const stats = rec.summary();
  tripView = { pts: rec.pts, stats, stops: speedStops(rec.pts), title: m.title || 'Podróż', date: m.date || Date.now(), maxV: rec.maxV, frames: null };
  show('menu', false); show('quick', false);
  $('trip-title').textContent = tripView.title;
  const km = (stats.meters / 1000).toFixed(stats.meters < 10000 ? 1 : 0).replace('.', ',');
  $('trip-stats').innerHTML = [
    [km, 'km przejechane'], [fmtTripTime(stats.totalMs), 'czas podróży'],
    [`${Math.round(stats.avgKmh)} km/h`, 'średnia w ruchu'], [`${stats.maxKmh} km/h`, 'maksymalna'],
    [stats.stops ? String(stats.stops) : '0', 'postoje (powyżej minuty)'], [fmtTripTime(stats.movingMs), 'czas w ruchu'],
  ].map(([b, s]) => `<div class="t"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
  $('trip-note').textContent = 'Kolor śladu pokazuje prędkość: chłodny = wolno, ciepły = szybko.';
  $('trip-video').hidden = !(typeof MediaRecorder !== 'undefined' && map.getCanvas().captureStream);
  show('trip', true);
  drawTrip();
  const b = rec.pts.reduce((a, p) => [Math.min(a[0], p.lng), Math.min(a[1], p.lat), Math.max(a[2], p.lng), Math.max(a[3], p.lat)], [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 90, bottom: Math.round(window.innerHeight * 0.5), left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 1200, maxZoom: 15 });
}
function closeTrip() {
  stopReplay();
  show('trip', false);
  tripView = null;
  drawTrip();
}
const lerpAngle = (a, b, t) => (a + (((b - a + 540) % 360) - 180) * t + 360) % 360;
let replay = null;
function stopReplay(finishCb) {
  if (!replay) return;
  cancelAnimationFrame(replay.raf);
  const r = replay; replay = null;
  show('trip-stop', false);
  if (tripView) setTripGradient(tripView.stops);
  map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  if (!tripView) return;
  show('trip', true);
  if (finishCb) finishCb(r);
}
/** Filmowy przelot po śladzie; onDone(true) po dojściu do końca, onDone(false) po przerwaniu. */
function startReplay(onFrame, onDone) {
  if (!tripView || replay) return;
  if (!tripView.frames) tripView.frames = replayFrames(tripView.pts, 320);
  const frames = tripView.frames;
  if (frames.length < 2) { toast('Ślad jest za krótki na przelot'); return; }
  show('trip', false); show('trip-stop', true);
  const km = tripView.stats.meters / 1000;
  const dur = Math.max(9000, Math.min(24000, 6000 + km * 250)); // 9-24 s
  const t0 = performance.now();
  map.jumpTo({ center: frames[0].center, bearing: frames[0].bearing, pitch: 64, zoom: 15.6 });
  replay = { raf: 0, done: onDone };
  const tick = (now) => {
    if (!replay) return;
    const k = Math.min(1, (now - t0) / dur);
    const f = k * (frames.length - 1); const i = Math.min(frames.length - 2, Math.floor(f)); const u = f - i;
    const a = frames[i]; const b = frames[i + 1];
    const zoomWave = 15.6 + Math.sin(k * Math.PI) * -0.5; // lekkie oddalenie w środku
    map.jumpTo({ center: [a.center[0] + (b.center[0] - a.center[0]) * u, a.center[1] + (b.center[1] - a.center[1]) * u], bearing: lerpAngle(a.bearing, b.bearing, u), pitch: 64, zoom: zoomWave });
    setTripGradient(revealStops(tripView.stops, a.progress + (b.progress - a.progress) * u));
    if (onFrame) onFrame(k);
    if (k >= 1) { const d = replay.done; stopReplay(); if (d) d(true); return; }
    replay.raf = requestAnimationFrame(tick);
  };
  replay.raf = requestAnimationFrame(tick);
}
$('btn-trip-x').innerHTML = icon.close(22);
$('btn-trip-x').onclick = closeTrip;
$('trip-stop').onclick = () => { const d = replay && replay.done; stopReplay(); if (d) d(false); };
$('trip-replay').onclick = () => startReplay();
function shareBlob(blob, name, text) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: 'Moja podróż', text }).catch(() => {});
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Zapisano plik', 2500);
  return Promise.resolve();
}
$('trip-share').onclick = async () => {
  if (!tripView) return;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  drawPoster(c.getContext('2d'), c.width, c.height, { pts: tripView.pts, title: tripView.title, stats: tripView.stats, dateText: new Date(tripView.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) });
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (blob) await shareBlob(blob, 'podroz.png', `${tripView.title}: ${(tripView.stats.meters / 1000).toFixed(0)} km`);
};
$('trip-video').onclick = () => {
  if (!tripView) return;
  const canvas = map.getCanvas();
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) { toast('Ta przeglądarka nie nagrywa filmów'); return; }
  let rec;
  try { rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 }); } catch { toast('Nie udało się rozpocząć nagrywania'); return; }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (blob.size < 2000) { toast('Film jest pusty, spróbuj jeszcze raz'); return; }
    shareBlob(blob, mime.startsWith('video/mp4') ? 'podroz.mp4' : 'podroz.webm', tripView ? tripView.title : '');
  };
  rec.start(250);
  toast('Nagrywam przelot…', 2500);
  startReplay(null, () => setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 300));
};
$('btn-lasttrip').onclick = () => { const m = loadLastTrip(); if (m) showTrip(m); else toast('Nie ma jeszcze zapisanej podróży'); };
window.__trip = { show: showTrip, view: () => tripView };

// ---------- Stacje paliw z kosztem objazdu ----------
let fuelStations = null;
function loadFuel() {
  if (!fuelStations) fuelStations = fetch(CONFIG.fuelUrl).then((r) => (r.ok ? r.json() : null)).then((j) => unpackFuel(j)).catch(() => []);
  return fuelStations;
}
$('btn-fuel').innerHTML = icon.fuel(24);
$('btn-fuel-x').innerHTML = icon.close(22);
$('btn-fuel-x').onclick = () => show('fuel', false);
$('btn-fuel').onclick = async () => {
  if (!$('fuel').hidden) { show('fuel', false); return; }
  show('quick', false); show('fuel', true);
  const N = S.nav; const box = $('fuel-list');
  if (!N || !S.lastFix) { box.innerHTML = '<p class="fine">Czekam na pozycję GPS…</p>'; return; }
  box.innerHTML = '<p class="fine">Szukam stacji i liczę objazdy…</p>';
  try {
    const all = await loadFuel();
    if (!all.length) { box.innerHTML = '<p class="fine">Dane o stacjach nie są jeszcze pobrane. Aktualizują się automatycznie raz dziennie.</p>'; return; }
    const pos = [S.lastFix.lng, S.lastFix.lat];
    const cands = candidatesAhead(all, N.route.line, N.along || 0);
    if (!cands.length) { box.innerHTML = '<p class="fine">Brak stacji w pobliżu trasy na najbliższych 120 km.</p>'; return; }
    const res = (await fuelDetours(CONFIG.routingOwnUrl, pos, [S.dest.lng, S.dest.lat], cands, { pref: S.pref })).filter((x) => x.extraMin <= 12);
    if (S.nav !== N) return;
    if (!res.length) { box.innerHTML = '<p class="fine">Nie udało się policzyć dojazdu do stacji.</p>'; return; }
    const best = bestStation(res);
    box.innerHTML = res.map((x, i) => `<div class="st"><div><b>${esc(x.brand || 'Stacja paliw')}${x.lpg ? ' · LPG' : ''}</b><small>za ${fmtDist(x.along - (N.along || 0))} · ${fmtExtra(x)}</small>${x === best ? '<br><span class="best">NAJMNIEJSZY OBJAZD</span>' : ''}</div><button class="btn-ghost" data-i="${i}">Jedź tam</button></div>`).join('');
    box.querySelectorAll('button[data-i]').forEach((b) => (b.onclick = () => goViaStation(res[+b.dataset.i])));
  } catch { box.innerHTML = '<p class="fine">Nie udało się policzyć objazdów (brak połączenia z serwerem tras).</p>'; }
};
async function goViaStation(st) {
  const N = S.nav; const fix = S.lastFix;
  if (!N || !fix) return;
  show('fuel', false);
  toast('Wyznaczam trasę przez stację…', 5000);
  try {
    const rs = await getRoutes(CONFIG, [[fix.lng, fix.lat], [st.lng, st.lat], [S.dest.lng, S.dest.lat]], { costing: 'auto', alternatives: false, pref: S.pref, avoidMinor: false, heading: (fix.speed || 0) > 1.5 ? fix.heading : null });
    if (S.nav !== N) return;
    applyNewRoute(N, rs[0]);
    toast(`Jedziemy przez: ${st.brand || 'stację paliw'}`, 3000);
    voice.say('Trasa przez stację paliw', { prio: 2 });
  } catch { toast('Nie udało się wyznaczyć trasy przez stację', 3500); }
}

// ---------- Poprawki tras od kierowców ----------
const fixMode = () => travel().costing || 'auto';
async function fixEx(from, to) {
  try { return await fixStore.exclusionsFor(from, to, fixMode()); } catch { return []; }
}
function fixesGeoJson(list) {
  return { type: 'FeatureCollection', features: list.map((f) => ({ type: 'Feature', properties: { kind: f.kind, own: f.own ? 1 : 0 }, geometry: { type: 'Point', coordinates: [f.lng, f.lat] } })) };
}
async function refreshFixMarkers() {
  const src = map.getSource('fixes');
  if (!src) return;
  const b = map.getBounds();
  const list = await fixStore.markersIn([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], fixMode()).catch(() => []);
  src.setData(fixesGeoJson(list));
}
function applyFix(kind, lat, lng) {
  fixStore.add(kind, fixMode(), lat, lng);
  refreshFixMarkers();
  show('report', false); show('fixsheet', false);
  voice.say(kind === 'avoid' ? 'Zapamiętane, będę omijać to miejsce' : 'Dziękuję, zapamiętane', { prio: 1 });
  if (kind === 'avoid' && S.mode === 'preview' && S.dest) { toast('Zapamiętane. Liczę trasę z pominięciem tej drogi…', 3000); planRoute(); return; }
  toast(kind === 'avoid' ? 'Zapamiętane: tę drogę będę omijać przy następnych trasach' : 'Zapamiętane: tu można jechać', 3200);
}
document.querySelectorAll('#report-grid [data-fix]').forEach((b) => (b.onclick = () => {
  if (!S.pos) { toast('Brak pozycji GPS'); return; }
  applyFix(b.dataset.fix, S.pos.lat, S.pos.lng);
}));
// długie przytrzymanie palca na mapie (planowanie trasy): zaznacz drogę do ominięcia
let lp = null;
const lpClear = () => { clearTimeout(lp); lp = null; };
map.on('touchstart', (e) => { if (S.mode === 'nav' || e.points.length !== 1) return; lpClear(); lp = setTimeout(() => openFixSheet(e.lngLat), 650); });
['touchend', 'touchmove', 'touchcancel', 'dragstart', 'zoomstart'].forEach((ev) => map.on(ev, lpClear));
map.on('contextmenu', (e) => { if (S.mode !== 'nav') openFixSheet(e.lngLat); });
function openFixSheet(ll) {
  lpClear();
  S.fixPt = { lat: ll.lat, lng: ll.lng };
  show('fixsheet', true);
}
$('btn-fixsheet-x').innerHTML = icon.close(22);
$('fix-avoid').onclick = () => applyFix('avoid', S.fixPt.lat, S.fixPt.lng);
$('fix-ok').onclick = () => applyFix('ok', S.fixPt.lat, S.fixPt.lng);
$('btn-fixsheet-x').onclick = () => show('fixsheet', false);
// „Moje poprawki” w menu
function renderMyFixes() {
  const list = fixStore.own().slice().reverse();
  $('fix-list').innerHTML = list.length ? list.map((f) => `<div class="m-row"><span>${FIX_LABEL[f.kind]} <small style="opacity:.6">${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}</small></span><button class="btn-ghost" data-del="${f.lid}" style="padding:8px 12px;font-size:13px">Usuń</button></div>`).join('') : '<p class="fine">Brak. Przytrzymaj palec na mapie albo użyj przycisku „Zgłoś” w trakcie jazdy.</p>';
  $('fix-list').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { fixStore.remove(b.dataset.del); renderMyFixes(); refreshFixMarkers(); }));
}
$('btn-myfixes').onclick = () => { const h = $('fix-list').hidden; $('fix-list').hidden = !h; if (h) renderMyFixes(); };
map.on('moveend', () => { if (map.getZoom() >= 11) refreshFixMarkers(); });

// ---------- Głos i menu ----------
$('btn-sound').onclick = () => {
  voice.enabled = !voice.enabled;
  settings.voice = voice.enabled;
  saveSettings(settings);
  syncSoundIcon();
  syncMenu();
  toast(voice.enabled ? 'Głos włączony' : 'Głos wyłączony', 1500);
};

// Ustawienia: jedne przełączniki dla menu i panelu „Szybkie ustawienia” (działają od razu, także w trakcie jazdy).
const SWITCHES = {
  voice: (v) => { settings.voice = v; voice.enabled = v; syncSoundIcon(); },
  hazardsVoice: (v) => { settings.hazardsVoice = v; },
  tilt: (v) => { settings.tilt = v; },
  roadAlerts: (v) => { settings.roadAlerts = v; if (!v) $('banner').hidden = true; },
  ortho: (v) => { settings.ortho = v; for (const id of ['orto', 'orto-base']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'); },
  routeColor: (v) => { settings.routeColor = v; paintRoute(S.nav ? S.nav.paintedAlong || 0 : 0); },
};
function syncSoundIcon() { $('btn-sound').innerHTML = voice.enabled ? icon.sound(24) : icon.mute(24); }
function syncMenu() {
  document.querySelectorAll('[data-sw]').forEach((el) => {
    const on = settings[el.dataset.sw] !== false && !!settings[el.dataset.sw];
    el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on));
  });
  document.querySelectorAll('[data-seg=theme] button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.theme));
  document.querySelectorAll('[data-seg=engine] button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.ttsEngine));
}
document.querySelectorAll('[data-seg=engine]').forEach((el) => {
  el.innerHTML = VOICES.map((v) => `<button data-v="${v.id}"${v.enabled ? '' : ' disabled title="Niedostępna"'}>${v.label}</button>`).join('');
});
$('btn-menu').onclick = () => { syncMenu(); show('menu', true); };
$('btn-menu-x').onclick = () => show('menu', false);
$('btn-quick').innerHTML = icon.tune(24);
$('btn-quick').onclick = () => { syncMenu(); show('quick', $('quick').hidden); };
$('btn-quick-x').onclick = () => show('quick', false);
map.on('click', () => show('quick', false));
document.querySelectorAll('[data-sw]').forEach((el) => (el.onclick = () => {
  const key = el.dataset.sw;
  SWITCHES[key](!settings[key]);
  saveSettings(settings); syncMenu();
}));
document.querySelectorAll('[data-seg=theme] button').forEach((b) => (b.onclick = () => {
  settings.theme = b.dataset.v; saveSettings(settings); syncMenu(); applyTheme();
}));
document.querySelectorAll('[data-seg=engine] button').forEach((b) => (b.onclick = () => {
  if (b.disabled) { toast('Agata jest jeszcze niedostępna', 2000); return; }
  settings.ttsEngine = b.dataset.v; voice.setVoice(b.dataset.v); saveSettings(settings); syncMenu();
  voice.unlock();
  const who = b.dataset.v === 'ewa' ? 'Ewa' : 'Zosia';
  voice.say(S.mode === 'nav' ? `Teraz mówi ${who}.` : `Cześć, jestem ${who}. Za trzysta metrów skręć w prawo.`, { urgent: true });
}));

$('btn-voice-log').onclick = () => {
  const el = $('voice-log');
  el.hidden = !el.hidden;
  const hz = hd.status || {};
  el.textContent = `Wersja ${APP_VERSION}, silnik: ${voice.engine}, głos: ${voice.voice ? voice.voice.name : 'brak'}, mowa włączona: ${voice.enabled}\nDane: plik OSM ${hz.osmFile ?? '?'} pkt, GITD ${hz.gitd ?? '?'} pkt, Overpass ${hz.live || '…'}, limity prędkości ${hz.limits || '…'}, punkty drogowe ${hz.roadPoints ?? '?'}, zakręty na trasie ${S.nav ? S.nav.road.items.filter((i) => i.kind === 'curve').length : '–'}\n` + (S.routes.meta ? `Trasa: ${S.routes.meta.engine}/${S.routes.meta.costing} ${S.routes.meta.from[1].toFixed(5)}, ${S.routes.meta.from[0].toFixed(5)} → ${S.routes.meta.to[1].toFixed(5)}, ${S.routes.meta.to[0].toFixed(5)}\n` + (S.routes.meta.avoid ? `Drogi gruntowe/serwisowe w trasie: ${S.routes.meta.avoid}\n` : '') : '') + (S.pos ? `Pozycja: ${S.pos.lat.toFixed(5)}, ${S.pos.lng.toFixed(5)}\n` : '') + (voice.events.length ? voice.events.join('\n') : 'Brak zdarzeń. Uruchom symulację i wróć tutaj.');
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
    : i.cloud ? 'Głos z serwera. Pierwsze zdanie może potrwać kilka sekund. Gdy serwer nie odpowiada, mówi Zosia.'
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
window.__city = () => map.getLayer('city3d');
window.__nav = { S, CONFIG, map, voice, settings, onFix, chooseDest, startNav, endNav, parsePhoton, reports };

// Zapis aktualnego celu jako dom / praca / inne
document.querySelectorAll('#save-row button').forEach((b) => (b.onclick = () => {
  const d = S.dest;
  if (!d) return;
  let label = '';
  if (b.dataset.k === 'other') {
    label = (window.prompt('Nazwa miejsca (np. Rodzice)', d.main) || '').trim();
    if (!label) return;
  }
  places.save(b.dataset.k, d, label);
  b.classList.add('done');
  toast(`Zapisano: ${b.dataset.k === 'home' ? 'Dom' : b.dataset.k === 'work' ? 'Praca' : label}`, 2000);
}));

// ---------- Powrót do nawigacji po przełączeniu aplikacji ----------
const SESSION_KEY = 'nav.session';
const SESSION_MAX_AGE = 45 * 60 * 1000;
function saveSession() {
  S.sessT = Date.now();
  if (!S.dest) return;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ dest: S.dest, t: S.sessT })); } catch { /* ignoruj */ }
}
function clearSession() { S.sessT = 0; try { localStorage.removeItem(SESSION_KEY); } catch { /* ignoruj */ } }
function loadSession() {
  try {
    const v = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return v && v.dest && Date.now() - v.t < SESSION_MAX_AGE ? v : null;
  } catch { return null; }
}

async function restoreNav(d) {
  toast(`Wracam do nawigacji: ${d.main}`, 4000);
  await chooseDest(d);
  if (S.routes.length && S.pos) startNav();
}

/** Aplikacja wróciła na wierzch: ponów GPS, ekran i widok jazdy, żeby nie trzeba było nic klikać. */
function resumeNav() {
  if (S.mode !== 'nav' || S.sim) return;
  startGeo();
  lockScreen();
  S.follow = true;
  try { voice.queue = []; if (voice.ok) speechSynthesis.cancel(); voice._finish(); } catch { /* ignoruj */ }
  try { map.resize(); } catch { /* ignoruj */ }
  if (!S.lastFix || Date.now() - (S.lastFix.t || 0) > 4000) toast('Wznawiam GPS…', 2500);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeNav(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) resumeNav(); });

// Po ponownym uruchomieniu (system zamknął stronę w tle) odtwarzamy trwającą nawigację po pierwszym odczycie GPS.
S.restore = loadSession();
if (S.restore) setTimeout(() => { if (S.restore) { S.restore = null; clearSession(); } }, 20000);
// Pierwsza mowa na iPhonie musi wyjść z dotknięcia: „rozgrzewamy” syntezator przy pierwszym dotyku.
window.addEventListener('pointerdown', () => voice.prime(), { once: true, passive: true });
