# KONTYNUACJA: nawigacja (lewym90/nawigacja), stan na 2026-11-04, wersja 0.24.2

Ten plik jest kompletnym przekazaniem pracy. Ma wystarczyć, żeby nowa sesja Claude (inne konto, bez dostępu do poprzedniej rozmowy i do Projektu „APLIKACJE”) mogła kontynuować bez zadawania pytań, które już padły. Czytaj całość, zanim cokolwiek zmienisz.

> **Instrukcja startowa dla Claude (wykonaj po przeczytaniu):**
> 1. Sklonuj repozytorium (patrz sekcja 1) i uruchom `npm install && npm test` (oczekiwane: 138 testów zielonych).
> 2. Napisz właścicielowi jedno zdanie po polsku, że przejąłeś pracę, i że czekasz na jego uwagi do wersji 0.10.0 (patrz sekcja 9, punkt A). Nie pytaj o rzeczy opisane tutaj.
> 3. Pracuj według sekcji 8 (zasady współpracy) i 9 (co dalej).

---

## 0. Kim jest właściciel i jak z nim pracować

- Właściciel: GitHub `lewym90`. Pisze po polsku, krótko i potocznie. Jest kierowcą-testerem: testuje aplikację na iPhonie, w aucie, podczas jazdy, i przysyła zrzuty ekranu.
- Lubi działanie: „Działaj”, „Zróbmy”. Nie chce pytań, na które da się odpowiedzieć rozsądnym domyślnym wyborem. Pyta o zdanie tylko tam, gdzie decyzja jest jego (np. wybór kolejnego kierunku).
- **Nie akceptuje błędów ani pustych obietnic.** Dwukrotnie złapał mnie na tym, że zapowiedziałem efekt („niebo, światło, kamera patrząca w zakręt, kokpit niepodobny do Map Google”), a na jego telefonie go nie było, bo testowałem tylko na pustej mapie. Wniosek: **przed napisaniem „zrobione” obejrzyj wynik na zrzucie** (sekcja 6: `test/browser/look.py` na sztucznym mieście) i weryfikuj liczbami (sekcja 6: lokalna Valhalla).
- Oczekuje krótkich, uczciwych komunikatów: co zrobione, co sprawdzone, czego nie udało się sprawdzić. Gdy praca trwa długo, wysyłaj krótkie statusy.
- Komendy dla niego na serwer: **jedna linia do wklejenia**, z SHA commita (patrz sekcja 5).
- Mail z GitHub „Run failed” traktuje jak błąd aplikacji. Nie dopuszczaj do czerwonych przebiegów workflow (sekcja 7).

## 1. Dostęp i uruchomienie

- Repozytorium: `github.com/lewym90/nawigacja` (publiczne, gałąź `main`). Strona: `https://lewym90.github.io/nawigacja/` (GitHub Pages, workflow „Wdrożenie strony”).
- Nowa sesja musi dostać dostęp do repo (w Claude Code: dodać repozytorium `lewym90/nawigacja` z uprawnieniem do zapisu, żeby można było `git push`). Bez zapisu nie da się wdrażać.
- Klon i testy:
  ```
  git clone https://github.com/lewym90/nawigacja.git /tmp/navclone && cd /tmp/navclone
  npm install && npm test          # 138 testów
  python3 -m unittest server/test_nav_fixes.py   # 8 testów serwisu poprawek
  ```
- Test w przeglądarce (Playwright, Chromium jest w środowisku): `python3 test/browser/run.py` (podstawione usługi, 0 błędów konsoli, trwa ok. 2 min, nie uruchamiaj dwóch naraz; w narzędziu z limitem czasu odpalaj w tle).
- Commity: dopisuj na końcu linię `Co-Authored-By` i `Claude-Session` zgodnie z instrukcją środowiska. Przed `git push` zawsze `git pull --rebase origin main` (bot danych też pushuje).
- Nowy plik JS: dopisz do `SHELL` w `sw.js`. Każde wdrożenie: podbij `APP_VERSION` w `js/config.js` i nazwę cache `nav-vX.Y.Z` w `sw.js` (inaczej iPhone trzyma starą wersję).
- `gh` w środowisku nie obsługuje GraphQL (np. `gh release list` zwraca 403); używaj `gh api repos/lewym90/nawigacja/...` (REST).

## 2. Czym jest produkt

PWA do nawigacji samochodowej (a także pieszej i rowerowej) po Polsce, po polsku, na własnych danych otwartych (OSM, GITD), bez kopiowania Google/TomTom/HERE. Czysty JavaScript bez budowania, MapLibre GL 5.24 lokalnie w `vendor/`. Działa na iPhonie dodany do ekranu początkowego.

Ambicja właściciela (cytat z jego prośby): aplikacja ma „bić konkurencję na głowę”, mieć „efekty wow”, nie wyglądać jak kopia Map Google, i mieć funkcje, których konkurencja nie ma. Ustalone zakłady (5 sztuk): 1. Droga, która się uczy, 2. Inteligencja drogi, 3. Kokpit (tożsamość wizualna), 4. Dlaczego ta trasa + stacje paliw z realnym kosztem objazdu, 5. Pamiątka z podróży. Wszystkie 5 jest zaimplementowane (wersje 0.8.0–0.9.0), ale **ocena wizualna kokpitu przez właściciela jeszcze trwa** (patrz sekcja 9A).

