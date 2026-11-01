// Geometria: odległości, kierunki, rzutowanie punktu na trasę.
// Punkty to [lng, lat]. Odległości w metrach, kąty w stopniach.

export const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Najmniejsza różnica kątów, 0..180. */
export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function destination(p, brg, dist) {
  const d = dist / R;
  const b = rad(brg);
  const lat1 = rad(p[1]);
  const lng1 = rad(p[0]);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [((deg(lng2) + 540) % 360) - 180, deg(lat2)];
}

/** Linia z narastającymi odległościami. */
export function buildLine(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return { coords, cum, total: cum[cum.length - 1] || 0 };
}

// Rzut na lokalną płaszczyznę (metry) wokół punktu odniesienia.
function toLocal(p, origin) {
  const k = Math.cos(rad(origin[1]));
  return [rad(p[0] - origin[0]) * R * k, rad(p[1] - origin[1]) * R];
}

/**
 * Najbliższy punkt na linii.
 * hint: indeks odcinka, wokół którego szukamy najpierw (szybciej i stabilniej).
 * Zwraca { dist, along, idx, point, t }.
 */
export function project(line, p, hint = null, window = 60) {
  const n = line.coords.length;
  if (n < 2) return { dist: Infinity, along: 0, idx: 0, point: line.coords[0], t: 0 };
  const scan = (from, to) => {
    let best = null;
    for (let i = from; i < to; i++) {
      const a = line.coords[i];
      const b = line.coords[i + 1];
      const A = [0, 0];
      const B = toLocal(b, a);
      const P = toLocal(p, a);
      const len2 = B[0] * B[0] + B[1] * B[1];
      let t = len2 > 0 ? (P[0] * B[0] + P[1] * B[1]) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = P[0] - B[0] * t;
      const dy = P[1] - B[1] * t;
      const d = Math.hypot(dx, dy);
      if (!best || d < best.dist) {
        const segLen = line.cum[i + 1] - line.cum[i];
        best = {
          dist: d,
          along: line.cum[i] + segLen * t,
          idx: i,
          t,
          point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        };
      }
    }
    return best;
  };
  if (hint != null) {
    const from = Math.max(0, hint - 5);
    const to = Math.min(n - 1, hint + window);
    const local = scan(from, to);
    // Jeśli lokalny wynik jest blisko, ufamy mu; inaczej przeszukujemy całość.
    if (local && local.dist < 60) return local;
  }
  return scan(0, n - 1);
}

/** Punkt na linii po przejściu `along` metrów od początku. */
export function pointAt(line, along) {
  const a = Math.max(0, Math.min(line.total, along));
  let lo = 0;
  let hi = line.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const seg = line.cum[hi] - line.cum[lo];
  const t = seg > 0 ? (a - line.cum[lo]) / seg : 0;
  const p0 = line.coords[lo];
  const p1 = line.coords[hi];
  return {
    point: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t],
    idx: lo,
    bearing: bearing(p0, p1),
  };
}

/** Obwiednia [minLng, minLat, maxLng, maxLat] z marginesem w metrach. */
export function bbox(coords, marginM = 0) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [x, y] of coords) {
    if (x < minLng) minLng = x;
    if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  const dLat = deg(marginM / R);
  const dLng = deg(marginM / (R * Math.cos(rad((minLat + maxLat) / 2))));
  return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
}

/** Kopie kolejnych kawałków trasy do zapytań o dane (kafelki obwiedni). */
export function corridorBoxes(line, marginM = 400, stepM = 25000) {
  const boxes = [];
  for (let s = 0; s < line.total; s += stepM) {
    const e = Math.min(line.total, s + stepM);
    const pts = [];
    for (let a = s; a <= e; a += Math.max(200, (e - s) / 40)) pts.push(pointAt(line, a).point);
    pts.push(pointAt(line, e).point);
    boxes.push(bbox(pts, marginM));
  }
  return boxes;
}

/** Obwiednie dla fragmentu trasy [fromM, toM] (do wczytywania danych „z wyprzedzeniem”). */
export function corridorBoxesRange(line, fromM, toM, marginM = 400, stepM = 20000) {
  const boxes = [];
  const end = Math.min(line.total, toM);
  for (let s = Math.max(0, fromM); s < end; s += stepM) {
    const e = Math.min(end, s + stepM);
    const pts = [];
    for (let a = s; a <= e; a += Math.max(200, (e - s) / 40)) pts.push(pointAt(line, a).point);
    pts.push(pointAt(line, e).point);
    boxes.push(bbox(pts, marginM));
  }
  return boxes;
}
