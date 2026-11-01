#!/usr/bin/env bash
# Instalacja własnej Valhalli (trasy: auto, pieszo, rower) na serwerze. Uruchom jako root; można ponawiać (aktualizacja danych).
# Dane buduje GitHub Actions (workflow „Dane tras (Valhalla, Polska)”) i wystawia w wydaniu valhalla-pl.
set -e
REPO=lewym90/nawigacja
BASE=https://github.com/$REPO/releases/download/valhalla-pl
D=/opt/valhalla/custom_files
mkdir -p $D /tmp/vh && cd /tmp/vh
echo "Pobieram listę plików…"
curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/valhalla-pl" | python3 -c "
import json,sys
for a in json.load(sys.stdin)['assets']: print(a['name'])" > files.txt
cat files.txt
rm -f valhalla_tiles.tar
for f in $(grep '^valhalla_tiles.tar.part' files.txt | sort); do
  echo "Pobieram $f…"; curl -fL --retry 5 -o "$f" "$BASE/$f"
  cat "$f" >> valhalla_tiles.tar; rm -f "$f"
done
want=$(curl -fsSL "$BASE/valhalla_tiles.sha256")
have=$(sha256sum valhalla_tiles.tar | cut -d' ' -f1)
[ "$want" = "$have" ] || { echo "BŁĄD: suma kontrolna się nie zgadza"; exit 1; }
for f in valhalla.json admins.sqlite timezones.sqlite; do grep -qx "$f" files.txt && curl -fsSL -o "$D/$f" "$BASE/$f" || true; done
mv -f valhalla_tiles.tar $D/valhalla_tiles.tar
docker rm -f valhalla >/dev/null 2>&1 || true
docker run -d --name valhalla --restart unless-stopped \
  -p 127.0.0.1:8002:8002 -v $D:/custom_files \
  --memory=2g --memory-swap=4g \
  -e use_tiles_ignore_pbf=True -e build_tar=False -e serve_tiles=True -e server_threads=2 \
  ghcr.io/valhalla/valhalla-scripted:latest
echo "Czekam na start (do 2 minut)…"
for i in $(seq 1 24); do
  sleep 5
  curl -s http://127.0.0.1:8002/status | grep -q version && break
done
curl -s http://127.0.0.1:8002/status | head -c 300; echo
echo "Test trasy Lublin → Warszawa:"
curl -s "http://127.0.0.1:8002/route?json=%7B%22locations%22:%5B%7B%22lat%22:51.2465,%22lon%22:22.5684%7D,%7B%22lat%22:52.2297,%22lon%22:21.0122%7D%5D,%22costing%22:%22auto%22%7D" | python3 -c "
import json,sys
d=json.load(sys.stdin); s=d['trip']['summary']; print('km:',round(s['length'],1),'czas min:',round(s['time']/60))"
