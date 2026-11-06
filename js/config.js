// Adresy usług. Wszystko, co zewnętrzne, jest tutaj, żeby podmienić na własny serwer
// (lewym90) jednym plikiem. Domyślne wartości to publiczne, darmowe usługi oparte na
// OpenStreetMap: do prototypu i użytku własnego, nie do dużego ruchu.

export const CONFIG = {
  cityBaseNew: './city/nowy/', // próbka nowego wyglądu: BDOT10k + modele 3D
  cityBase: './city/lublin/', // własne kafle 3D (tools/build-city.py)
  ortoUrl: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Raster&STYLES=&FORMAT=image/jpeg&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512',
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
  trafficUrl: 'https://188-68-247-201.sslip.io/traffic', // ruch drogowy (server/nav-traffic.py)
  fixesUrl: 'https://188-68-247-201.sslip.io/fixes', // wspólna baza poprawek tras (server/nav-fixes.py)
  fuelUrl: './data/fuel.osm.json', // stacje paliw z OSM (bot)
  roadPointsUrl: './data/roadpoints.osm.json', // przejazdy kolejowe, progi, szkoły (bot, OSM)
  // Pliki budowane codziennie przez GitHub Actions (tools/build-hazards.mjs): cała Polska, bez zapytań na żywo.
  staticOsmUrl: './data/hazards.osm.json',
  staticGitdUrl: './data/hazards.gitd.json',

  // Środek startowy mapy: Lublin.
  center: [22.5684, 51.2465],
  zoom: 12,
};

export const APP_VERSION = '0.20.2';

export const STORAGE = { settings: 'nav.settings', lastDest: 'nav.lastDest' };

export const DEFAULT_SETTINGS = {
  cameraProfile: 'dynamic',
  quality: 'high',
  voice: true,
  theme: 'auto', // auto | day | night
  tilt: true,
  travel: 'auto', // auto | pedestrian | bicycle (modes.js)
  routePref: 'balanced', // samochód: fast | balanced | short (valhalla.js ROUTE_PREFS)
  hazardsVoice: true,
  newLook: false, // próbka nowego wyglądu (Lublin)
  ortho: false, // zdjęcia lotnicze pod mapą
  routeColor: false, // jednolita wstęga z projektu; kolor limitu można włączyć w ustawieniach
  roadAlerts: true, // zakręty z zalecaną prędkością, przejazdy kolejowe, progi, szkoły // trasa kolorowana limitem prędkości
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
    if (!st.look110) { st.look110 = true; st.ortho = false; } // zdjęcia z góry rozmazują się przy niskim widoku
    if (!st.look100) { st.look100 = true; st.routeColor = false; } // nowa szata: wstęga w jednym kolorze także u dotychczasowych użytkowników
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
