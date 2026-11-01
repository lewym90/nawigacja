#!/usr/bin/env bash
# Instalacja usługi głosu na serwerze (uruchom jako root). Można uruchamiać wielokrotnie (aktualizacja).
# Ewa (model Pocket) nie wymaga żadnego klucza. Klucz Gemini (Agata) jest opcjonalny: wpisz go albo naciśnij Enter.
set -e
install -d /opt/nav-tts /var/lib/nav-tts
curl -fsSL https://raw.githubusercontent.com/lewym90/nawigacja/main/server/nav-tts.py -o /opt/nav-tts/nav-tts.py
apt-get install -y python3-venv >/dev/null 2>&1 || true
if [ ! -x /opt/nav-tts/venv/bin/python ]; then
  echo "Instaluję model głosu (kilka minut, ok. 1-2 GB)…"
  python3 -m venv /opt/nav-tts/venv
fi
/opt/nav-tts/venv/bin/pip install -q --upgrade pip
/opt/nav-tts/venv/bin/pip install -q pocket-tts soundfile huggingface_hub
if [ ! -f /etc/nav-tts.env ]; then
  read -rsp "Klucz Gemini dla Agaty (Enter = pomiń; nic nie widać przy wpisywaniu): " K </dev/tty; echo
  printf 'GEMINI_KEY=%s\nNAV_TTS_PORT=18787\n' "$K" > /etc/nav-tts.env
  chmod 600 /etc/nav-tts.env
fi
grep -q '^NAV_TTS_PORT=' /etc/nav-tts.env || echo 'NAV_TTS_PORT=18787' >> /etc/nav-tts.env
cat > /etc/systemd/system/nav-tts.service <<'UNIT'
[Unit]
Description=Glos nawigacji (Ewa: Pocket TTS, Agata: Gemini; z pamiecia)
After=network-online.target
[Service]
EnvironmentFile=/etc/nav-tts.env
ExecStart=/opt/nav-tts/venv/bin/python /opt/nav-tts/nav-tts.py
Restart=always
RestartSec=3
Nice=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable nav-tts
systemctl restart nav-tts
sleep 2
. /etc/nav-tts.env
curl -s "http://127.0.0.1:${NAV_TTS_PORT}/nav-tts/health"; echo
echo "Test pierwszego zdania Ewy (przy pierwszym razie pobiera model, do 1-2 minut):"
time curl -s -o /tmp/ewa-test.wav -w "HTTP %{http_code}, %{size_download} bajtów\n" "http://127.0.0.1:${NAV_TTS_PORT}/nav-tts?v=ewa&t=Za%20sze%C5%9B%C4%87set%20metr%C3%B3w%2C%20skr%C4%99%C4%87%20w%20lewo."