### Zasady produktowe od właściciela (nie łamać)
- Trasa ma być LOGICZNA: bez objazdów wokół bloków, bez prowadzenia tam, gdzie nie wolno jechać. Błędy tras są niedopuszczalne, weryfikuj liczbami.
- Trasy dalekie: żadnych dróg serwisowych ani gruntowych w środku trasy. Przy końcach trasy, na wsi lub przy trasie głównej: dopuszczalne.
- Wybór rodzaju trasy: Najszybsza / Zrównoważona (domyślna) / Najkrótsza, bo „najkrótsza i najszybsza to nie to samo”.
- Po zjechaniu z trasy: jak najszybsze przeliczenie nowej trasy od miejsca, w którym jest kierowca, do celu, zgodnie z przyjętymi zasadami.
- Motyw jasny/ciemny oraz głos (i inne ustawienia) zmieniane **w trakcie jazdy**, bez kończenia nawigacji (panel „Szybkie ustawienia”, przycisk FAB).
- Pieszo: schody i przejścia zapowiadane, 3D we wszystkich trybach, trasa bez zakosów.
- Ostrzeżenia pochodzą z baz danych (OSM, GITD, własne poprawki), **nie** wykrywamy sygnałów urządzeń policji. ODbL: podpis OSM zwinięty do ikony „i” + pełny tekst w menu.
- Głos: zapowiedź po manewrze, przypomnienie na długich odcinkach, „Skręć w lewo” tuż przed manewrem; nazwy ulic w bierniku, liczby słownie (`js/speech-pl.js`); „Ruszaj” przy Start (gest odblokowuje mowę na iPhonie).

## 3. Mapa repozytorium

```
index.html, css/app.css, sw.js, manifest.webmanifest, icons/, vendor/ (MapLibre)
js/app.js        – całe UI i logika sesji (ok. 1450 linii): mapa, nawigacja (startNav/navTick/reroute/endNav), warstwy trasy,
                   przełączniki (SWITCHES, data-sw/data-seg), szybkie ustawienia, poprawki, stacje, pamiątka
js/config.js     – adresy usług (CONFIG), APP_VERSION, ustawienia domyślne, VOICES
js/valhalla.js   – adapter Valhalli: zapytania, preferencje (use_distance), unikanie dróg gruntowych/serwisowych, snap pieszo/rower,
                   punkty pośrednie (zawracanie w punkcie, bez fałszywego „cel”), fixExclude
js/provider.js   – własna Valhalla, zapasowo publiczny OSRM (pieszo/rower bez zapasowego)
js/routing.js    – parseRoutes/parseRoute, instrukcje po polsku, limity wzdłuż trasy
js/guidance.js   – śledzenie postępu, offRoute (offCount lub wrongCount), zapowiedzi
js/cockpit.js    – czyste funkcje wyglądu: słońce, atmosfera (niebo/światło), kolor trasy wg limitu (line-gradient), strzałka na jezdni,
                   kamera patrząca w zakręt (lookAheadBearing), pierścień prędkościomierza
js/roadwise.js   – zakręty z zalecaną prędkością (z geometrii), przejazdy kolejowe, progi, szkoły (OSM), RoadWatch
js/fixes.js      – FixStore: poprawki kierowców („unikaj tej drogi” / „tu można jechać”), lokalnie + wspólna baza
js/fuel.js       – stacje paliw z OSM, kandydaci przy trasie, koszt objazdu przez macierz Valhalli
js/explain.js    – „Dlaczego ta trasa”
js/trip.js       – pamiątka z podróży: zapis śladu, statystyki, kolor wg prędkości, klatki przelotu, plakat
js/mapstyle.js   – własny styl mapy (OpenMapTiles), palety day/night
js/modes.js      – tryby auto/pieszo/rower (costing, pitch, zoom, camPitch zależne od prędkości)
js/hazards.js, hazard-data.js, limits.js, speed.js, sim.js, voice.js, speech-pl.js, places.js, compass.js, geo.js, icons.js
data/            – hazards.osm.json, hazards.gitd.json(+report), hazards.local.json (ręczne poprawki, wygrywają po id; `suppress`),
                   roadpoints.osm.json (ok. 2,3 MB: 34 tys. przejazdów, 55 tys. progów, 29 tys. szkół), fuel.osm.json (8721 stacji)
server/          – usługi na serwerze właściciela: nav-tts.py (+install.sh), valhalla (install-valhalla.sh, valhalla.caddy),
                   nav-fixes.py (+test_nav_fixes.py, nav-fixes.caddy, install-fixes.sh), skrypty diagnostyczne (find-stairs, dump-route, ...)
tools/           – build-hazards.mjs, build-roadpoints.mjs, build-fuel.mjs (uruchamia bot), valhalla-local/ (testy na prawdziwych danych)
test/            – testy Node (`node --test`), test/browser/run.py (pełny test), look.py + synthcity.py (OGLĄDANIE wyglądu)
.github/workflows/ – pages.yml (wdrożenie), hazards.yml (bot danych, noc 03:17 UTC + ręcznie), valhalla-data.yml (dane Valhalli, raz w miesiącu)
```

## 4. Funkcje i stan (historia wersji)

- **0.1–0.6:** podstawy: mapa, trasy z alternatywami, prowadzenie głosowe po polsku, fotoradary i odcinkowe pomiary (OSM + GITD + własne), zgłoszenia, symulacja, lektorzy: Zosia (głos telefonu), Ewa (Pocket TTS na serwerze, działa), Agata (Gemini, wyłączona: 10 zapytań/dobę; flaga `enabled` w `VOICES`).
- **0.7.x:** własny silnik Valhalla 3.9.1, tryby podróży (auto/pieszo/rower), schody i przejścia pieszo, snapEnds (dobór punktu wejścia do sieci), `use_distance` 0,6, wybór rodzaju trasy (0.7.9), unikanie dróg gruntowych/serwisowych (0.7.10).
- **0.7.11:** szybkie przeliczanie po zjechaniu z trasy (najpierw zwykła trasa od pozycji z kierunkiem jazdy, potem w tle dopracowanie bez dróg serwisowych; wykrywanie: `offCount>=offFixes || wrongCount>=2`).
- **0.8.0 Kokpit v1:** kolor trasy wg limitu prędkości, strzałka na jezdni, pierścień prędkościomierza, panel „Szybkie ustawienia” w jeździe, światło i niebo (setLight/setSky).
- **0.8.1 Inteligencja drogi:** zakręty z zalecaną prędkością, przejazdy kolejowe, progi, szkoły (dane z OSM budowane przez bota).
- **0.8.2 Droga, która się uczy:** poprawki kierowców, serwis `nav-fixes` (sqlite) na serwerze.
- **0.8.3:** „Dlaczego ta trasa”, stacje paliw z kosztem objazdu (minuty i km), „Jedź tam”.
- **0.8.4:** pamiątka z podróży: statystyki, ślad kolorowany prędkością, przelot 3D, plakat PNG, film (MediaRecorder).
- **0.9.0 (obecna):** przebudowa wyglądu kokpitu po krytyce właściciela: kamera 76–79° (widać horyzont i niebo), nowa paleta mapy (dzień chłodny błękit, noc granat ze świecącymi drogami, budynki jaśnieją z wysokością), szklane panele (`--glass`, `--accent`), pływający dolny pasek, wstęga trasy z poświatą i płynącym światłem (warstwa `sel-flow`, animacja `FLOW`), przechył kamery (`roll` do ±9°) w zakrętach, mocniejszy `lookAheadBearing` (ahead 120 m, gain 0,8, max 55°), `maxPitch` 85, tło mapy w kolorze mgły.

