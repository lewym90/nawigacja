// Asystent pasów ruchu: dane z Valhalli (OSM turn:lanes). Tam gdzie OSM nie ma pasów, nic nie pokazujemy.

// bity kierunków w odpowiedzi Valhalli -> kąt strzałki w stopniach
const BITS = [[2, 0], [4, -135], [8, -90], [16, -40], [32, 40], [64, 90], [128, 135], [256, -180]];

/** [{directions, active}] -> [{angles:[...], on}]; zwraca null, gdy pasów jest za mało, by coś doradzić. */
export function parseLanes(list) {
  if (!Array.isArray(list) || list.length < 2) return null;
  const lanes = list.map((l) => {
    const angles = BITS.filter(([b]) => l.directions & b).map(([, a]) => a);
    return { angles: angles.length ? angles : [0], on: !!l.active };
  });
  return lanes.some((l) => l.on) ? lanes : null;
}

const WORDS = { straight: 0, 'slight left': -40, left: -90, 'sharp left': -135, 'slight right': 40, right: 90, 'sharp right': 135, uturn: -180 };

/** Pasy przy mijanym skrzyżowaniu (format OSRM): [{indications, active}] -> [{angles, on}]. */
export function parseJunctionLanes(list) {
  if (!Array.isArray(list) || list.length < 2) return null;
  const lanes = list.map((l) => {
    const angles = (l.indications || []).filter((w) => w in WORDS).map((w) => WORDS[w]);
    return { angles: angles.length ? angles : [0], on: !!l.active || !!l.valid };
  });
  return lanes.some((l) => l.on) && lanes.some((l) => !l.on) ? lanes : null;
}

/** Pierwsze skrzyżowanie z pasami przed autem w zasięgu `win` metrów. */
export function junctionAhead(list, along, win) {
  const j = (list || []).find((x) => x.at > along + 5);
  return j && j.at - along <= win ? j : null;
}

/** Czy wskazane pasy prowadzą prosto: wtedy manewr nie jest skrętem ani rozwidleniem, nawet gdy silnik tak go nazywa. */
export function lanesStraight(list) {
  const on = (list || []).filter((l) => l.active);
  return on.length > 0 && on.every((l) => l.directions & 2);
}

/**
 * Komunikat głosowy o pasach. Mówimy tylko przy skręcie i tylko gdy strona pasów zgadza się ze stroną skrętu.
 * Przy jeździe prosto milczymy: położenie pasa w danych OSM nie oznacza, że trzeba zjeżdżać na bok.
 */
export function laneAdvice(lanes, modifier = '') {
  if (!lanes || lanes.length < 2) return null;
  const side = /left/.test(modifier) ? 'left' : /right/.test(modifier) ? 'right' : null;
  if (!side) return null;
  const n = lanes.length; const on = lanes.map((l, i) => (l.on ? i : -1)).filter((i) => i >= 0);
  if (!on.length || on.length === n) return null;
  const turning = on.every((i) => lanes[i].angles.some((a) => (side === 'left' ? a < 0 : a > 0)));
  if (!turning) return null;
  if (side === 'left' && on[on.length - 1] < n / 2) return on.length === 1 ? 'Zajmij lewy pas' : 'Zajmij lewe pasy';
  if (side === 'right' && on[0] >= n / 2) return on.length === 1 ? 'Zajmij prawy pas' : 'Zajmij prawe pasy';
  return null;
}

/** Odcinki trasy z liczbą pasów (Valhalla trace_attributes) -> linie podziału pasów i szerokość jezdni. */
export function laneFeatures(edges, shape) {
  const LANE = 3.3; const MIN_M = 70; const groups = [];
  for (const e of edges) {
    const both = e.traversability === 'both'; const n = e.lane_count || 1;
    const last = groups[groups.length - 1];
    if (last && last.n === n && last.both === both && last.to === e.begin_shape_index) { last.to = e.end_shape_index; last.m += (e.length || 0) * 1000; }
    else groups.push({ n, both, from: e.begin_shape_index, to: e.end_shape_index, m: (e.length || 0) * 1000 });
  }
  const out = [];
  const add = (coords, o) => out.push({ type: 'Feature', properties: { kind: 'div', o }, geometry: { type: 'LineString', coordinates: coords } });
  for (const g of groups) {
    const coords = shape.slice(g.from, g.to + 1);
    if (coords.length < 2 || g.n < 2 || g.m < MIN_M) continue; // krótkie kawałki dawały migające linie
    if (g.both) for (let k = 1; k < g.n; k++) for (const s of [-1, 1]) add(coords, s * k * LANE);
    else for (let k = 1; k < g.n; k++) add(coords, (k - g.n / 2) * LANE);
  }
  return out;
}

const arrow = (a, cls) => `<path class="${cls}" transform="rotate(${a} 12 18)" d="M12 18V6M7 11l5-5 5 5" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
export const lanesHtml = (lanes) => lanes.map((l) => `<svg viewBox="-2 0 28 24" class="lane${l.on ? ' on' : ''}" aria-hidden="true">${l.angles.map((a) => arrow(a, 'a')).join('')}</svg>`).join('');

/** „kierunek: Przemyśl, Bychawa” z opisu manewru. */
export function towardOf(text) {
  const m = /kierunek: ([^.]+)\./.exec(text || '');
  return m ? m[1].replace(/\//g, ', ').trim() : '';
}
