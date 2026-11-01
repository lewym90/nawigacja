# Lokalne testy tras na prawdziwych danych

Valhalla w Pythonie (`pip install pyvalhalla`, ta sama wersja co na serwerze) + dane z release `valhalla-pl`
(valhalla_tiles.tar po sklejeniu części, admins.sqlite, timezones.sqlite, valhalla.json).
`local.json` = valhalla.json z podmienionymi ścieżkami (tile_extract, admin, timezone).

- `r.py` – Actor na lokalnych danych, `an.py` – dekoder shape i pomocnicze `show()`.
- `snap.py` – ten sam dobór punktu wejścia do sieci co w js/valhalla.js (snapEnds) – do porównań.
- `sweep6.py` – 60 punktów startowych wokół domu, długość trasy i liczba objazdów >1.3x prosto.

Wnioski z 01.11.2026: sam parametr `radius` w Valhalli NIE wybiera najlepszej drogi (zostaje przy najbliższej),
koszty (driveway/alley) w tym miejscu nic nie zmieniają; pomógł dopiero własny dobór: locate (30 m, 8 dróg)
+ sources_to_targets + dojście 1,3 m/s. Średnia trasa 717 -> 641 m, objazdy >1.3x: 12 -> 0 (z 60).
