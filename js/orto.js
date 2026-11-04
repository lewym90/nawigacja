// Zdjęcia lotnicze z Geoportalu. Usługa odpowiada wolno (1–10 s na kafel), więc pobieramy je zawczasu wzdłuż trasy,
// a service worker zapamiętuje je na telefonie. Adresy muszą być co do znaku takie, jakie tworzy mapa dla {bbox-epsg-3857}.

import { CONFIG } from './config.js';
import { pointAt } from './geo.js';

const R = 6378137;

/** Prostokąt kafla w EPSG:3857, ten sam wzór co w MapLibre (siatka 256 niezależnie od tileSize). */
export function tileBBox(x, y, z) {
  const yy = 2 ** z - y - 1;
  const res = (2 * Math.PI * R) / 256 / 2 ** z;
  const mx = (px) => px * res - (2 * Math.PI * R) / 2;
  return `${mx(x * 256)},${mx(yy * 256)},${mx((x + 1) * 256)},${mx((yy + 1) * 256)}`;
}

export function tileAt([lng, lat], z) {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [Math.floor(((lng + 180) / 360) * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)];
}

/** Kafle wzdłuż trasy od `from` do `to` metrów, najbliższe pierwsze; każdy kafel raz. */
export function tilesAlong(line, from, to, z = 16) {
  const seen = new Set(); const out = [];
  const step = (40075000 * Math.cos((51.5 * Math.PI) / 180)) / 2 ** z / 3;
  for (let m = from; m <= Math.min(line.total, to); m += step) {
    const [x, y] = tileAt(pointAt(line, m).point, z);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx}/${y + dy}`;
      if (!seen.has(k)) { seen.add(k); out.push([x + dx, y + dy, z]); }
    }
  }
  return out;
}

const done = new Set();
let running = 0; let queue = [];
function pump() {
  while (running < 3 && queue.length) {
    const t = queue.shift(); const key = t.join('/');
    if (done.has(key)) continue;
    done.add(key); running++;
    fetch(CONFIG.ortoUrl.replace('{bbox-epsg-3857}', tileBBox(...t)), { mode: 'cors' }).catch(() => done.delete(key)).finally(() => { running--; pump(); });
  }
}

/** Kolejka zawsze zaczyna się od tego, co najbliżej auta. */
export function prefetchOrto(line, along, metres = 2500) {
  queue = tilesAlong(line, along, along + metres);
  pump();
}
