// Adapter silnika Valhalla: odpowiedź /route (trip.legs[].maneuvers) -> ten sam format co OSRM (trasy, kroki),
// żeby reszta aplikacji (prowadzenie, głos, pinezki) działała bez zmian. Obsługuje auto, pieszo i rower.

/** Dekoder polyline (precyzja 6 w Valhalli) -> [[lng, lat], ...]. */
export function decodePolyline(str, precision = 6) {
  const f = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lng / f, lat / f]);
  }
  return out;
}

// Typy manewrów Valhalli -> [typ OSRM, modyfikator]
const MAP = {
  1: ['depart', 'straight'], 2: ['depart', 'right'], 3: ['depart', 'left'],
  4: ['arrive', null], 5: ['arrive', 'right'], 6: ['arrive', 'left'],
  7: ['new name', 'straight'], 8: ['continue', 'straight'],
  9: ['turn', 'slight right'], 10: ['turn', 'right'], 11: ['turn', 'sharp right'],
  12: ['turn', 'uturn'], 13: ['turn', 'uturn'],
  14: ['turn', 'sharp left'], 15: ['turn', 'left'], 16: ['turn', 'slight left'],
  17: ['on ramp', 'straight'], 18: ['on ramp', 'right'], 19: ['on ramp', 'left'],
  20: ['off ramp', 'right'], 21: ['off ramp', 'left'],
  22: ['continue', 'straight'], 23: ['fork', 'slight right'], 24: ['fork', 'slight left'],
  25: ['merge', 'straight'], 26: ['roundabout', null], 27: ['exit roundabout', null],
  37: ['merge', 'right'], 38: ['merge', 'left'],
  40: ['continue', 'straight'], 41: ['continue', 'straight'], 42: ['continue', 'straight'], 43: ['continue', 'straight'], 44: ['continue', 'straight'],
};

// Cechy dróg pieszych rozpoznajemy po opisie manewru (Valhalla nie ma na to osobnego pola w /route).
export function featureOf(m) {
  if (m.type === 40) return 'stairs';
  if (m.type === 41) return 'escalator';
  if (m.type === 42) return 'elevator';
  const t = `${m.instruction || ''} ${m.verbal_pre_transition_instruction || ''}`;
  if (/schod|stair|steps\b/i.test(t)) return 'stairs';
  if (/ruchom|escalator/i.test(t)) return 'escalator';
  if (/wind[aęy]|elevator/i.test(t)) return 'elevator';
  if (/przejści|crosswalk|crossing|cross the|przez ulic/i.test(t)) return 'crossing';
  return null;
}

function nameOf(m) {
  const names = (m.street_names && m.street_names.length ? m.street_names : m.begin_street_names) || [];
  // Valhalla miesza nazwy i numery dróg: nazwa to pierwszy wpis z literami, numer to np. „S17”, „DK 17”
  const ref = names.find((n) => /^(A|S|DK|DW)\s?\d+$/i.test(n) || /^\d{1,3}$/.test(n));
  const name = names.find((n) => n !== ref && /[a-ząćęłńóśźż]{3,}/i.test(n)) || '';
  return { name, ref: ref || '' };
}

const TURN_TYPES = new Set([7, 8, 9, 10, 11, 14, 15, 16, 22]);
const norm180 = (d) => ((d + 540) % 360) - 180;

/**
 * Pieszo i rowerem Valhalla zwraca każdy uskok chodnika jako osobny „skręt” (1–5 m). To szum.
 * Zostawiamy: start, cel, schody/przejścia/windy i prawdziwe skręty (zmiana kierunku >= 30°
 * względem ostatnio zachowanego odcinka); resztę wchłaniamy w poprzedni krok.
 */
