// Elewacje budynków: tekstury ze zdjęć (assets/facades -> icons/fa), dzienne i nocne.
// Budynek dostaje rodzaj wg wysokości i wariant wg swojego numeru, więc sąsiednie domy się różnią,
// a ten sam dom wygląda tak samo przy każdym przejeździe.

import { FACADE_KINDS } from './facade-list.js';

// ile fizycznych pikseli tekstury przypada na jeden punkt obrazu: dobrane tak, by piętro miało ok. 3 m przy kamerze jazdy
const RATIO = { house: 6, tenement: 4, block: 4, office: 3 };
export const facadeId = (kind, i) => `fa-${kind}-${i}`;

const cache = {};
function load(url) {
  return new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => ok(null);
    im.src = url;
  });
}

/** Pobiera tekstury obu motywów. Brak pliku nie blokuje mapy: budynek dostanie zapasowy tynk. */
export async function loadFacades() {
  const jobs = [];
  for (const [kind, n] of Object.entries(FACADE_KINDS)) {
    for (let i = 0; i < n; i++) {
      for (const t of ['day', 'night']) jobs.push(load(`./icons/fa/${kind}-${i}-${t}.webp`).then((im) => { cache[`${kind}-${i}-${t}`] = im; }));
    }
  }
  for (const n of ['grass', 'pave', 'asphalt']) jobs.push(load(`./icons/tx-${n}.webp`).then((im) => { cache[`tx-${n}`] = im; }));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 4000))]);
}

function plain(night) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'); g.fillStyle = night ? '#1B2A44' : '#EFE6D6'; g.fillRect(0, 0, 16, 16);
  return g.getImageData(0, 0, 16, 16);
}

function ground(im, night) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  if (im) g.drawImage(im, 0, 0, 256, 256); else { g.fillStyle = '#6f7a60'; g.fillRect(0, 0, 256, 256); }
  if (night) { g.globalCompositeOperation = 'multiply'; g.fillStyle = '#1c2a40'; g.fillRect(0, 0, 256, 256); }
  return g.getImageData(0, 0, 256, 256);
}

/** Dodaje tekstury do bieżącego stylu mapy (po każdej zmianie motywu trzeba je dodać ponownie). */
export function addFacades(map, night) {
  for (const [n, r] of [['grass', 2], ['pave', 2], ['asphalt', 1]]) {
    const id = `tx-${n}`;
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, ground(cache[id], night), { pixelRatio: r });
  }
  const t = night ? 'night' : 'day';
  for (const [kind, n] of Object.entries(FACADE_KINDS)) {
    for (let i = 0; i < n; i++) {
      const id = facadeId(kind, i);
      if (map.hasImage(id)) map.removeImage(id);
      const im = cache[`${kind}-${i}-${t}`];
      map.addImage(id, im || plain(night), { pixelRatio: im ? RATIO[kind] : 1 });
    }
  }
}
