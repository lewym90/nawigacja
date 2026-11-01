// Service worker: powłoka aplikacji działa bez sieci. Kafelki i dane tras idą przez sieć.
const VERSION = 'nav-v0.7.10';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css',
  './js/app.js', './js/config.js', './js/geo.js', './js/routing.js', './js/guidance.js',
  './js/hazards.js', './js/speech-pl.js', './js/speed.js', './js/places.js', './js/limits.js', './js/compass.js', './js/modes.js', './js/hazard-data.js', './js/valhalla.js', './js/provider.js', './js/voice.js', './js/sim.js', './js/mapstyle.js', './js/icons.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // usługi zewnętrzne: zawsze sieć
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
