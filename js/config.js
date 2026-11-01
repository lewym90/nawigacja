// Adresy usług. Wszystko, co zewnętrzne, jest tutaj, żeby podmienić na własny serwer
// (lewym90) jednym plikiem. Domyślne wartości to publiczne, darmowe usługi oparte na
// OpenStreetMap: do prototypu i użytku własnego, nie do dużego ruchu.

export const CONFIG = {
  // Kafelki wektorowe w schemacie OpenMapTiles (OpenFreeMap). Docelowo: własny plik PMTiles.
  tilesUrl: 'https://tiles.openfreemap.org/planet',
  glyphsUrl: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  fontRegular: 'Noto Sans Regular',
  fontBold: 'Noto Sans Bold',

  // Silnik tras zgodny z API OSRM. Docelowo: własny Valhalla/OSRM na serwerze.
  routingUrl: 'https://router.project-osrm.org',

  // Overpass: fotoradary i odcinkowe pomiary z OSM.
  overpassUrl: 'https://overpass-api.de/api/interpreter',

  // Wyszukiwanie adresów (Photon, oparty na OSM).
  geocodeUrl: 'https://photon.komoot.io/api/',

  // Własna warstwa poprawek (wygrywa z OSM).
  localHazardsUrl: './data/hazards.local.json',

  // Środek startowy mapy: Lublin.
  center: [22.5684, 51.2465],
  zoom: 12,
};

export const APP_VERSION = '0.1.12';

export const STORAGE = { settings: 'nav.settings', lastDest: 'nav.lastDest' };

export const DEFAULT_SETTINGS = {
  voice: true,
  theme: 'auto', // auto | day | night
  tilt: true,
  hazardsVoice: true,
  ttsEngine: 'system', // robot = wbudowany | system = głos telefonu
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE.settings) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE.settings, JSON.stringify(s));
  } catch {
    /* tryb prywatny: ustawienia żyją do zamknięcia */
  }
}