export function simplifyWalk(mans) {
  if (!mans.length || !['pedestrian', 'bicycle'].includes(mans[0].travel_mode)) return mans;
  const out = [];
  let heading = null; // kierunek marszu na ostatnio zachowanym odcinku
  for (let k = 0; k < mans.length; k++) {
    const m = mans[k];
    const last = k === mans.length - 1;
    const hasBearing = typeof m.bearing_after === 'number';
    // przejście przez ulicę, po którym wracamy na dawny kierunek: to jedno „Przejdź przez ulicę”
    const nx = mans[k + 1];
    if (featureOf(m) === 'crossing' && k > 0 && !last && (m.length || 0) < 0.03 && heading != null && nx && typeof nx.bearing_after === 'number'
        && Math.abs(norm180(nx.bearing_after - heading)) < 30) {
      out.push({ ...m, _mod: 'straight' });
      continue;
    }
    if (k === 0 || last || featureOf(m) || !TURN_TYPES.has(m.type) || m.type === 12 || m.type === 13 || !hasBearing || heading == null) {
      out.push({ ...m });
      if (hasBearing) heading = m.bearing_after;
      continue;
    }
    const delta = norm180(m.bearing_after - heading);
    const a = Math.abs(delta);
    // krótki odcinek, po którym wracamy na dawny kierunek (zygzak chodnika)
    const nxt = mans[k + 1];
    const zigzag = (m.length || 0) < 0.02 && nxt && typeof nxt.bearing_after === 'number' && Math.abs(norm180(nxt.bearing_after - heading)) < 30;
    const beforeArrive = nxt && nxt.type >= 4 && nxt.type <= 6; // ostatnie metry przed celem
    const faint = a < 60 && (m.length || 0) < 0.025;           // lekki skręt na krótkim odcinku
    if (a < 30 || zigzag || faint || (beforeArrive && (m.length || 0) < 0.01)) { // drobny uskok: dalej idziemy prosto, odcinek dolicza się do poprzedniego kroku
      const prev = out[out.length - 1];
      prev.length = (prev.length || 0) + (m.length || 0);
      prev.time = (prev.time || 0) + (m.time || 0);
      continue;
    }
    const side = delta > 0 ? 'right' : 'left';
    const mod = a < 60 ? `slight ${side}` : a < 125 ? side : `sharp ${side}`; // „zawróć” tylko gdy tak mówi Valhalla (typ 12/13)
    out.push({ ...m, _mod: mod });
    heading = m.bearing_after;
  }
  return out;
}

/** Jedna trasa Valhalli (obiekt `trip`) -> obiekt jak trasa OSRM. */
export function tripToOsrmRoute(trip) {
  const coords = [];
  const steps = [];
  let legOffset = 0;
  for (const leg of trip.legs || []) {
    const shape = decodePolyline(leg.shape);
    for (let i = 0; i < shape.length; i++) { if (coords.length && i === 0) continue; coords.push(shape[i]); }
    const mans = simplifyWalk(leg.maneuvers || []);
    let roundaboutIdx = -1;
    for (let k = 0; k < mans.length; k++) {
      const m = mans[k];
      const meters = (m.length || 0) * 1000;
      const seconds = m.time || 0;
      const map = m._mod ? ['turn', m._mod] : (MAP[m.type] || ['turn', 'straight']);
      if (m.type === 27 && roundaboutIdx >= 0) { // zjazd z ronda: doliczamy do kroku „rondo” i bierzemy nazwę ulicy wyjazdowej
        const st = steps[roundaboutIdx];
        st.distance += meters; st.duration += seconds;
        const nn = nameOf(m); if (nn.name || nn.ref) { st.name = nn.name; st.ref = nn.ref; }
        roundaboutIdx = -1;
        continue;
      }
      const { name, ref } = nameOf(m);
      const maneuver = { type: map[0], modifier: map[1] || undefined, location: shape[m.begin_shape_index || 0] };
      const feature = m.travel_mode === 'pedestrian' ? featureOf(m) : null;
      if (feature) maneuver.feature = feature;
      if (m.type === 26) maneuver.exit = m.roundabout_exit_count || undefined;
      steps.push({ name, ref, distance: meters, duration: seconds, maneuver });
      if (m.type === 26) roundaboutIdx = steps.length - 1;
    }
    legOffset += shape.length;
  }
  void legOffset;
  const s = trip.summary || {};
  const first = steps.find((x) => x.name);
  return {
    distance: (s.length || 0) * 1000,
    duration: s.time || 0,
    geometry: { type: 'LineString', coordinates: coords },
    legs: [{ summary: first ? first.name : '', steps }],
  };
}

