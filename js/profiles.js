// Profile kamery i jakości nowego wyglądu. Tylko liczby: silnik i kamera czytają je przy każdej klatce,
// więc zmiana działa od razu, także w trakcie jazdy.

export const CAMERA_PROFILES = {
  classic: { label: 'Klasyczna', pitch: 60, zoom: -0.6, bearingTau: 0.8 }, // wyżej i dalej: najwięcej drogi przed autem
  dynamic: { label: 'Dynamiczna', pitch: 68, zoom: 0, bearingTau: 0.8 },
  close: { label: 'Z bliska', pitch: 67.4, zoom: 0, bearingTau: 0.8, close: true }, // stały widok z CLOSE_CAM
};

export const QUALITY_PROFILES = {
  ultra: { label: 'Ultra', pixelRatio: 3, radius: 2600, drop: 3600, shadows: true },
  high: { label: 'Wysoka', pixelRatio: 2, radius: 2000, drop: 3000, shadows: true },
  eco: { label: 'Eko', pixelRatio: 1.5, radius: 1300, drop: 1900, shadows: false }, // na długą trasę: mniej grzeje telefon
};

/** Kamera „Z bliska”: 10 m nad jezdnią i 24 m za autem. Patrzy tak, że horyzont wypada w górnej jednej trzeciej ekranu. */
export const CLOSE_CAM = { height: 10, back: 24, carY: 0.77, ribbon: 1.9, trigger: 100, release: 100, secondsAhead: 5, tau: 0.9 };
export const RIBBON_WIDE = 4.2;

export const cameraProfile = (id) => CAMERA_PROFILES[id === 'cinematic' ? 'close' : id] || CAMERA_PROFILES.dynamic;

export const lerp = (a, b, k) => a + (b - a) * k;

/** Zoom, przy którym kamera mapy stoi `dist` metrów od auta. */
export function zoomForDistance(dist, lat, screenH, fov) {
  const f = screenH / 2 / Math.tan((fov * Math.PI) / 360);
  return Math.log2((f / dist) * (40075016.68 * Math.cos((lat * Math.PI) / 180)) / 512);
}

/** Do którego miejsca trasy trzymać niską kamerę. Skrzyżowanie albo przeszkoda przedłużają ten odcinek. */
export function closeUntil({ along, kmh, nextAt, blocked, until }) {
  let u = until != null && until - along <= CLOSE_CAM.trigger + CLOSE_CAM.release + 300 ? until : -1; // po nowej trasie stary znacznik nic nie znaczy
  const reach = Math.max(CLOSE_CAM.trigger, (kmh / 3.6) * CLOSE_CAM.secondsAhead);
  if (nextAt != null && nextAt >= along && nextAt - along <= reach) u = Math.max(u, nextAt + CLOSE_CAM.release);
  if (blocked) u = Math.max(u, along + CLOSE_CAM.release);
  return u;
}
export const qualityProfile = (id) => QUALITY_PROFILES[id] || QUALITY_PROFILES.high;
