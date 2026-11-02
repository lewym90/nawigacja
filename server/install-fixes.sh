#!/usr/bin/env bash
# Instalacja usługi poprawek tras na serwerze (uruchom jako root). Można uruchamiać wielokrotnie (aktualizacja).
# NIE rusza innych aplikacji: osobny port (18788), osobna usługa, osobny plik Caddy (z walidacją i wycofaniem).
set -e
REF="${REF:-main}"
RAW="https://raw.githubusercontent.com/lewym90/nawigacja/${REF}/server"
install -d /opt/nav-fixes /var/lib/nav-fixes
curl -fsSL "$RAW/nav-fixes.py" -o /opt/nav-fixes/nav-fixes.py
if [ ! -f /etc/nav-fixes.env ]; then
  printf 'NAV_FIXES_PORT=18788\nNAV_FIXES_TOKEN=%s\n' "$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)" > /etc/nav-fixes.env
  chmod 600 /etc/nav-fixes.env
fi
cat > /etc/systemd/system/nav-fixes.service <<'UNIT'
[Unit]
Description=Poprawki tras nawigacji (wspolna baza)
After=network-online.target
[Service]
EnvironmentFile=/etc/nav-fixes.env
ExecStart=/usr/bin/python3 /opt/nav-fixes/nav-fixes.py
Restart=always
RestartSec=3
Nice=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable nav-fixes >/dev/null 2>&1
systemctl restart nav-fixes
sleep 1
. /etc/nav-fixes.env
curl -fsS "http://127.0.0.1:${NAV_FIXES_PORT}/fixes/health"; echo

# Caddy: tylko własny plik; przed przeładowaniem walidacja, a przy błędzie plik jest usuwany
curl -fsSL "$RAW/nav-fixes.caddy" -o /tmp/nav-fixes.caddy
cp /etc/caddy/conf.d/nav-fixes.caddy /tmp/nav-fixes.caddy.bak 2>/dev/null || true
cp /tmp/nav-fixes.caddy /etc/caddy/conf.d/nav-fixes.caddy
if caddy validate --config /etc/caddy/Caddyfile >/tmp/caddy-validate.log 2>&1; then
  systemctl reload caddy
  echo "Caddy: przeładowany"
else
  echo "Caddy: BŁĄD konfiguracji, wycofuję zmianę (inne aplikacje nietknięte):"; tail -5 /tmp/caddy-validate.log
  if [ -f /tmp/nav-fixes.caddy.bak ]; then cp /tmp/nav-fixes.caddy.bak /etc/caddy/conf.d/nav-fixes.caddy; else rm -f /etc/caddy/conf.d/nav-fixes.caddy; fi
  exit 1
fi
sleep 1
echo "Test przez HTTPS:"
curl -fsS "https://188-68-247-201.sslip.io/fixes/health"; echo
echo "Eksport zgłoszeń (tylko dla Ciebie, nie udostępniaj): https://188-68-247-201.sslip.io/fixes/export?token=${NAV_FIXES_TOKEN}"
