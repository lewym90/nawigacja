#!/usr/bin/env python3
"""Usługa głosu dla nawigacji: zamienia zdanie na nagranie i pamięta je na dysku.
Głosy: ewa = polski model Pocket TTS liczony na tym serwerze (bez kosztów), agata = Gemini TTS (wymaga klucza).
Klucz API (opcjonalny, tylko dla Agaty) jest w pliku /etc/nav-tts.env: GEMINI_KEY=..., aplikacja go nie widzi.
Uruchamia się przez systemd i słucha tylko na 127.0.0.1; z internetu wystawia ją Caddy.
"""
import base64, hashlib, io, json, os, re, struct, sys, threading, time, urllib.error, urllib.request
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
ewa_lock = threading.RLock()
_ewa = []
GAP = float(os.environ.get('NAV_TTS_GAP', '7'))  # minimalny odstęp między zapytaniami do Gemini (s)
gate = threading.Condition()
gstate = {'next': 0.0, 'urgent': 0}
last_err = {'msg': ''}


def acquire(urgent):
    """Dozuje zapytania do Gemini: jedno na GAP sekund, pilne wyprzedzają resztę."""
    with gate:
        if urgent:
            gstate['urgent'] += 1
        try:
            while True:
                now = time.time()
                if now >= gstate['next'] and (urgent or gstate['urgent'] == 0):
                    gstate['next'] = now + GAP
                    return
                gate.wait(timeout=max(0.2, min(2.0, gstate['next'] - now)))
        finally:
            if urgent:
                gstate['urgent'] -= 1
                gate.notify_all()


def backoff(seconds):
    with gate:
        gstate['next'] = max(gstate['next'], time.time() + seconds)
day = {'d': time.strftime('%Y-%m-%d'), 'n': 0}
inflight = {}


def wav(pcm, rate=24000):
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16)
            + b'data' + struct.pack('<I', len(pcm)) + pcm)


def synth(text, urgent=False):
    body = {'contents': [{'parts': [{'text': PROMPT + text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': VOICE}}}}}
    last = None
    for attempt in range(5):
        acquire(urgent)
        req = urllib.request.Request(
            f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
            data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
            return wav(base64.b64decode(d['candidates'][0]['content']['parts'][0]['inlineData']['data']))
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace').replace(KEY, '***')
            last = e.code
            last_err['msg'] = f'{e.code}: {raw[:300]}'
            print('Gemini', e.code, raw[:400].replace('\n', ' '), file=sys.stderr, flush=True)
            if e.code in (429, 500, 503):
                m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', raw)
                backoff(min(60.0, float(m.group(1)) + 1) if m else 10.0 * (attempt + 1))
                continue
            raise
        except (KeyError, IndexError):
            last = 'odpowiedź bez dźwięku'
            time.sleep(1)
    raise RuntimeError(f'Gemini: {last}')


def ewa_model():
    """Wczytuje model Pocket (polski) przy pierwszym użyciu; potem zostaje w pamięci (~150 MB z kwantyzacją)."""
    with ewa_lock:
        if not _ewa:
            import soundfile as sf
            from huggingface_hub import hf_hub_download
            from pocket_tts import TTSModel
            ref = hf_hub_download('shefowl/pocket-tts-polish-6l', 'reference.wav')
            m = TTSModel.load_model(config='hf://shefowl/pocket-tts-polish-6l/config.yaml', temp=0.3, quantize=True)
            _ewa.extend([m, m.get_state_for_audio_prompt(ref), sf])
        return _ewa


def synth_ewa(text):
    with ewa_lock:  # procesor liczy jedno zdanie naraz
        m, st, sf = ewa_model()
        w = m.generate_audio(st, text)
        buf = io.BytesIO()
        sf.write(buf, w.numpy().squeeze(), m.sample_rate, format='WAV', subtype='PCM_16')
        return buf.getvalue()


def get_audio(text, voice='ewa', urgent=False):
    ident = f'{MODEL}|{VOICE}' if voice == 'agata' else 'pocket-pl-6l'
    h = hashlib.sha256(f'{voice}|{ident}|{text}'.encode()).hexdigest()[:40]
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
        if voice == 'agata':
            if not KEY:
                raise PermissionError('Agata niedostępna: brak klucza')
            with lock:
                today = time.strftime('%Y-%m-%d')
                if day['d'] != today:
                    day['d'], day['n'] = today, 0
                if day['n'] >= DAILY_NEW:
                    raise PermissionError('dzienny limit nowych zdań')
            data = synth(text, urgent)
            with lock:
                day['n'] += 1
        else:
            data = synth_ewa(text)
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
            self._send(200, json.dumps({'ok': True, 'ewa': bool(_ewa), 'agata': bool(KEY), 'model': MODEL, 'voice': VOICE, 'new_today': day['n'], 'gap_s': GAP, 'last_error': last_err['msg']}).encode(), 'application/json')
            return
        o = self.headers.get('Origin', '')
        if o and o not in ALLOWED and not re.match(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$', o):
            self._send(403, b'zabronione')
            return
        t = ' '.join((parse_qs(u.query).get('t', [''])[0]).split())
        voice = parse_qs(u.query).get('v', ['ewa'])[0]
        if voice not in ('ewa', 'agata') or not t or len(t) > MAXLEN:
            self._send(400, b'zly tekst')
            return
        try:
            self._send(200, get_audio(t, voice, parse_qs(u.query).get('u', ['0'])[0] == '1'), 'audio/wav', {'Cache-Control': 'public, max-age=31536000, immutable'})
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
