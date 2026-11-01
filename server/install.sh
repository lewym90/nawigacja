#!/usr/bin/env bash
# Instalacja usługi głosu na serwerze (uruchom jako root). Zapyta o klucz Gemini; nie zostaje w historii poleceń.
set -e
install -d /opt/nav-tts /var/lib/nav-tts
curl -fsSL https://raw.githubusercontent.com/lewym90/nawigacja/main/server/nav-tts.py -o /opt/nav-tts/nav-tts.py
if [ ! -s /etc/nav-tts.env ]; then
  read -rsp "Klucz Gemini (nic nie widać przy wpisywaniu): " K; echo
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
systemctl enable --now nav-tts
sleep 1
curl -s http://127.0.0.1:8787/nav-tts/health; echo
echo
echo "Teraz dopisz do Caddy w bloku 188-68-247-201.sslip.io:"
echo "    handle /nav-tts* {"
echo "        reverse_proxy 127.0.0.1:8787"
echo "    }"
