#!/usr/bin/env python3
"""Wspólna baza poprawek tras: kierowcy zaznaczają „unikaj tej drogi” / „tu można jechać”.
Usługa niezależna od reszty serwera: sam Python (stdlib) + sqlite, domyślnie port 18788, za Caddy pod /fixes.

  POST   /fixes            {kind, mode, lat, lng, client, note?}  -> {id}
  GET    /fixes?bbox=minLng,minLat,maxLng,maxLat[&mode=auto]      -> [{id,kind,mode,lat,lng,n,age}]
  DELETE /fixes/<id>?client=<id klienta>                          -> {ok}  (tylko własne zgłoszenie)
  GET    /fixes/export?token=<NAV_FIXES_TOKEN>                    -> wszystkie zgłoszenia (dla właściciela, z linkami do OSM)
  GET    /fixes/health

`n` = ilu RÓŻNYCH kierowców zgłosiło to samo w promieniu 30 m. Aplikacja stosuje cudze „unikaj” od n >= 2,
własne od razu. Zabezpieczenia: limity na kierowcę i adres IP, współrzędne tylko z Polski, mały rozmiar zapytań.
"""
import contextlib
import json
import math
import os
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB_PATH = os.environ.get('NAV_FIXES_DB', '/var/lib/nav-fixes/fixes.db')
PORT = int(os.environ.get('NAV_FIXES_PORT', '18788'))
TOKEN = os.environ.get('NAV_FIXES_TOKEN', '')
KINDS = {'avoid', 'ok'}
MODES = {'auto', 'pedestrian', 'bicycle'}
MAX_AGE_DAYS = 180          # po tylu dniach zgłoszenie wygasa (drogi się zmieniają)
PER_CLIENT_DAY = 40
PER_IP_DAY = 200
CLUSTER_M = 30
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = 48.9, 55.0, 14.0, 24.3

_lock = threading.Lock()


def db():
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('''CREATE TABLE IF NOT EXISTS fixes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, mode TEXT NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL, note TEXT, client TEXT NOT NULL, ip TEXT, created INTEGER NOT NULL)''')
    c.execute('CREATE INDEX IF NOT EXISTS i_geo ON fixes(lat, lng)')
    c.execute('CREATE INDEX IF NOT EXISTS i_client ON fixes(client, created)')
    return c


@contextlib.contextmanager
def conn():
    c = db()
    try:
        yield c
    finally:
        c.close()


def hav(a_lat, a_lng, b_lat, b_lng):
    r = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def valid_report(b):
    """Zwraca (dane, błąd). Sprawdza typ, współrzędne i długości pól."""
    if not isinstance(b, dict):
        return None, 'zły format'
    kind, mode = b.get('kind'), b.get('mode', 'auto')
    if kind not in KINDS or mode not in MODES:
        return None, 'zły rodzaj'
    try:
        lat, lng = float(b.get('lat')), float(b.get('lng'))
    except (TypeError, ValueError):
        return None, 'zła pozycja'
    if not (LAT_MIN < lat < LAT_MAX and LNG_MIN < lng < LNG_MAX) or math.isnan(lat) or math.isnan(lng):
        return None, 'poza Polską'
    client = str(b.get('client', ''))
    if not (8 <= len(client) <= 64) or not client.replace('-', '').isalnum():
        return None, 'zły identyfikator'
    note = str(b.get('note', ''))[:140]
    return {'kind': kind, 'mode': mode, 'lat': round(lat, 6), 'lng': round(lng, 6), 'client': client, 'note': note}, None


def add_fix(c, rep, ip, now=None):
    now = now or int(time.time())
    day = now - 86400
    if c.execute('SELECT COUNT(*) FROM fixes WHERE client=? AND created>?', (rep['client'], day)).fetchone()[0] >= PER_CLIENT_DAY:
        return None, 'za dużo zgłoszeń'
    if c.execute('SELECT COUNT(*) FROM fixes WHERE ip=? AND created>?', (ip, day)).fetchone()[0] >= PER_IP_DAY:
        return None, 'za dużo zgłoszeń z tego adresu'
    # to samo miejsce, ten sam rodzaj, ten sam kierowca: nie dublujemy (odświeżamy datę)
    dlat = CLUSTER_M / 111195.0
    dlng = CLUSTER_M / (111195.0 * math.cos(math.radians(rep['lat'])))
    rows = c.execute('SELECT id, lat, lng FROM fixes WHERE client=? AND kind=? AND mode=? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?',
                     (rep['client'], rep['kind'], rep['mode'], rep['lat'] - dlat, rep['lat'] + dlat, rep['lng'] - dlng, rep['lng'] + dlng)).fetchall()
    for rid, la, ln in rows:
        if hav(rep['lat'], rep['lng'], la, ln) <= CLUSTER_M:
            c.execute('UPDATE fixes SET created=? WHERE id=?', (now, rid))
            c.commit()
            return rid, None
    cur = c.execute('INSERT INTO fixes(kind,mode,lat,lng,note,client,ip,created) VALUES (?,?,?,?,?,?,?,?)',
                    (rep['kind'], rep['mode'], rep['lat'], rep['lng'], rep['note'], rep['client'], ip, now))
    c.commit()
    return cur.lastrowid, None


