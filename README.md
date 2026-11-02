# Nawigacja

> **Pełny, aktualny opis stanu prac, zasad współpracy i planu: [KONTYNUACJA.md](KONTYNUACJA.md).** Poniżej stary opis prototypu.

PWA: mapa, trasy z alternatywami, prowadzenie głosowe po polsku, ostrzeżenia o fotoradarach,
odcinkowy pomiar prędkości (własne liczenie średniej), zgłoszenia kierowców, symulacja jazdy.
Czysty JavaScript bez budowania, wszystko serwuje się statycznie (GitHub Pages).

## Publikacja na GitHub Pages
1. Utwórz repozytorium (np. `lewym90/nawigacja`), wgraj całą zawartość tego folderu (bez `node_modules`).
2. Settings, Pages, Source: branch `main`, folder `/ (root)`.
3. Adres: `https://lewym90.github.io/nawigacja/`. Na iPhonie: Safari, Udostępnij, Do ekranu początkowego.

## Uruchomienie lokalne i testy
- `npm install` (tylko do testów i aktualizacji MapLibre), `python3 -m http.server`, otwórz `http://localhost:8000`.
- `npm test`: 34 testy logiki (geometria, trasy, prowadzenie, ostrzeżenia, odcinkowy pomiar).
- `python3 test/browser/run.py <katalog>`: test w przeglądarce z podstawionymi usługami i zrzutami ekranu (Playwright).

## Usługi zewnętrzne (js/config.js)
Domyślnie publiczne, darmowe usługi oparte na OpenStreetMap, tylko do prototypu i użytku własnego:
kafelki OpenFreeMap, trasy router.project-osrm.org (demo OSRM), fotoradary Overpass, adresy Photon.
Docelowo wszystko przenosimy na własny serwer (kafelki PMTiles, Valhalla/OSRM, własna baza ostrzeżeń).

## Własna warstwa poprawek
`data/hazards.local.json`: wpisy wygrywają z OSM po tym samym `id`, `suppress` wycisza błędne wpisy OSM.

## Znane ograniczenia
- iOS wstrzymuje GPS i dźwięk, gdy ekran jest zgaszony lub aplikacja w tle. Aplikacja prosi o blokadę wygaszania ekranu.
- Ostrzeżenia pochodzą z baz danych, nie z wykrywania urządzeń pomiarowych.
- Zgłoszenia kierowców są na razie tylko lokalne (bez serwera, bez wspólnej bazy).
