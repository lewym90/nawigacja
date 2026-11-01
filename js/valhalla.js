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
};

function nameOf(m) {
  const names = (m.street_names && m.street_names.length ? m.street_names : m.begin_street_names) || [];
  // Valhalla miesza nazwy i numery dróg: nazwa to pierwszy wpis z literami, numer to np. „S17”, „DK 17”
  const ref = names.find((n) => /^(A|S|DK|DW)\s?\d+$/i.test(n) || /^\d{1,3}$/.test(n));
  const name = names.find((n) => n !== ref && /[a-ząćęłńóśźż]{3,}/i.test(n)) || '';
  return { name, ref: ref || '' };
}

/** Jedna trasa Valhalli (obiekt `trip`) -> obiekt jak trasa OSRM. */
export function tripToOsrmRoute(trip) {
  const coords = [];
  const steps = [];
  let legOffset = 0;
  for (const leg of trip.legs || []) {
    const shape = decodePolyline(leg.shape);
    for (let i = 0; i < shape.length; i++) { if (coords.length && i === 0) continue; coords.push(shape[i]); }
    const mans = leg.maneuvers || [];
    let roundaboutIdx = -1;
    for (let k = 0; k < mans.length; k++) {
      const m = mans[k];
      const meters = (m.length || 0) * 1000;
      const seconds = m.time || 0;
      const map = MAP[m.type] || ['turn', 'straight'];
      if (m.type === 27 && roundaboutIdx >= 0) { // zjazd z ronda: doliczamy do kroku „rondo” i bierzemy nazwę ulicy wyjazdowej
        const st = steps[roundaboutIdx];
        st.distance += meters; st.duration += seconds;
        const nn = nameOf(m); if (nn.name || nn.ref) { st.name = nn.name; st.ref = nn.ref; }
        roundaboutIdx = -1;
        continue;
      }
      const { name, ref } = nameOf(m);
      const maneuver = { type: map[0], modifier: map[1] || undefined, location: shape[m.begin_shape_index || 0] };
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
export function valhallaRequest(points, { costing = 'auto', alternatives = true } = {}) {
  return {
    locations: points.map(([lon, lat]) => ({ lat, lon })),
    costing,
    directions_options: { language: 'pl-PL', units: 'kilometers' },
    ...(alternatives ? { alternates: 2 } : {}),
  };
}

export async function fetchValhallaRoutes(base, points, { costing = 'auto', alternatives = true, timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const q = encodeURIComponent(JSON.stringify(valhallaRequest(points, { costing, alternatives })));
    const res = await fetch(`${base.replace(/\/$/, '')}/route?json=${q}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Valhalla: ${res.status}`);
    return valhallaToOsrm(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
