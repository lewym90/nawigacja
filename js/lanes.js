// Asystent pasów ruchu: dane z Valhalli (OSM turn:lanes). Tam gdzie OSM nie ma pasów, nic nie pokazujemy.

// bity kierunków w odpowiedzi Valhalli -> kąt strzałki w stopniach
const BITS = [[2, 0], [4, -135], [8, -90], [16, -40], [32, 40], [64, 90], [128, 135], [256, -180], [512, 180]];

/** [{directions, active}] -> [{angles:[...], on}]; zwraca null, gdy pasów jest za mało, by coś doradzić. */
export function parseLanes(list) {
  if (!Array.isArray(list) || list.length < 2) return null;
  const lanes = list.map((l) => {
    const angles = BITS.filter(([b]) => l.directions & b).map(([, a]) => a);
    return { angles: angles.length ? angles : [0], on: !!l.active };
  });
  return lanes.some((l) => l.on) ? lanes : null;
}

/** Komunikat głosowy tylko wtedy, gdy trzeba zająć konkretną stronę. */
export function laneAdvice(lanes) {
  if (!lanes || lanes.length < 2) return null;
  const n = lanes.length; const on = lanes.map((l, i) => (l.on ? i : -1)).filter((i) => i >= 0);
  if (!on.length || on.length === n) return null;
  if (on[on.length - 1] < n / 2) return on.length === 1 && n > 2 ? 'Zajmij lewy pas' : 'Trzymaj się lewych pasów';
  if (on[0] >= n / 2) return on.length === 1 && n > 2 ? 'Zajmij prawy pas' : 'Trzymaj się prawych pasów';
  return n >= 3 ? 'Trzymaj się środkowego pasa' : null;
}

const arrow = (a, cls) => `<path class="${cls}" transform="rotate(${a} 12 18)" d="M12 18V6M7 11l5-5 5 5" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
export const lanesHtml = (lanes) => lanes.map((l) => `<svg viewBox="-2 0 28 24" class="lane${l.on ? ' on' : ''}" aria-hidden="true">${l.angles.map((a) => arrow(a, 'a')).join('')}</svg>`).join('');

/** „kierunek: Przemyśl, Bychawa” z opisu manewru. */
export function towardOf(text) {
  const m = /kierunek: ([^.]+)\./.exec(text || '');
  return m ? m[1].replace(/\//g, ', ').trim() : '';
}
