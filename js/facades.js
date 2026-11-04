// Elewacje budynków rysowane w kodzie: tynk, okna, a nocą światła w części okien.
// To nie są zdjęcia prawdziwych budynków, tylko spójna tekstura nakładana na bryły z OpenStreetMap.

const SETS = {
  day: { plaster: ['#F6EEDF', '#ECE9E2', '#F7E6CC'], glass: '#6F8AA6', frame: '#FFFFFF', lit: null },
  night: { plaster: ['#1E2E4A', '#233452', '#1B2A44'], glass: '#101D31', frame: '#2A3C5C', lit: '#FFC873' },
};

function facade(plaster, set, cols, rows, seed) {
  const n = 128; const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = plaster; g.fillRect(0, 0, n, n);
  let r = seed * 7919 + 13;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const cw = n / cols; const rh = n / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.3; const py = y * rh + rh * 0.24; const w = cw * 0.4; const h = rh * 0.5;
      g.fillStyle = set.frame; g.fillRect(px - 1, py - 1, w + 2, h + 2);
      g.fillStyle = set.lit && rnd() < 0.34 ? set.lit : set.glass; g.fillRect(px, py, w, h);
    }
  }
  return g.getImageData(0, 0, n, n);
}

/** Dodaje tekstury do bieżącego stylu mapy (po każdej zmianie motywu trzeba je dodać ponownie). */
export function addFacades(map, night) {
  const set = night ? SETS.night : SETS.day;
  set.plaster.forEach((p, i) => {
    const low = `fa-low-${i}`; const high = `fa-high-${i}`;
    if (!map.hasImage(low)) map.addImage(low, facade(p, set, 6, 4, i + 1));
    if (!map.hasImage(high)) map.addImage(high, facade(p, set, 12, 16, i + 11));
  });
}