- **0.10.0 (obecna):** usunięty „helikopterowy” kokpit 0.9. Nowa kamera `js/camera.js` (`ChaseCam`, pętla `camLoop` w app.js, ok. 30 kl./s): jedzie sama wzdłuż trasy między odczytami GPS, kierunek bierze z geometrii trasy, zoom ciągły, stałe pochylenie 69°, pole widzenia 50° w jeździe, bez `roll`. Usunięta animacja `sel-flow`. Szata z dokumentu wizji (paleta Road Intelligence, zawsze ciemne szkło), panel Przyjazd/Dystans/Czas, drogi w skali metrów z linią środkową, elewacje `js/facades.js` + dachy `building-roof`, panorama nieba `#sky` za przezroczystą mapą (obrazy od właściciela, `tools/build-sky.py <dzień> <noc>`), ikona z projektu (`tools/build-icons.py`), szewrony na odcinku przed autem. Symulacja domyślnie 1× (wcześniej 4×, co wyolbrzymiało ruch). Kolor trasy wg limitu domyślnie wyłączony (przełącznik został).

- **0.11.0:** zdjęcia lotnicze Geoportalu pod mapą (warstwy `orto-base` + `orto`, WMS HighResolution, `js/orto.js` pobiera je zawczasu wzdłuż trasy, sw.js trzyma do 900 kafli w `nav-orto`, przełącznik `ortho`). Usługa daje 1–10 s na kafel: docelowo cache na własnym serwerze. Elewacje ze zdjęć: `assets/facades/<house|tenement|block|office>-<n>.png` + `python3 tools/build-facades.py` (robi też noc i `js/facade-list.js`); po dodaniu nowych dopisz je do SHELL w sw.js.