def list_fixes(c, bbox, mode=None, now=None):
    """Zgłoszenia w obwiedni, scalone w skupiska po 30 m; n = liczba różnych kierowców."""
    now = now or int(time.time())
    min_lng, min_lat, max_lng, max_lat = bbox
    q = 'SELECT id, kind, mode, lat, lng, client, created FROM fixes WHERE created>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?'
    args = [now - MAX_AGE_DAYS * 86400, min_lat, max_lat, min_lng, max_lng]
    if mode:
        q += ' AND mode=?'
        args.append(mode)
    rows = c.execute(q + ' ORDER BY created DESC LIMIT 5000', args).fetchall()
    clusters = []
    for rid, kind, md, lat, lng, client, created in rows:
        for cl in clusters:
            if cl['kind'] == kind and cl['mode'] == md and hav(lat, lng, cl['lat'], cl['lng']) <= CLUSTER_M:
                cl['clients'].add(client)
                break
        else:
            clusters.append({'id': rid, 'kind': kind, 'mode': md, 'lat': lat, 'lng': lng, 'clients': {client}, 'created': created})
    return [{'id': k['id'], 'kind': k['kind'], 'mode': k['mode'], 'lat': k['lat'], 'lng': k['lng'], 'n': len(k['clients']),
             'age': int((now - k['created']) / 86400)} for k in clusters]


def delete_fix(c, fid, client):
    cur = c.execute('DELETE FROM fixes WHERE id=? AND client=?', (fid, client))
    c.commit()
    return cur.rowcount > 0


def export_all(c):
    out = []
    for rid, kind, md, lat, lng, note, created in c.execute('SELECT id, kind, mode, lat, lng, note, created FROM fixes ORDER BY created DESC LIMIT 5000'):
        out.append({'id': rid, 'kind': kind, 'mode': md, 'lat': lat, 'lng': lng, 'note': note,
                    'osm': f'https://www.openstreetmap.org/?mlat={lat}&mlon={lng}#map=19/{lat}/{lng}', 'created': created})
    return out


class H(BaseHTTPRequestHandler):
    server_version = 'nav-fixes'

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def _ip(self):
        return (self.headers.get('X-Forwarded-For', '') or self.client_address[0]).split(',')[0].strip()[:64]

    def _path(self):
        u = urlparse(self.path)
        p = u.path
        for pre in ('/fixes',):
            if p.startswith(pre):
                p = p[len(pre):]
        return p.rstrip('/') or '/', parse_qs(u.query)

    def do_GET(self):
        p, q = self._path()
        try:
            if p == '/health':
                return self._send(200, {'ok': True})
            if p == '/export':
                if not TOKEN or q.get('token', [''])[0] != TOKEN:
                    return self._send(403, {'error': 'brak dostępu'})
                with _lock, conn() as c:
                    return self._send(200, export_all(c))
            if p == '/':
                bb = [float(x) for x in q.get('bbox', [''])[0].split(',')]
                if len(bb) != 4 or bb[2] - bb[0] > 3 or bb[3] - bb[1] > 3:
                    return self._send(400, {'error': 'zła obwiednia'})
                with _lock, conn() as c:
                    return self._send(200, list_fixes(c, bb, q.get('mode', [None])[0]))
        except (ValueError, sqlite3.Error):
            return self._send(400, {'error': 'zapytanie'})
        self._send(404, {'error': 'nie ma'})

    def do_POST(self):
        p, _ = self._path()
        if p != '/':
            return self._send(404, {'error': 'nie ma'})
        n = int(self.headers.get('Content-Length', 0) or 0)
        if n <= 0 or n > 2048:
            return self._send(413, {'error': 'za duże'})
        try:
            body = json.loads(self.rfile.read(n))
        except ValueError:
            return self._send(400, {'error': 'zły JSON'})
        rep, err = valid_report(body)
        if err:
            return self._send(400, {'error': err})
        with _lock, conn() as c:
            fid, err = add_fix(c, rep, self._ip())
        if err:
            return self._send(429, {'error': err})
        self._send(200, {'id': fid})

    def do_DELETE(self):
        p, q = self._path()
        try:
            fid = int(p.strip('/'))
        except ValueError:
            return self._send(404, {'error': 'nie ma'})
        with _lock, conn() as c:
            ok = delete_fix(c, fid, q.get('client', [''])[0])
        self._send(200 if ok else 404, {'ok': ok})

    def do_OPTIONS(self):
        self._send(204, {})


if __name__ == '__main__':
    db().close()
    print(f'nav-fixes na 127.0.0.1:{PORT}, baza {DB_PATH}')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