/** Odpowiedź /route Valhalli (z `alternates` lub bez) -> format OSRM zrozumiały dla parseRoutes. */
export function valhallaToOsrm(json) {
  if (!json || !json.trip) throw new Error(json && (json.error || json.error_code) ? String(json.error) : 'Brak trasy');
  if (json.trip.status && json.trip.status !== 0) throw new Error(json.trip.status_message || 'Brak trasy');
  const trips = [json.trip, ...((json.alternates || []).map((a) => a.trip).filter(Boolean))];
  return { code: 'Ok', routes: trips.map(tripToOsrmRoute) };
}

/** Zapytanie o trasę: costing = auto | pedestrian | bicycle. */
// Koszty dróg dopasowane do Polski. Domyślnie Valhalla bardzo karze pieszego za „podjazdy” i „alejki”
// (x5 i x2): na osiedlach to zwykle jedyne i najkrótsze przejścia, więc dawała objazdy wokół bloków.
export const SNAP_RADIUS = { auto: 10, pedestrian: 15, bicycle: 12 };

// auto.use_distance 0.6: pomiar lokalnym Valhallą na 10 trasach miejskich (Lublin) porównanych z OSRM:
// domyślnie +17,7 km nadmiaru (trasy do 70% dłuższe, objazdy po szybszych drogach); 0,6 -> +5,1 km, a trasy
// dalekie nadal idą ekspresówkami (Lublin-Warszawa 117 min). use_highways=0 odrzucone (203 min), 0,8 (+70 min na Kraków).
// Preferencja trasy samochodem (use_distance): pomiar lokalną Valhallą, Lublin, trasy miejskie (10) i dalekie:
//   fast 0   : miasto 104,7 km/219 min | Kraków 316 km/215 min
//   balanced 0,6 (domyślna): 91,4 km/225 min | Kraków 306 km/219 min
//   short 1  : 86,4 km/258 min | Kraków 261 km/315 min (55 km krócej, ale 100 min dłużej)
export const ROUTE_PREFS = {
  fast: { label: 'Najszybsza', useDistance: 0 },
  balanced: { label: 'Zrównoważona', useDistance: 0.6 },
  short: { label: 'Najkrótsza', useDistance: 1 },
};
export const DEFAULT_PREF = 'balanced';

export const COSTING_OPTIONS = {
  pedestrian: { pedestrian: { walkway_factor: 1, sidewalk_factor: 1, alley_factor: 1, driveway_factor: 1, use_living_streets: 1, use_tracks: 0.6 } },
  bicycle: { bicycle: { service_penalty: 5, use_living_streets: 1 } },
  auto: { auto: { use_distance: 0.6 } },
};

/**
 * Zapytanie o trasę. heading (stopnie) podajemy przy ponownym liczeniu w ruchu: trasa zaczyna się
 * wtedy zgodnie z kierunkiem jazdy (bez „zawróć” i objeżdżania bloku, gdy stoisz na wyjeździe).
 */
export function valhallaRequest(points, { costing = 'auto', alternatives = true, heading = null, pref = DEFAULT_PREF, exclude = null } = {}) {
  // radius: Valhalla bierze pod uwagę WSZYSTKIE drogi w tym promieniu, a nie tylko najbliższą. Bez tego
  // punkt przy chodniku ledwo połączonym z siecią (zamiast sąsiedniej uliczki) daje objazd wokół bloku.
  const R = SNAP_RADIUS[costing] ?? 10;
  const locations = points.map(([lon, lat]) => ({ lat, lon, radius: R }));
  if (heading != null && isFinite(heading)) { locations[0].heading = Math.round(((heading % 360) + 360) % 360); locations[0].heading_tolerance = 60; }
  let opts = COSTING_OPTIONS[costing];
  if (costing === 'auto') opts = { auto: { use_distance: (ROUTE_PREFS[pref] || ROUTE_PREFS[DEFAULT_PREF]).useDistance } };
  return {
    locations,
    costing,
    ...(opts && Object.keys(opts).length ? { costing_options: opts } : {}),
    directions_options: { language: 'pl-PL', units: 'kilometers' },
    ...(alternatives ? { alternates: 2 } : {}),
    ...(exclude && exclude.length ? { exclude_locations: exclude.map(([lon, lat]) => ({ lat, lon })) } : {}),
  };
}