- **0.13.0 (obecna):** własna mapa 3D Lublina wdrożona: tekstury `assets/textures` -> `tools/build-textures.py`, drzewa `tools/build-trees.py` (lasy, parki, ulice z kafli OpenFreeMap, omija budynki i jezdnie), kafle gzip w `city/lublin` (rozpakowuje DecompressionStream), sw.js trzyma je w `nav-city-1`.
- **0.13.1:** asystent pasów `js/lanes.js` (Valhalla `turn_lanes`), drogowskaz z `kierunek:` w opisie manewru, nocą jaśniejszy asfalt i krawędzie jezdni (`road-edge-*`), panele z przyklejonym tytułem, „canceled” głosu to nie błąd.
- **0.14.0:** ruch drogowy: `server/nav-traffic.py` (pośrednik do TomTom Routing, klucz tylko w /etc/nav-traffic.env, cache 120 s, limit 18 000/mies., port 18789, `/traffic`), `js/traffic.js`. Podgląd: czas z korkami, godzina wyjazdu. Jazda: co 3 min ETA i korki na trasie, przy opóźnieniu ≥4 min propozycja szybszej trasy (zysk ≥3 min i 8%). Usługa zainstalowana na serwerze 2026-11-04, działa. `delay` to opóźnienie względem typowego ruchu; `magnitudeOfDelay` 4 to roboty/zamknięcia, nie korek. Warunki TomTom do przeczytania przez właściciela (strona ładowana skryptem, nie dało się jej odczytać).
- **0.15.0:** prowadzenie: fork z aktywnymi pasami prosto = „Jedź prosto”, nazwa ulicy z begin_street_names lub dalszego ciągu drogi, porada głosowa o pasach tylko przy skręcie zgodnym ze stroną pasów, pasy przy każdym mijanym skrzyżowaniu z `trace_route` format osrm (`N.junctions`, panel do 250 m przed skrzyżowaniem), linie pasów na trasie z `trace_attributes` (`edge.lane_count`, tylko trasa, reszta dróg nie ma tych danych w OpenMapTiles). API OSM (api.openstreetmap.org) jest osiągalne z sandboxa, Overpass nie.
- **0.15.1:** wstęga przechodzi na właściwe pasy przed skrzyżowaniem (`laneTarget`, warstwy `target-bg`, `target-lane`, długość dojazdu z `approachOf`).
- **0.16.0:** pole Skąd (`S.from`, `S.pickFrom`, `syncFrom`), zamiana ⇅, inny start służy do sprawdzania trasy: Start przelicza od GPS, Symulacja jedzie od wybranego adresu.
- **0.17.0:** sprzątanie. Usunięte płyty jezdni i podświetlenie pasów (`laneTarget`), linie pasów tylko na odcinkach ≥70 m, panel pasów z podpisem przy mijanym skrzyżowaniu, mgła błękitna. `tools/road-context.py` + filtr w `build-city.py` (bryły na jezdni bez budynku w OSM), `build-trees.py` omija wszystkie jezdnie także na granicach kafli. Właściciel odrzucił konto Apple i płatne usługi: rozwijamy własny silnik za darmo.
- **0.18.0:** próbka nowego wyglądu za przełącznikiem `newLook` (`?nowy=1`, ustawienia): teren z BDOT10k (`tools/build-bdot.py`, `city/nowy/ground.json`), budynki z funkcją BDOT i nowsze budynki (`build-city.py` z 4. argumentem), drzewa z danych (`build-trees-real.py`), płaskie cienie w `city3d.js`, smukła wstęga, bez napisów na jezdni w jeździe. BDOT powiatu: `https://opendata.geoportal.gov.pl/bdot10k/schemat2021/06/0663_GML.zip`. Porównania: `test/browser/shot.py`.
- **0.19.0 (przełącznik newLook):** własny render: `tools/build-roads.py` (BDOT SKJZ/SKRP: `.r.bin`, jezdnie, krawężniki, chodniki, linie), `tools/build-shadows.py` (`.s.webp`, gotowe cienie), `CityGround` + wstęga-siatka w `city3d.js` (`setRoute`, ghost przez GREATER, przepływ w shaderze), korytarz kamery `cut()` usuwa zasłaniające fragmenty, `fitSky` trzyma niebo na horyzoncie. Czeka: atlasy po grafikach właściciela (drzewa, elewacje wg funkcji), modele ważnych obiektów, własne kafle poza Lublinem.
- **0.20.0:** `js/profiles.js`: kamera Klasyczna/Dynamiczna/Filmowa i jakość Ultra/Wysoka/Eko w szybkich ustawieniach, tylko w nowym wyglądzie; działają bez przeładowania. `real.py` przyjmuje env SETTINGS (JSON) i QUICK.
- **0.21.0:** kamera „Z bliska” (`CLOSE_CAM` w `profiles.js`: 10 m wysoko, 24 m za autem) zamiast Filmowej; można ją wybrać na stałe, a w Klasycznej i Dynamicznej włącza się sama 100 m przed manewrem (albo 5 s przy dużej prędkości) i gdy `City3D.sightBlocked` wykryje budynek na linii wzroku, wraca 100 m dalej (`closeUntil`, `closeTick`). Szerokość wstęgi jest uniformem `u_wid`, wstęga zaczyna się przy pucku (`cam.lag`).
- **0.22.0:** `js/snap.js`: jeden tor dla auta, kamery i wstęgi, dopasowany do osi BDOT (`city/nowy/axes.bin`) z prawym pasem na drogach dwukierunkowych; `cam.path` i `setRoute(path)`. `build-roads.py` dzieli asfalt na główne, zbiorcze/lokalne i małe uliczki (rodzaje 2, 5, 6), małe bez linii. Korek jest kolorem wstęgi (`u_jam`), warstwa `jam-line` wyłączona na własnej mapie. Warstwa `street-name` pomija bieżącą ulicę, `turn-chip` stoi nad skrętem. Czeka: sygnalizacja, przejścia, linie zatrzymania (dane spoza BDOT).
- **0.23.0:** `snap.js` jedzie prawym pasem (`laneOffset`), 250 m przed skrętem w lewo lewym; przez skrzyżowanie łuk `arc`. Podwójna jezdnia = równoległa oś tej samej ulicy (nazwy w `axes.bin`). Warstwa `street-name` usunięta: tabliczki `cross-chip` z `crossings()`, po dwie naraz. Kamera dojeżdża do auta przy ścianie (`closeDist`, `S.tight`), na torze bez opóźnienia środka.
- **0.24.0:** `js/solid.js`: wstęga jako bryła (przekrój 2,6 × 0,3 m), odcinki kończą się grotem 16 m za skrętem (`segments`), grot stoi pionowo (`style:'up'`, wybór właściciela) i podnosi się między 120 a 80 m przed skrętem (`u_heads`, `a_off0`). Znacznik auta to bryła `puckMesh` rysowana w `drawPuck` (HTML puck ukryty klasą `solid`). Tor przez skrzyżowanie po grafie osi (`AxisIndex.route`, `followAxes`).
- **0.24.2:** `contain()` w `snap.js` trzyma każdy punkt toru co najmniej 1 m od krawędzi jezdni z osi BDOT (auto nie jedzie po trawniku); na początku i końcu trasy tor trzyma przesunięcie z najbliższej jezdni. Wstęga ucięta równo pod autem (`discard v_l<u_from`) i zamknięta denkiem (`capAt`, co klatkę), bez zwężania. Właściciel: wygląd wstęgi i grotów zostaje bez zmian.
- **Test jezdni (obowiązkowy po każdej zmianie toru):** dla każdej trasy z `test/browser/routes.txt` (pierwsza to Granata 1 → Północna 3, dom → praca właściciela): `ROUTE_FROM=... ROUTE_TO=... NOWY=1 NOCARDS=1 DUMP=x.json python3 test/browser/real.py out day 2`, potem `python3 test/browser/road.py x.json` musi dać 0 metrów poza jezdnią. Sprawdza auto i oba brzegi wstęgi względem trójkątów jezdni z `.r.bin`. `contain()` trzyma tor 1,6 m od krawędzi, a `roadFill()` kładzie własny asfalt tam, gdzie trasa jedzie drogą, której nie ma w BDOT.
- **0.25.0:** tor z `matchPath()` w `snap.js`: kotwice co 20 m przypięte do osi BDOT, między nimi najkrótsza droga po grafie osi (`between`), prawy pas (`laneOffset`), narożniki `fillet` 7 m; gdzie trasy nie ma w BDOT, zostaje linia trasy. `roadFill` kładzie asfalt tylko tam, gdzie sama trasa jest poza jezdnią BDOT. Skręty bliżej niż 80 m łączą się w jedną strzałkę (`segments`, `RIB.merge`), grot wstaje licząc od pierwszego skrętu serii (`u_leads`). `test/browser/road.py` sprawdza też odjazd toru od trasy (>12 m). Właściciel zatwierdził wygląd wstęgi i grotu (skręt wstęgi do pionu przed grotem zostaje).
- **0.26.0:** grafiki właściciela w `assets/owner`, `tools/build-owner.py` robi `icons/city2-*.webp` i `tx2-*.webp` (tylko nowy wygląd; stary dalej `city-*`). Elewacje: atlas 4x6, wiersz wg funkcji budynku z BDOT (`facade_row` w build-city.py), u/v ścian w metrach, rozmiar powtórzenia w `js/facade-size.js`. Drzewa: 8 gatunków, wybór w shaderze. Drogi: wygląd wg szerokości (dwukierunkowe od 5,5 m z linią środkową), zebry z OSM (`crossing.json`), parkingi z OSM jako rodzaj 7; Overpass działa z `maps.mail.ru/osm/tools/overpass` (z przerwami, ponawiać). Osiedla i zabudowa w `ground.json` mają trawę `tx2-grass`.
- **0.26.1:** `road.py` sprawdza też zygzaki (tor skręca >22° na 16 m, a trasa prosto). `snap.js`: kotwice tylko na jezdni do 20° od kierunku trasy, pojedyncza kotwica w luce odrzucana, przy drodze dwujezdniowej kara za jezdnię po lewej, pas zmienia się na 30 m, `straighten` na prostych, `blendGaps` przy przejściu na drogę spoza BDOT, `contain` tylko w kierunku jazdy i z wagą. Skrypt wszystkich tras: zaczyna od `npm test` i kasuje stare zrzuty.
- **0.27.0:** `.r.bin` ma dwa nowe bloki: krawężniki [x,y,z,s,nx,ny] (bok 15 cm i cień na jezdni) i obiekty [x,y,rodzaj,kierunek] (0 latarnia: OSM + co 35 m przy głównych i zbiorczych; 1 sygnalizator z OSM, po jednym na kierunek). Chodnik i krawężnik podniesione w VS_ROAD. Modele właściciela: `assets/models/*.glb` -> `tools/build-models.py` -> `city/models/*.bin` + `tex.webp` (tekstura tablicowa), `drawModels` w city3d.js; drzewa do 260 m jako modele, dalej skrzyżowane płaszczyzny, cień drzew w `renderGround`. Brzoza: model z gęstą koroną (0.27.1). Znaki ograniczeń (0.28.0): `speedSigns()` w snap.js stawia model `znak` przy każdej zmianie limitu trasy po prawej stronie, cyfry z atlasu canvas (VS_NUM). Tabliczki przecznic wyłączone na życzenie właściciela (myliły). Krawężnik 25 cm (celowo wyżej niż w rzeczywistości), pas krawężnika 0,4 m. Overpass: sygnalizatory i latarnie tak jak przejścia.
- **0.29.0 (wygląd):** wspólne oświetlenie `ENV` w city3d.js (`envLight`: niebo + odbicie od ziemi + słońce, `tonemap` ACES) dla ścian, dachów, modeli, drzew i jezdni w dzień; filtrowanie anizotropowe 16x; przekrój wstęgi 15 punktów (superelipsa, `PN` w solid.js), szklany połysk (Fresnel, odbicie nieba). `js/bloom.js`: poświata tylko na Ultra (kopia klatki w 1/3 rozdzielczości, próg jasności, rozmycie, przezroczysta nakładka). Właściciel zgodził się na lekki post-processing tylko na Ultra do porównania płynności.
- **0.30.0 (silnik Three.js, próba za przełącznikiem):** właściciel zgodził się na osobną scenę Three.js w jeździe (odstępstwo od „jednej sceny MapLibre”). `js/nav3d.js` (klasa `Nav3D`): własne płótno nad mapą, kamera brana z macierzy mapy w warstwie `nav3d-sync` (rozkład na sztywny widok + perspektywę z przesunięciem środka, `syncCamera`), więc obraz zgadza się z mapą co do piksela. Rysuje wszystko: ziemię z `city/nowy/ground.json` (trawa, las, pole, place, woda; trawa pod spodem do horyzontu), jezdnie/chodniki/linie/krawężniki z `.r.bin`, budynki z atlasem elewacji i dachów (ten sam format `.bin`), drzewa/latarnie/sygnalizatory/znaki jako instancje modeli z `city/models`, wstęgę i znacznik w shaderach z city3d.js (eksportowane; kolor odwracany funkcją `untone`, bo obraz idzie przez obróbkę Neutral). Prawdziwe cienie słońca (słońce z przodu z prawej względem kursu, powoli się obraca), GTAO na Wysoka/Ultra, poświata na Ultra, mgła, kopuła nieba z panoramy właściciela, odbicia z tej panoramy. Tekstury właściciela: `assets/owner/tex3/*.png` -> `tools/build-tex3.py` -> `icons/t3-*.webp` (+ `-n` mapy nierówności liczone z jasności). City3D dalej liczy trasę, kafle dla kamery i przeszkód (`hidden=true` wyłącza tylko jego rysowanie). Włączanie: przełącznik „Silnik 3D Three.js (próba)” w menu (tylko w nowym wyglądzie) albo `?three`. Three.js 0.169.0 w `vendor/three` + importmap w index.html, moduł wczytywany dopiero, gdy przełącznik jest włączony. Test: `real.py` przyjmuje `JS` (wyrażenie do wykonania, wynik + zrzut `-js.png`) i `ERRS=1`.
- **Własna mapa, szczegóły:** własny silnik miasta `js/city3d.js` (warstwa WebGL2 w MapLibre) + `tools/build-city.py` z modeli GUGiK LoD2 (Lublin: TERYT 0663, `https://integracja.gugik.gov.pl/Budynki3D/pobierz.php?plik=powiaty/0663_gml.zip`, 35 602 budynki, 76 MB kafli), atlas `tools/build-atlas.py`. Kamera zoom 18,6–17,6, pochylenie 73°, zdjęcia lotnicze domyślnie wyłączone (rozmazane i wolne). Do zrobienia: test płynności na iPhonie, kolejne powiaty (LoD2 tam gdzie jest, LoD1 reszta), drogi i ziemia na własnych kaflach.

