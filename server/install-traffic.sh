#!/usr/bin/env bash
# Instalacja usługi ruchu (uruchom jako root). Pyta o klucz TomTom, nie zapisuje go nigdzie poza /etc/nav-traffic.env.
# NIE rusza innych aplikacji: osobny port (18789), osobna usługa, osobny plik Caddy (z walidacją i wycofaniem).
set -e
REF="${REF:-main}"
RAW="https://raw.githubusercontent.com/lewym90/nawigacja/${REF}/server"
install -d /opt/nav-traffic /var/lib/nav-traffic
curl -fsSL "$RAW/nav-traffic.py" -o /opt/nav-traffic/nav-traffic.py
if [ ! -f /etc/nav-traffic.env ] || [ -n "$NEWKEY" ]; then
  printf 'Wklej klucz TomTom i naciśnij Enter (nie będzie widoczny): ' > /dev/tty
  IFS= read -rs KEY < /dev/tty; echo > /dev/tty
  [ -n "$KEY" ] || { echo "Brak klucza, przerywam."; exit 1; }
  ( umask 077; printf 'NAV_TRAFFIC_PORT=18789\nTOMTOM_KEY=%s\n' "$KEY" > /etc/nav-traffic.env )
fi
chmod 600 /etc/nav-traffic.env
cat > /etc/systemd/system/nav-traffic.service <<'UNIT'
[Unit]
Description=Ruch drogowy dla nawigacji
After=network-online.target
[Service]
EnvironmentFile=/etc/nav-traffic.env
ExecStart=/usr/bin/python3 /opt/nav-traffic/nav-traffic.py
Restart=always
RestartSec=3
Nice=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable nav-traffic >/dev/null 2>&1
systemctl restart nav-traffic
sleep 1
curl -fsS "http://127.0.0.1:18789/health"; echo
curl -fsSL "$RAW/nav-traffic.caddy" -o /tmp/nav-traffic.caddy
cp /etc/caddy/conf.d/nav-traffic.caddy /tmp/nav-traffic.caddy.bak 2>/dev/null || true
install -m 644 /tmp/nav-traffic.caddy /etc/caddy/conf.d/nav-traffic.caddy
if caddy validate --config /etc/caddy/Caddyfile >/tmp/caddy-validate.log 2>&1 && systemctl reload caddy; then
  echo "Caddy: przeładowany"
else
  echo "Caddy: BŁĄD konfiguracji, wycofuję zmianę (inne aplikacje nietknięte):"; tail -5 /tmp/caddy-validate.log
  if [ -f /tmp/nav-traffic.caddy.bak ]; then cp /tmp/nav-traffic.caddy.bak /etc/caddy/conf.d/nav-traffic.caddy; else rm -f /etc/caddy/conf.d/nav-traffic.caddy; fi
  exit 1
fi
sleep 1
echo "Test przez HTTPS:"
curl -fsS "https://188-68-247-201.sslip.io/traffic/health"; echo
LOC='{"points":[[22.5465,51.1905],[22.5680,51.2477]],"client":"instalacja"}'
echo "Próbna trasa z ruchem:"
curl -sS -X POST -H 'Content-Type: application/json' -d "$LOC" "https://188-68-247-201.sslip.io/traffic/route" | head -c 300; echo