// ---------- Dobór punktu wejścia do sieci dróg (pieszo, rower) ----------
// Valhalla przyczepia punkt do NAJBLIŻSZEJ drogi, nawet gdy to chodnik ledwo połączony z siecią,
// a 10 m dalej jest uliczka, którą dojdziesz 5 razy krócej. Dlatego pytamy o kilka najbliższych dróg
// i wybieramy tę, z której cała trasa (plus dojście do niej) wychodzi najszybciej.

const WALK_MS = 1.3; // m/s: dojście z punktu GPS do wybranej drogi

const rad = (d) => (d * Math.PI) / 180;
export function distM(a, b) { // a, b: [lon, lat]
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Odpowiedź /locate -> kandydaci: po jednym (najbliższym) na drogę, od najbliższego, do maxN. */
export function pickCandidates(locateJson, from, maxN = 8) {
  const best = new Map();
  const edges = (locateJson && locateJson[0] && locateJson[0].edges) || [];
  for (const e of edges) {
    if (typeof e.correlated_lat !== 'number') continue;
    const id = (e.edge_info && e.edge_info.way_id) ?? `${e.correlated_lat},${e.correlated_lon}`;
    const pt = [e.correlated_lon, e.correlated_lat];
    const d = distM(from, pt);
    if (!best.has(id) || d < best.get(id).d) best.set(id, { d, pt });
  }
  const list = [...best.values()].sort((x, y) => x.d - y.d).slice(0, maxN);
  return list.length ? list : [{ d: 0, pt: from }];
}

/** Macierz czasów (źródła x cele) + dojście -> najlepsza para punktów. */
export function pickBestPair(matrix, ca, cb) {
  let best = null;
  (matrix || []).forEach((row, i) => row.forEach((cell, j) => {
    if (cell == null || typeof cell.time !== 'number') return;
    const total = cell.time + (ca[i].d + cb[j].d) / WALK_MS;
    if (!best || total < best.total) best = { total, i, j };
  }));
  return best ? { from: ca[best.i], to: cb[best.j] } : null;
}

async function getJson(base, path, body, signal) {
  const res = await fetch(`${base.replace(/\/$/, '')}/${path}?json=${encodeURIComponent(JSON.stringify(body))}`, { signal });
  if (!res.ok) throw new Error(`Valhalla ${path}: ${res.status}`);
  return res.json();
}

export async function snapEnds(base, from, to, costing, { signal, radius = 30, maxN = 8 } = {}) {
  const loc = (p) => getJson(base, 'locate', { locations: [{ lat: p[1], lon: p[0], radius }], costing, verbose: true }, signal);
  const [la, lb] = await Promise.all([loc(from), loc(to)]);
  const ca = pickCandidates(la, from, maxN);
  const cb = pickCandidates(lb, to, maxN);
  const m = await getJson(base, 'sources_to_targets', {
    sources: ca.map((c) => ({ lat: c.pt[1], lon: c.pt[0] })),
    targets: cb.map((c) => ({ lat: c.pt[1], lon: c.pt[0] })),
    costing,
    ...(COSTING_OPTIONS[costing] && Object.keys(COSTING_OPTIONS[costing]).length ? { costing_options: COSTING_OPTIONS[costing] } : {}),
  }, signal);
  return pickBestPair(m.sources_to_targets, ca, cb);
}

/** Dokleja prawdziwy początek i koniec (dojście do drogi), tak by kroki i geometria się zgadzały. */
export function withEndpoints(osrm, origin, dest, d0, d1) {
  for (const r of osrm.routes) {
    const c = r.geometry.coordinates;
    if (d0 > 1) c.unshift(origin);
    if (d1 > 1) c.push(dest);
    const steps = r.legs[0].steps;
    if (d0 > 1) { steps[0].distance += d0; steps[0].duration += d0 / WALK_MS; }
    if (d1 > 1 && steps.length > 1) { steps[steps.length - 2].distance += d1; steps[steps.length - 2].duration += d1 / WALK_MS; }
    r.distance += (d0 > 1 ? d0 : 0) + (d1 > 1 ? d1 : 0);
    r.duration += ((d0 > 1 ? d0 : 0) + (d1 > 1 ? d1 : 0)) / WALK_MS;
  }
  return osrm;
}

const SNAP_MODES = new Set(['pedestrian', 'bicycle']);


// ---------- Unikanie dróg gruntowych i serwisowych w środku trasy (tylko samochód) ----------
// Valhalla skraca sobie trasy polnymi drogami (use=track) i nienazwanymi drogami serwisowymi. Kara w kosztach
// (use_tracks, service_factor, exclude_unpaved) tego nie usuwa: pomiar na 100 trasach pod Lublinem. Dlatego po
// wyznaczeniu trasy pytamy serwer, po jakich rodzajach dróg ona idzie (trace_attributes), a gdy w środku trasy
// (dalej niż END_KEEP_M od początku i końca) jest taki odcinek, liczymy ją jeszcze raz z wykluczeniem tych
// krawędzi (exclude_locations). Dojazd na początku i końcu (wieś, osiedle) zostaje bez zmian.
// Pomiar: poprawianych 14/100 tras, średnio +0,6 km, czas bez pogorszenia; w 3 przypadkach nie ma objazdu
// (jedyny dojazd) i zostaje trasa pierwotna.
export const AVOID = { endKeepM: 600, trackMinM: 60, svcMinNearM: 400, svcMinFarM: 150, farM: 15000, maxExclude: 40, maxRounds: 5,
  maxTimeFactor: 1.15, maxTimeAddS: 60, maxLenFactor: 1.3, maxLenAddM: 500 };
const SERVICE_USES = new Set(['service_road', 'driveway', 'parking_aisle', 'alley', 'drive_through', 'emergency_access']);

export function encodePolyline(coords, precision = 6) { // coords: [[lon, lat], ...]
  const f = 10 ** precision; let pLat = 0; let pLon = 0; let out = '';
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lon, lat] of coords) { const la = Math.round(lat * f); const lo = Math.round(lon * f); out += enc(la - pLat) + enc(lo - pLon); pLat = la; pLon = lo; }
  return out;
}