### Kluczowe szczegóły działania (żeby nie odkrywać na nowo)
- **Kolor trasy:** `routeGradient` → `line-gradient` (źródło `sel` z `lineMetrics:true`), przejechana część przezroczysta (`paintRoute(consumed)`). Warstwy wstawiane PRZED `building-3d`. Po zmianie motywu `style.load` → `installLayers()` odtwarza warstwy (źródła `sel`, `alt`, `secs`, `arrow`, `fixes`, `trip`).
- **Poprawki kierowców:** własne „unikaj” działa od razu (wykluczenie `exclude_locations` w trasowaniu, zawsze na początku listy, limit 50 punktów po stronie serwera Valhalli), cudze dopiero gdy potwierdziło je co najmniej 2 różnych kierowców (`FIXES.confirmN`). „Tu można jechać” tylko zapisywane i eksportowane do przeglądu w OSM. Serwer gdy niedostępny: aplikacja działa na własnych poprawkach.
- **Punkty pośrednie w trasie:** Valhalla zwraca osobny „leg” z „celem” w środku. `tripToOsrmRoute` usuwa pośredni „cel” i zamienia drugi „start” na „kontynuuj”, więc nie ma fałszywego „dotarłeś do celu”, a zawracanie w punkcie (stacja) zostaje. Typ `through` odrzucony (wymusza jazdę dalej bez zawrócenia, dawał pętle).
- **Koszt objazdu przez stację:** macierz `sources_to_targets` z TYMI SAMYMI `costing_options` (use_distance wg preferencji) co trasa; zmierzona zgodność z trasą przez punkt 3/3 (co do 0,1 min).
- **Pamiątka:** `TripRecorder` zapisuje punkt co ≥12 m lub 20 s, odrzuca `accuracy>60` i teleporty (>90 m/s); po zakończeniu (≥800 m) ekran pamiątki; ostatnia podróż w `localStorage` (`nav.lastTrip`, ≤600 punktów) i w menu „Ostatnia podróż”.
- **Roll kamery:** MapLibre 5.24 wspiera `roll` w `easeTo/jumpTo`; `getRoll()` istnieje.
- **Sim:** `Simulator` (`js/sim.js`) emituje fixy z `sim:true` i `t` w ms symulowanego czasu; w testach przeskakuj `window.__nav.S.sim.along = metry`.
- `window.__nav` (diagnostyka/testy) udostępnia `map`, `S`, `CONFIG`, `onFix`; `window.__trip` pamiątkę.

