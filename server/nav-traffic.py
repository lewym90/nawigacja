#!/usr/bin/env python3
"""Ruch drogowy dla nawigacji: pośrednik do TomTom Routing. Klucz zostaje na serwerze.
POST /traffic/route {"points":[[lng,lat],...],"depart":"2026-11-05T07:30:00+01:00"|null,"client":"id"}
Odpowiedź: czas z ruchem, czas bez ruchu, opóźnienie i odcinki korków w metrach od początku trasy.
Krótka pamięć (120 s) dla tych samych zapytań i twardy limit miesięczny, żeby nie przekroczyć darmowej puli."""
import hashlib, json, math, os, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('NAV_TRAFFIC_PORT', '18789'))
KEY = os.environ.get('TOMTOM_KEY', '')
STATE = os.environ.get('NAV_TRAFFIC_STATE', '/var/lib/nav-traffic/usage.json')
MONTH_MAX = int(os.environ.get('NAV_TRAFFIC_MONTH_MAX', '18000'))
CLIENT_DAY = 600
TTL = 120
MAX_POINTS = 200
BBOX = (13.8, 48.8, 24.4, 55.1)  # Polska z zapasem
lock = threading.Lock()
cache = {}


def hav(a, b):
    r = math.pi / 180
    x = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))


def thin(points, n=MAX_POINTS):
    if len(points) <= n:
        return points
    step = (len(points) - 1) / (n - 1)
    return [points[round(i * step)] for i in range(n)]


def parse(data):
    """Odpowiedź TomTom -> nasz prosty format. Odcinki korków w metrach wzdłuż zwróconej linii."""
    r = data['routes'][0]
    s = r['summary']
    pts = [(p['latitude'], p['longitude']) for leg in r.get('legs', []) for p in leg.get('points', [])]
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + hav(pts[i - 1], pts[i]))
    jams = []
    for x in r.get('sections', []):
        if x.get('sectionType') != 'TRAFFIC' or not pts:
            continue
        a = min(x.get('startPointIndex', 0), len(cum) - 1)
        b = min(x.get('endPointIndex', 0), len(cum) - 1)
        jams.append({'from': round(cum[a]), 'to': round(cum[b]), 'kind': x.get('simpleCategory', 'OTHER'), 'mag': x.get('magnitudeOfDelay', 0), 'kmh': x.get('effectiveSpeedInKmh'), 'delay': x.get('delayInSeconds', 0)})
    return {
        'time': s.get('travelTimeInSeconds'), 'free': s.get('noTrafficTravelTimeInSeconds'), 'typical': s.get('historicTrafficTravelTimeInSeconds'),
        'delay': s.get('trafficDelayInSeconds', 0), 'length': s.get('lengthInMeters') or (cum[-1] if cum else 0), 'arrive': s.get('arrivalTime'), 'jams': jams,
    }


def tomtom(points, depart):
    a, b = points[0], points[-1]
    loc = f'{a[1]:.6f},{a[0]:.6f}:{b[1]:.6f},{b[0]:.6f}'
    q = f'key={KEY}&traffic=true&travelMode=car&computeTravelTimeFor=all&sectionType=traffic&routeRepresentation=polyline&reconstructionMode=track'
    if depart:
        q += '&departAt=' + urllib.request.quote(depart, safe='')
    body = json.dumps({'supportingPoints': [{'latitude': p[1], 'longitude': p[0]} for p in thin(points)]}).encode()
    req = urllib.request.Request(f'https://api.tomtom.com/routing/1/calculateRoute/{loc}/json?{q}', data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=12) as res:
        return json.load(res)


def usage(client):
    """Zlicza zapytanie; False = limit wyczerpany."""
    now = time.gmtime()
    month = time.strftime('%Y-%m', now); day = time.strftime('%Y-%m-%d', now)
    with lock:
        try:
            u = json.load(open(STATE))
        except Exception:
            u = {}
        if u.get('month') != month:
            u = {'month': month, 'count': 0}
        if u.get('day') != day:
            u['day'] = day; u['clients'] = {}
        c = u['clients'].get(client, 0)
        if u['count'] >= MONTH_MAX or c >= CLIENT_DAY:
            return False, u['count']
        u['count'] += 1; u['clients'][client] = c + 1
        try:
            with open(STATE + '.tmp', 'w') as f:
                json.dump(u, f)
            os.replace(STATE + '.tmp', STATE)
        except OSError:
            pass
        return True, u['count']


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def out(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path.rstrip('/').endswith('/health'):
            try:
                n = json.load(open(STATE)).get('count', 0)
            except Exception:
                n = 0
            return self.out(200, {'ok': True, 'key': bool(KEY), 'used': n, 'max': MONTH_MAX})
        self.out(404, {'error': 'brak'})

    def do_POST(self):
        if not self.path.rstrip('/').endswith('/route'):
            return self.out(404, {'error': 'brak'})
        n = int(self.headers.get('Content-Length') or 0)
        if n > 400000:
            return self.out(413, {'error': 'za duże'})
        try:
            d = json.loads(self.rfile.read(n)); pts = d['points']; depart = d.get('depart'); client = str(d.get('client') or self.client_address[0])[:40]
            assert len(pts) >= 2
            for p in (pts[0], pts[-1]):
                assert BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]
        except Exception:
            return self.out(400, {'error': 'złe dane'})
        if not KEY:
            return self.out(503, {'error': 'brak klucza'})
        key = hashlib.sha1(json.dumps([[round(c, 3) for c in p] for p in thin(pts, 30)] + [depart]).encode()).hexdigest()
        hit = cache.get(key)
        if hit and time.time() - hit[0] < TTL:
            return self.out(200, hit[1])
        ok, _ = usage(client)
        if not ok:
            return self.out(429, {'error': 'limit'})
        try:
            r = parse(tomtom(pts, depart))
        except urllib.error.HTTPError as e:
            return self.out(502, {'error': f'tomtom {e.code}'})
        except Exception:
            return self.out(502, {'error': 'tomtom'})
        cache[key] = (time.time(), r)
        for k in [k for k, v in cache.items() if time.time() - v[0] > TTL]:
            cache.pop(k, None)
        self.out(200, r)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
