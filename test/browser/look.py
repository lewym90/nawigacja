"""Oglądanie wyglądu kokpitu na sztucznym mieście (synthcity.py). Użycie: python3 look.py <katalog_zrzutów> [day|night]"""
import json, math, sys, threading, http.server, socketserver, functools, os, re
from playwright.sync_api import sync_playwright
import synthcity as sc

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/look'
THEME = sys.argv[2] if len(sys.argv) > 2 else 'day'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

LAT0, LNG0 = sc.LAT0, sc.LNG0
def route_coords():
    pts = [[LNG0, LAT0]]
    for i in range(1, 61): pts.append([LNG0, LAT0 + i * 100 / 111195.0])
    lat = pts[-1][1]; k = 111195.0 * math.cos(math.radians(lat))
    for i in range(1, 41): pts.append([LNG0 + i * 100 / k, lat])
    return pts
def osrm():
    pts = route_coords()
    ms = [{'speed': 50, 'unit': 'km/h'}] * 40 + [{'speed': 90, 'unit': 'km/h'}] * 60
    return {'distance': 10000, 'duration': 700, 'geometry': {'type': 'LineString', 'coordinates': pts},
            'legs': [{'summary': 'ul. Testowa', 'annotation': {'distance': [100] * 100, 'maxspeed': ms}, 'steps': [
                {'name': 'ul. Testowa', 'distance': 6000, 'duration': 400, 'maneuver': {'type': 'depart', 'location': pts[0]}},
                {'name': 'Al. Próbna', 'distance': 4000, 'duration': 260, 'maneuver': {'type': 'turn', 'modifier': 'right', 'location': pts[60]}},
                {'name': '', 'distance': 0, 'duration': 0, 'maneuver': {'type': 'arrive', 'location': pts[-1]}}]}]}

def fj(route, data): route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(data))
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, geolocation={'latitude': LAT0, 'longitude': LNG0}, permissions=['geolocation'], locale='pl-PL')
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.route('https://tiles.openfreemap.org/planet', lambda r: fj(r, {'tilejson': '2.2.0', 'tiles': ['https://tiles.mock/{z}/{x}/{y}.pbf'], 'minzoom': 0, 'maxzoom': 15}))
    def tiles(r):
        m = re.search(r'/(\d+)/(\d+)/(\d+)\.pbf', r.request.url)
        z, x, y = map(int, m.groups())
        r.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'application/x-protobuf'}, body=sc.tile(z, x, y))
    page.route('https://tiles.mock/**', tiles)
    page.route('https://tiles.openfreemap.org/fonts/**', lambda r: r.fulfill(status=404, body=b''))
    page.route('https://router.project-osrm.org/**', lambda r: fj(r, {'code': 'Ok', 'routes': [osrm()]}))
    page.route('https://valhalla1.openstreetmap.de/**', lambda r: fj(r, {'edges': [{'length': 0.5, 'speed_limit': 50}]}))
    page.route('https://188-68-247-201.sslip.io/**', lambda r: r.fulfill(status=404, headers={'access-control-allow-origin': '*'}, body=b''))
    page.route('https://overpass-api.de/**', lambda r: fj(r, {'elements': []}))
    end = route_coords()[-1]
    page.route('https://photon.komoot.io/**', lambda r: fj(r, {'features': [{'geometry': {'coordinates': end}, 'properties': {'name': 'Rynek Testowy', 'street': 'ul. Główna', 'housenumber': '1', 'city': 'Zamość'}}]}))
    page.add_init_script("localStorage.setItem('nav.settings', JSON.stringify({theme: '%s'}))" % THEME)
    page.goto(f'http://127.0.0.1:{PORT}/index.html')
    try:
        page.wait_for_function('window.__nav && window.__nav.map && window.__nav.map.isStyleLoaded()', timeout=25000)
    except Exception:
        print('NIE ZAŁADOWANO', errors[:6]); page.screenshot(path=f'{OUT}/fail.png'); raise
    page.wait_for_timeout(1500)
    page.fill('#q', 'Rynek Zamość')
    page.wait_for_selector('#results .r-main:has-text("Rynek Testowy")', timeout=5000)
    page.click('#results button:has-text("Rynek Testowy")')
    page.wait_for_selector('.route-card', timeout=8000)
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/{THEME}-1-preview.png')
    page.click('#btn-sim')
    page.wait_for_timeout(6000)
    page.screenshot(path=f'{OUT}/{THEME}-2-nav0.png')
    page.evaluate("window.__nav.S.sim.along = 5600")
    for i in range(1, 5):
        page.wait_for_timeout(2600)
        page.screenshot(path=f'{OUT}/{THEME}-2-nav{i}.png')
        print('stan', i, page.evaluate("(() => { const m = window.__nav.map; return {pitch: +m.getPitch().toFixed(1), bearing: +m.getBearing().toFixed(1), roll: +m.getRoll().toFixed(2)}; })()"))
    print('stan:', page.evaluate("(() => { const m = window.__nav.map; return {pitch: m.getPitch(), zoom: m.getZoom(), bearing: m.getBearing(), roll: m.getRoll ? m.getRoll() : null}; })()"))
    br.close()
print('BŁĘDY:', errors[:5])