## 5. Serwer właściciela i wdrażanie usług

Serwer: `188-68-247-201.sslip.io` (Caddy z Let's Encrypt). **Na tym serwerze stoją też inne aplikacje właściciela. Nie ruszaj cudzych plików Caddy** (m.in. `operat.caddy` ustawia CORS `*`). Porty zajęte: 8787, 8792, 18787 (nav-tts), 8002 (Valhalla w dockerze), 18788 (nav-fixes), 18789 (nav-traffic). Własne snippety Caddy dodawaj tylko jako osobny plik z walidacją i wycofaniem przy błędzie (tak robią `install-fixes.sh` i `install-valhalla.sh`).

Usługi nawigacji:
| Ścieżka | Co | Instalacja |
|---|---|---|
| `/valhalla` | Valhalla 3.9.1 (docker `valhalla-scripted`, 127.0.0.1:8002), dane z release `valhalla-pl` | `server/install-valhalla.sh` |
| `/nav-tts` | lektor Ewa (Pocket TTS) | `server/install.sh` |
| `/fixes` | wspólna baza poprawek tras (stdlib Python + sqlite, 127.0.0.1:18788, systemd `nav-fixes`) | `server/install-fixes.sh` |

**Instalacja nav-fixes (jeszcze NIE potwierdzona jako wykonana, zapytaj właściciela lub sprawdź `curl -s https://188-68-247-201.sslip.io/fixes/health`):** komenda w jednej linii, z SHA commita, bo `raw.githubusercontent.com` cache'uje ok. 5 min:
```
curl -fsSL https://raw.githubusercontent.com/lewym90/nawigacja/<SHA>/server/install-fixes.sh | REF=<SHA> bash
```
(użyj SHA aktualnego `main`; poprzednio podany SHA to `7bed319dbc3a5a8d1befcf1551b6d0ce9055c8b6`, też działa, ale nowszy zawiera te same pliki serwera). Skrypt tworzy `/opt/nav-fixes`, `/etc/nav-fixes.env` z losowym tokenem eksportu (token tylko na serwerze, **nie zapisuj go w repo ani w dokumentach**), usługę systemd, snippet Caddy z walidacją i wypisuje adres eksportu. Na serwerze nie używaj venv `(v)`: `/usr/bin/python3`.

API poprawek: `POST /fixes/` `{kind: avoid|ok, mode: auto|pedestrian|bicycle, lat, lng, client}`; `GET /fixes/?bbox=minLng,minLat,maxLng,maxLat&mode=`; `DELETE /fixes/<id>?client=`; `GET /fixes/export?token=`; `/fixes/health`. Limity: 40/kierowca/dobę, 200/IP/dobę, tylko Polska, wygasanie 180 dni, skupiska 30 m (n = liczba różnych kierowców).

Klucz Gemini (Agata) był kiedyś wklejony do czatu: **do unieważnienia/rotacji przez właściciela**; nie używaj go, nie zapisuj żadnych kluczy.

## 6. Narzędzia testowe (to jest to, co pozwala nie zgadywać)

### 6a. Oglądanie wyglądu: `test/browser/look.py` + `synthcity.py` (NOWE, kluczowe)
Sandbox nie ma dostępu do prawdziwych kafelków (`tiles.openfreemap.org` → brak połączenia). `synthcity.py` generuje sztuczne kafelki MVT (schemat OpenMapTiles: siatka ulic, bloki z wysokościami, rzeka z mostem, park, ekspresówka po skosie), a `look.py` uruchamia aplikację z tymi kafelkami, planuje trasę, startuje symulację i robi zrzuty (`day`/`night`):
```
pip install --break-system-packages mapbox-vector-tile shapely
python3 test/browser/look.py /tmp/look day     # i: night
```
Zrzuty: `/tmp/look/<motyw>-2-nav0..4.png` (nav1–4 po przeskoku symulacji tuż przed zakręt, widać przechył kamery). Zawsze obejrzyj zrzut (`Read` na PNG), zanim napiszesz właścicielowi, że wygląd działa. Uwaga: to sztuczne dane; prawdziwy wygląd (kolory budynków, etykiety) oceni dopiero właściciel na telefonie.

### 6a2. Prawdziwy Lublin: `test/browser/real.py`
Prawdziwe kafelki i Valhalla przez proxy, GPS z szumem, pomiar kamery i zrzuty: `python3 test/browser/real.py /tmp/real day 6` (trwa ok. 3 min, w sandboxie ok. 5 kl./s, więc płynność ocenia dopiero telefon).

### 6b. Pełny test: `python3 test/browser/run.py` (podstawione usługi)
Sprawdza m.in. sky/light w trybie nocnym (`#040716`), szybkie ustawienia w jeździe, punkty drogowe, „Dlaczego ta trasa”, pamiątkę (statystyki, przelot 3D, plakat PNG, film mp4), wznowienie po restarcie, 0 błędów konsoli.

### 6c. Lokalna Valhalla na prawdziwych danych (do liczb)
`pip install --break-system-packages pyvalhalla` (3.9.1, ta sama wersja co serwer) + dane z release `valhalla-pl` (assety: `valhalla_tiles.tar.part*` do sklejenia, `valhalla_tiles.sha256`, `valhalla.json`, `admins.sqlite`, `timezones.sqlite`; skrypt `server/install-valhalla.sh` pokazuje jak je pobrać i skleić; ok. 2,3 GB). Konfiguracja: `tools/valhalla-local/local.json.example` (podmień ścieżki `/tmp/vh/...`). Potem:
- `tools/valhalla-local/srv.py` (HTTP nad pyvalhalla na :8765, **z blokadą wątków i aliasem `sources_to_targets`→`matrix`; bez blokady dwa równoległe zapytania wywracają serwer**) uruchamiaj w tle: `(setsid nohup python3 srv.py >/tmp/srv.log 2>&1 &)`. **Nie używaj `pkill -f` ani `pkill python3`**: zabija własną powłokę; zabijaj po PID.
- `e2e-auto.mjs` (unikanie dróg serwisowych na parach tras), `e2e-fixes.mjs` (poprawka omija zaznaczone miejsce: 4/4), `e2e-fuel.mjs` (macierz zgodna z trasą przez stację: 3/3), `audit.py`, `tune-*.py`, `svc-minor-roads.py`.
- Odkrycia, które warto pamiętać: Valhalla przyczepia punkt do NAJBLIŻSZEJ krawędzi (`radius` nie wybiera najlepszej) → własny `snapEnds` pieszo/rower; `use_highways=0` psuje trasy dalekie; opcje `use_tracks`, `service_factor`, `exclude_unpaved` nie usuwają dróg serwisowych → dlatego `trace_attributes` + `exclude_locations` (limity serwera: 50 punktów, 100 wierzchołków poligonu); czasy Valhalli są dłuższe niż OSRM (OSRM optymistyczny).

## 7. GitHub Actions i dane

- **Wdrożenie strony** (`pages.yml`): na każdy push do `main` (poza `test/**`, `tools/**`, `README.md`). Kopiuje `index.html sw.js manifest.webmanifest css js icons vendor data` do `_site`. Przy szybkich pushach GitHub może pominąć wdrożenie: `gh run list`, w razie czego `gh workflow run pages.yml`.
- **Dane o fotoradarach** (`hazards.yml`): TYLKO noc 03:17 UTC + ręcznie (`gh workflow run hazards.yml`). Buduje `hazards.*.json`, `roadpoints.osm.json`, `fuel.osm.json` z Overpass (do 3 prób, 3 serwery lustrzane, sanity-check progów liczności; nieudane pobranie NIE nadpisuje starego pliku). Trwa ok. 15–20 min. Push z `git pull --rebase -X theirs` przy wyścigu. **Wcześniej bot uruchamiał się na każdy push i przegrywał wyścig z moim pushem, co dawało czerwone przebiegi i maile „Run failed”; wyzwalacz `push` usunięto.** Nie przywracaj go.
- **Dane tras** (`valhalla-data.yml`): raz w miesiącu buduje dane Valhalli dla Polski do release `valhalla-pl`.
- Dane z bota trafiają na stronę przy kolejnym wdrożeniu (commit bota uruchamia `pages.yml`).

## 8. Zasady pracy (obowiązują)

1. Zbierz materiał, zbuduj, **zweryfikuj** (testy + zrzut z `look.py` dla zmian wizualnych + liczby z lokalnej Valhalli dla zmian tras), dopiero potem wypchnij i napisz.
2. Nie zapowiadaj efektu, którego nie widziałeś na zrzucie. Gdy czegoś nie dało się sprawdzić (np. prawdziwe kafelki, serwer właściciela), napisz to wprost.
3. Pracuj w `/tmp/navclone`, `git pull --rebase` przed `git push`, version bump (config.js + sw.js), nowy plik JS do `SHELL` w `sw.js`.
4. Dla właściciela: komunikaty po polsku, zwięzłe; komendy na serwer jako jedna linia z SHA.
5. Nie zapisuj w repo haseł, kluczy ani tokenów. Nie dotykaj plików Caddy ani usług innych aplikacji na serwerze.
6. Testy po każdej zmianie: `npm test` (138), przy zmianach UI także `test/browser/run.py` (0 błędów konsoli) i `look.py`.
7. Workflowy: nie dodawaj wyzwalaczy, które mogą wywołać czerwony przebieg (patrz sekcja 7).

## 9. Co dalej (kolejność)

### A. Natychmiast: reakcja na uwagi właściciela do 0.9.0
Właściciel dostał wersję 0.9.0 i został poproszony o zrzuty z jazdy w dzień i w nocy (zakręt i szybsza jazda). Spodziewaj się uwag typu: pochylenie zbyt płaskie (kamera 76–79°, `camPitch` w `js/modes.js`, `camPadding` w `app.js`), kolory mapy, czytelność paneli, wygląd wstęgi trasy. Strój według jego zrzutów, a wizualne zmiany sprawdzaj w `look.py`. Znane uwagi techniczne:
- Zemborzycka: w OSM kilka krótkich odcinków ma `maxspeed=90`, `source:maxspeed=PL:rural`. `cleanLimits` w `limits.js` traktuje takie krótkie 80+ na drogach lokalnych obok limitu miejskiego jak brak danych.
- Domyślne limity gdy brak danych: pomysł 50 (miasto) / 90 (poza miastem), nie wdrożone.
- Etykiety START/KONIEC na mapie nachodzą na siebie.

### B. Do zrobienia po stronie właściciela / do potwierdzenia
- Zainstalować serwis `nav-fixes` na serwerze (komenda w sekcji 5). Do tego czasu poprawki działają tylko lokalnie na telefonie.
- Sprawdzić na żywym serwerze, że zapytania `POST trace_attributes` i `exclude_locations` przechodzą przez Caddy: w aplikacji (diagnostyka trasy) linia „Drogi gruntowe/serwisowe w trasie: …” nie powinna mówić „błąd: …”. Sandbox nie widzi tego serwera, więc nie było to testowane na żywo.
- Rotacja klucza Gemini i decyzja co z lektorką Agatą.

- Fotorealistyczne miasto z Google 3D Tiles odpada: warunki zabraniają nawigacji w czasie rzeczywistym i łączenia z mapą inną niż Google.

### C. Propozycje kolejnych kierunków (właściciel miał wybrać; jeszcze nie wybrał)
1. **Pas ruchu i skrzyżowania:** „trzymaj się lewego pasa”, widok skrzyżowania 3D (dane o pasach w OSM są nierówne: najpierw zmierz pokrycie na trasach).
2. **Planowanie wyjazdu:** „wyjadę o 7:30, dojadę o…” z typowym ruchem (wymaga źródła danych o ruchu: najpierw rozpoznanie).
3. **Tryb pasażera:** link na żywo z pozycją i ETA (bez konta, wygasa po dotarciu).
4. **Mapa offline / własne kafelki:** PMTiles z własnego serwera (niezależność od OpenFreeMap, działanie bez zasięgu).
5. **Test w aucie:** godzina jazdy z uwagami właściciela (czytelność, głośność ostrzeżeń, zakręty).

### D. Starsze otwarte punkty
- Auto: część tras wciąż dłuższa niż potrzeba (np. 15,7 vs 11,6 km przy `use_distance` 0,6): niezbadane (sprawdzić start/koniec i `trace_attributes`).
- Komunikacja miejska (GTFS): potrzebne miasta od właściciela (pytanie bez odpowiedzi).
- Photon (geokodowanie) na własnym serwerze; wspólna baza zgłoszeń kierowców (fotoradary/zdarzenia) analogiczna do poprawek tras.
- Fałszywe alarmy dwukierunkowych odcinków GITD.
- Test schodów pieszo: cel `51.19835,22.54430` omija schody; użyj `51.19367,22.53563` / `51.19385,22.53578`.
- Rozmiar `data/roadpoints.osm.json` (2,3 MB) wpływa na pierwsze ładowanie; w razie skarg: pobierać fragmentami wg obwiedni trasy.

## 10. Pułapki (każda kosztowała już czas)

- **Pusta mapa w teście ≠ wygląd na telefonie.** Używaj `look.py`.
- iPhone trzyma starą wersję PWA: zawsze bump wersji i nazwy cache w `sw.js`; właściciel musi zamknąć aplikację całkiem i otworzyć ponownie.
- iOS wstrzymuje GPS i dźwięk przy zgaszonym ekranie; aplikacja prosi o blokadę wygaszania. Mowa wymaga gestu (stąd „Ruszaj” przy Start).
- `app.js` jest duży: edytuj punktowo (`Edit`); kiedyś plik został ucięty i trzeba było odtwarzać z `git checkout`. Po każdej większej edycji `npm test`.
- Szerokość linii MapLibre w wyrażeniach: `line-width` z `interpolate` po `zoom` musi być najwyższego poziomu; gradient wymaga `lineMetrics:true` na źródle.
- Warstwy trasy zależą od `before = 'building-3d'`; po zmianie motywu wszystko musi przejść przez `installLayers()`.
- Przy `map.easeTo` z `padding` zmienia się położenie horyzontu: horyzont zależy głównie od `pitch` (≥ ok. 75° żeby było widać niebo), potem od `padding.top`.
- `srv.py` (lokalna Valhalla) bez blokady wątków się wywraca; `pkill -f` zabija własną powłokę.
- `gh release list` i inne wywołania GraphQL: 403, używaj `gh api`.
- Nie uruchamiaj dwóch kopii `run.py` naraz (zacinają się na timeoutach).
- Pliki z `/tmp/vh` (dane Valhalli, zrzuty) są ulotne; po nowej sesji trzeba pobrać dane od nowa tylko jeśli potrzebne są liczby z Valhalli.

## 11. Szybka ściąga komend

```
cd /tmp/navclone && git pull --rebase origin main
npm test                                           # 138
python3 test/browser/look.py /tmp/look night       # obejrzyj /tmp/look/night-2-nav*.png
python3 test/browser/run.py                        # pełny test (w tle, ~2 min)
git add -A && git commit -m "…" && git pull --rebase origin main && git push origin main
gh run list --workflow pages.yml --limit 2         # czy wdrożenie przeszło
gh workflow run hazards.yml                        # ręczne odświeżenie danych (15–20 min)
curl -s https://188-68-247-201.sslip.io/fixes/health    # czy serwis poprawek stoi
```

Koniec pliku. Po przeczytaniu i uruchomieniu testów: napisz właścicielowi krótko, że przejąłeś pracę, i przejdź do sekcji 9A.
