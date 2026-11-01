#!/usr/bin/env python3
"""Usługa głosu dla nawigacji: zamienia zdanie na nagranie (Gemini TTS) i pamięta je na dysku.
Klucz API jest tylko tutaj (plik /etc/nav-tts.env: GEMINI_KEY=...), aplikacja go nie widzi.
Uruchamia się przez systemd i słucha tylko na 127.0.0.1; z internetu wystawia ją Caddy.
"""
import base64, hashlib, json, os, re, struct, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

KEY = os.environ.get('GEMINI_KEY', '').strip()
MODEL = os.environ.get('NAV_TTS_MODEL', 'gemini-2.5-flash-preview-tts')
VOICE = os.environ.get('NAV_TTS_VOICE', 'Kore')
CACHE = os.environ.get('NAV_TTS_CACHE', '/var/lib/nav-tts')
ALLOWED = [o for o in os.environ.get('NAV_TTS_ORIGINS', 'https://lewym90.github.io').split(',') if o]
DAILY_NEW = int(os.environ.get('NAV_TTS_DAILY', '1500'))  # ile NOWYCH zdań dziennie (ochrona kosztów)
PORT = int(os.environ.get('NAV_TTS_PORT', '8787'))
MAXLEN = 260
PROMPT = 'Przeczytaj naturalnie, spokojnie i wyraźnie, jak lektor nawigacji samochodowej, po polsku: '

os.makedirs(CACHE, exist_ok=True)
lock = threading.Lock()
slots = threading.Semaphore(3)  # tyle zapytań do Gemini naraz
day = {'d': time.strftime('%Y-%m-%d'), 'n': 0}
inflight = {}


def wav(pcm, rate=24000):
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16)
            + b'data' + struct.pack('<I', len(pcm)) + pcm)


def synth(text):
    body = {'contents': [{'parts': [{'text': PROMPT + text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': VOICE}}}}}
    last = None
    for attempt in range(3):
        req = urllib.request.Request(
            f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
            data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
            return wav(base64.b64decode(d['candidates'][0]['content']['parts'][0]['inlineData']['data']))
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code in (429, 500, 503):
                time.sleep(1 + attempt)
                continue
            raise
        except (KeyError, IndexError) as e:
            last = 'odpowiedź bez dźwięku'
            time.sleep(1)
    raise RuntimeError(f'Gemini: {last}')


def get_audio(text):
    h = hashlib.sha256(f'{MODEL}|{VOICE}|{text}'.encode()).hexdigest()[:40]
    path = os.path.join(CACHE, h + '.wav')
    if os.path.exists(path):
        return open(path, 'rb').read()
    with lock:
        ev = inflight.get(h)
        if ev is None:
            inflight[h] = ev = threading.Event()
            owner = True
        else:
            owner = False
    if not owner:
        ev.wait(70)
        if os.path.exists(path):
            return open(path, 'rb').read()
        raise RuntimeError('nie udało się')
    try:
        with lock:
            today = time.strftime('%Y-%m-%d')
            if day['d'] != today:
                day['d'], day['n'] = today, 0
            if day['n'] >= DAILY_NEW:
                raise PermissionError('dzienny limit nowych zdań')
            day['n'] += 1
        with slots:
            data = synth(text)
        tmp = path + '.tmp'
        open(tmp, 'wb').write(data)
        os.replace(tmp, path)
        return data
    finally:
        with lock:
            inflight.pop(h, None)
        ev.set()


class H(BaseHTTPRequestHandler):
    def _cors(self):
        o = self.headers.get('Origin', '')
        if o in ALLOWED or re.match(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$', o):
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')

    def _send(self, code, body=b'', ctype='text/plain; charset=utf-8', extra=None):
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # telefon przestał czekać; nagranie i tak zostaje w pamięci serwera

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.endswith('/health'):
            self._send(200, json.dumps({'ok': bool(KEY), 'model': MODEL, 'voice': VOICE, 'new_today': day['n']}).encode(), 'application/json')
            return
        o = self.headers.get('Origin', '')
        if o and o not in ALLOWED and not re.match(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$', o):
            self._send(403, b'zabronione')
            return
        t = ' '.join((parse_qs(u.query).get('t', [''])[0]).split())
        if not t or len(t) > MAXLEN or not KEY:
            self._send(400, b'zly tekst')
            return
        try:
            self._send(200, get_audio(t), 'audio/wav', {'Cache-Control': 'public, max-age=31536000, immutable'})
        except PermissionError as e:
            self._send(429, str(e).encode())
        except Exception as e:  # noqa: BLE001
            print('błąd:', type(e).__name__, str(e).replace(KEY, '***')[:200], file=sys.stderr, flush=True)
            self._send(502, b'blad')

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    print(f'nav-tts: port {PORT}, model {MODEL}, głos {VOICE}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