/** Środek odcinka shape[i0..i1] jako [lon, lat] (null dla bardzo krótkich). */
export function midOf(shape, i0, i1) {
  const pts = shape.slice(i0, i1 + 1); if (pts.length < 2) return null;
  const L = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = distM(pts[i - 1], pts[i]); L.push(d); tot += d; }
  if (tot < 12) return null;
  let c = 0; const half = tot / 2;
  for (let i = 0; i < L.length; i++) {
    if (c + L[i] >= half) { const f = L[i] ? (half - c) / L[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; }
    c += L[i];
  }
  return null;
}

/**
 * Z odpowiedzi trace_attributes wybiera krawędzie do wykluczenia: drogi gruntowe (>= trackMinM w jednym ciągu)
 * i serwisowe (ciąg >= svcMin) leżące w środku trasy. Zwraca punkty [lon, lat] w środkach tych krawędzi.
 */
export function minorEdges(edges, shape, { endKeepM, trackMinM, svcMinNearM, svcMinFarM, farM } = AVOID) {
  const total = edges.reduce((a, e) => a + e.length * 1000, 0);
  const svcMin = total >= farM ? svcMinFarM : svcMinNearM;
  const runs = []; let cur = null; let acc = 0;
  for (const e of edges) {
    const ln = e.length * 1000; const track = e.use === 'track'; const svc = SERVICE_USES.has(e.use);
    const mid = acc > endKeepM && acc + ln < total - endKeepM;
    if ((track || svc) && mid) {
      const g = track ? 't' : 's';
      if (cur && cur.g === g) { cur.m += ln; cur.es.push(e); } else { if (cur) runs.push(cur); cur = { g, m: ln, es: [e] }; }
    } else if (cur) { runs.push(cur); cur = null; }
    acc += ln;
  }
  if (cur) runs.push(cur);
  const points = []; let meters = 0;
  for (const r of runs) {
    if (r.m < (r.g === 't' ? trackMinM : svcMin)) continue;
    meters += r.m;
    for (const e of r.es) { const m = midOf(shape, e.begin_shape_index, e.end_shape_index); if (m) points.push(m); }
  }
  return { points, meters };
}
export const minorEdgePoints = (edges, shape, o) => minorEdges(edges, shape, o).points;

