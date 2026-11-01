#!/usr/bin/env bash
# Instalacja usługi głosu na serwerze (uruchom jako root). Zapyta o klucz Gemini; nie zostaje w historii poleceń.
set -e
install -d /opt/nav-tts /var/lib/nav-tts
curl -fsSL https://raw.githubusercontent.com/lewym90/nawigacja/main/server/nav-tts.py -o /opt/nav-tts/nav-tts.py
if ! grep -q '^GEMINI_KEY=.\{20,\}' /etc/nav-tts.env 2>/dev/null; then
  read -rsp "Klucz Gemini (nic nie widać przy wpisywaniu): " K </dev/tty; echo
  if [ ${#K} -lt 20 ]; then echo "Za krótki klucz, przerywam."; exit 1; fi
  printf 'GEMINI_KEY=%s\n' "$K" > /etc/nav-tts.env
  chmod 600 /etc/nav-tts.env
fi
cat > /etc/systemd/system/nav-tts.service <<'UNIT'
[Unit]
Description=Glos nawigacji (Gemini TTS z pamiecia)
After=network-online.target
[Service]
EnvironmentFile=/etc/nav-tts.env
ExecStart=/usr/bin/python3 /opt/nav-tts/nav-tts.py
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable nav-tts
systemctl restart nav-tts
sleep 1
. /etc/nav-tts.env 2>/dev/null; curl -s "http://127.0.0.1:${NAV_TTS_PORT:-8787}/nav-tts/health"; echo
echo
echo "Teraz dopisz do Caddy w bloku 188-68-247-201.sslip.io:"
echo "    handle /nav-tts* {"
echo "        reverse_proxy 127.0.0.1:8787"
echo "    }"
