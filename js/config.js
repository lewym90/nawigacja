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
  routingOwnUrl: 'https://188-68-247-201.sslip.io/valhalla', // własny Valhalla (puste = tylko publiczny OSRM)

  // Overpass: fotoradary i odcinkowe pomiary z OSM.
  overpassUrl: 'https://overpass-api.de/api/interpreter',

  // Ograniczenia prędkości wzdłuż trasy (Valhalla, dane OSM). Docelowo własny serwer.
  ttsUrl: 'https://188-68-247-201.sslip.io/nav-tts',
  limitsUrl: 'https://188-68-247-201.sslip.io/valhalla',

  // Wyszukiwanie adresów (Photon, oparty na OSM).
  geocodeUrl: 'https://photon.komoot.io/api/',

  // Własna warstwa poprawek (wygrywa z OSM).
  localHazardsUrl: './data/hazards.local.json',
  // Pliki budowane codziennie przez GitHub Actions (tools/build-hazards.mjs): cała Polska, bez zapytań na żywo.
  staticOsmUrl: './data/hazards.osm.json',
  staticGitdUrl: './data/hazards.gitd.json',

  // Środek startowy mapy: Lublin.
  center: [22.5684, 51.2465],
  zoom: 12,
};

export const APP_VERSION = '0.7.6';

export const STORAGE = { settings: 'nav.settings', lastDest: 'nav.lastDest' };

export const DEFAULT_SETTINGS = {
  voice: true,
  theme: 'auto', // auto | day | night
  tilt: true,
  travel: 'auto', // auto | pedestrian | bicycle (modes.js)
  hazardsVoice: true,
  ttsEngine: 'system', // system = Zosia (głos telefonu) | ewa = nagrania z własnego serwera (Pocket) | agata = Gemini (nieaktywna)
};

/** Lektorzy do wyboru w ustawieniach. Agata (Gemini) wymaga płatnego klucza: włączymy ją po decyzji. */
export const VOICES = [
  { id: 'system', label: 'Zosia', enabled: true },
  { id: 'ewa', label: 'Ewa', enabled: true },
  { id: 'agata', label: 'Agata', enabled: false },
];

export function loadSettings() {
  try {
    const st = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE.settings) || '{}') };
    // 0.3.4: „Naturalny” wymaga płatnego klucza; do czasu jego włączenia wracamy do głosu telefonu
    if (!st.ttsMigrated034) { st.ttsMigrated034 = true; if (st.ttsEngine === 'cloud') st.ttsEngine = 'system'; }
    if (!VOICES.some((v) => v.id === st.ttsEngine && v.enabled)) st.ttsEngine = 'system'; // stare ustawienia („Naturalny”, „Wbudowany”) i głosy niedostępne
    return st;
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