async function postJson(base, path, body, signal) {
  const res = await fetch(`${base.replace(/\/$/, '')}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`Valhalla ${path}: ${res.status}`);
  return res.json();
}

/** Czy nowa trasa jest na tyle dobra, by zastąpić pierwotną (nie dłuższa i nie wolniejsza ponad miarę). */
export function acceptDetour(base, cand) {
  return cand.duration <= base.duration * AVOID.maxTimeFactor + AVOID.maxTimeAddS && cand.distance <= base.distance * AVOID.maxLenFactor + AVOID.maxLenAddM;
}

async function minorOf(base, route, signal) {
  const ta = await postJson(base, 'trace_attributes', {
    encoded_polyline: encodePolyline(route.geometry.coordinates), costing: 'auto', shape_match: 'edge_walk',
    filters: { attributes: ['edge.use', 'edge.length', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' },
  }, signal);
  if (!ta.edges || !ta.shape) throw new Error('trace_attributes: brak krawędzi');
  return minorEdges(ta.edges, decodePolyline(ta.shape));
}

/**
 * Kolejne rundy: wykluczamy środki niechcianych krawędzi, liczymy trasę ponownie i bierzemy najlepszą
 * (najmniej metrów dróg gruntowych/serwisowych w środku), pod warunkiem że objazd jest rozsądny (acceptDetour).
 */
export async function avoidMinorRoads(base, osrm, requestFn, { signal } = {}) {
  const orig = osrm.routes[0];
  let cur = await minorOf(base, orig, signal);
  let best = osrm; let bestM = cur.meters; const excluded = [];
  const startM = cur.meters; osrm.avoid = startM > 0 ? `jest ${Math.round(startM)} m, nie poprawiono` : 'czysta';
  for (let round = 0; round < AVOID.maxRounds && cur.points.length && bestM > 0; round++) {
    for (const p of cur.points) excluded.push(p);
    let cand;
    try { cand = await requestFn(excluded.slice(-AVOID.maxExclude)); } catch { break; } // brak objazdu: zostaje najlepsza dotąd
    if (!cand.routes.length || !acceptDetour(orig, cand.routes[0])) break;
    cur = await minorOf(base, cand.routes[0], signal);
    if (cur.meters < bestM) { best = cand; bestM = cur.meters; }
  }
  if (best !== osrm) best.avoid = `poprawiona ${Math.round(startM)}→${Math.round(bestM)} m`;
  else if (startM > 0) osrm.avoid = `jest ${Math.round(startM)} m, objazd gorszy lub brak`;
  return best;
}

export async function fetchValhallaRoutes(base, points, { costing = 'auto', alternatives = true, heading = null, pref = DEFAULT_PREF, timeoutMs = 9000 } = {}) {
  const get = async (hd, pts, exact, exclude = null) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body = valhallaRequest(pts, { costing, alternatives, heading: hd, pref, exclude });
      if (exact) body.locations.forEach((l) => { delete l.radius; });
      const res = await fetch(`${base.replace(/\/$/, '')}/route?json=${encodeURIComponent(JSON.stringify(body))}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Valhalla: ${res.status}`);
      return valhallaToOsrm(await res.json());
    } finally {
      clearTimeout(timer);
    }
  };
  // Pieszo i rowerem: wybieramy najlepszy punkt wejścia do sieci dróg. Gdy się nie uda, zwykła trasa.
  if (SNAP_MODES.has(costing) && points.length === 2) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      let pair;
      try { pair = await snapEnds(base, points[0], points[1], costing, { signal: ctrl.signal }); } finally { clearTimeout(timer); }
      if (pair) {
        const osrm = await get(null, [pair.from.pt, pair.to.pt], true);
        return withEndpoints(osrm, points[0], points[1], pair.from.d, pair.to.d);
      }
    } catch { /* przechodzimy do zwykłego zapytania */ }
  }
  // Kierunek jazdy to wskazówka: gdy żadna droga go nie spełnia, liczymy bez niego.
  let hd = null; let first = null;
  if (heading != null && isFinite(heading)) {
    try { first = await get(heading, points, false); hd = heading; } catch { /* bez kierunku */ }
  }
  if (!first) first = await get(null, points, false);
  if (costing !== 'auto' || points.length !== 2 || !first.routes.length) return first;
  try { // samochód: bez polnych i serwisowych dróg w środku trasy (nie może opóźnić ani zepsuć trasy pierwotnej)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try { return await avoidMinorRoads(base, first, (ex) => get(hd, points, false, ex), { signal: ctrl.signal }); } finally { clearTimeout(timer); }
  } catch (e) { first.avoid = `błąd: ${e && e.message ? e.message : e}`; return first; }
}
