// Service worker: powłoka aplikacji działa bez sieci. Kafelki i dane tras idą przez sieć.
const VERSION = 'nav-v0.27.0';
const ORTO = 'nav-orto'; // zdjęcia lotnicze: wspólne dla wersji aplikacji, najstarsze wypadają
const ORTO_MAX = 900;
const CITY = 'nav-city-4'; // kafle miasta: stałe między wersjami aplikacji, zmiana nazwy po przebudowie danych
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css',
  './js/app.js', './js/config.js', './js/geo.js', './js/routing.js', './js/guidance.js',
  './js/hazards.js', './js/speech-pl.js', './js/speed.js', './js/places.js', './js/limits.js', './js/compass.js', './js/modes.js', './js/hazard-data.js', './js/valhalla.js', './js/provider.js', './js/cockpit.js', './js/camera.js',
  './js/profiles.js',
  './js/snap.js',
  './js/solid.js',
  './js/facade-size.js', './js/facades.js', './js/facade-list.js', './js/orto.js', './js/city3d.js', './js/lanes.js', './js/traffic.js', './js/roadwise.js',
  './js/fixes.js', './js/fuel.js', './js/trip.js', './js/explain.js', './js/voice.js', './js/sim.js', './js/mapstyle.js', './js/icons.js',
  './icons/favicon-64.png', './icons/city-atlas-day.webp', './icons/city-atlas-night.webp', './icons/city-roofs.webp', './icons/city-trees.webp', './icons/city2-atlas-day.webp', './icons/city2-atlas-night.webp', './icons/city2-roofs.webp', './icons/city2-trees.webp', './icons/tx2-asphalt.webp', './icons/tx2-pave.webp', './icons/tx2-grass.webp', './icons/tx-grass.webp', './icons/tx-pave.webp', './icons/tx-asphalt.webp', ...Object.entries({"block": 3, "house": 3, "office": 3, "tenement": 3}).flatMap(([k, n]) => [...Array(n).keys()].flatMap((i) => ['day', 'night'].map((t) => `./icons/fa/${k}-${i}-${t}.webp`))), './icons/sky-day.webp', './icons/sky-night.webp', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== ORTO && k !== CITY).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'mapy.geoportal.gov.pl') {
    e.respondWith(caches.open(ORTO).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { c.put(req, r.clone()); c.keys().then((k) => { for (const old of k.slice(0, Math.max(0, k.length - ORTO_MAX))) c.delete(old); }); }
      return r;
    }))));
    return;
  }
  if (url.origin !== location.origin) return; // usługi zewnętrzne: zawsze sieć
  if (/\/city\/.+\.(bin|webp)$/.test(url.pathname)) {
    e.respondWith(caches.open(CITY).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  // Własna warstwa poprawek: najpierw sieć (świeże dane), w razie braku sieci kopia.
  if (/\/data\/hazards\.[a-z]+\.json$/.test(url.pathname)) {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(VERSION).then((x) => x.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  // Reszta: z pamięci podręcznej, a w tle odświeżenie.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((x) => x.put(req, c)); } return r; }).catch(() => hit);
      return hit || net;
    })
  );
});
