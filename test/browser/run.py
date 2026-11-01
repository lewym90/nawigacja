"""Test w przeglądarce z podstawionymi usługami (kafelki, trasy, Overpass, Photon).
Uruchom: python3 test/browser/run.py <katalog_zrzutów>
"""
import json, math, sys, threading, http.server, socketserver, functools, os
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
Handler = functools.partial(Q, directory=ROOT)
srv = socketserver.TCPServer(('127.0.0.1', 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

LAT0, LNG0 = 51.2, 22.55
def north(d): return [LNG0, LAT0 + d / 111195.0]
def route_coords(shift=0.0):
    pts = [[LNG0 + shift, LAT0]]
    for i in range(1, 61): pts.append([LNG0 + shift, LAT0 + i * 100 / 111195.0])
    lat = pts[-1][1]
    k = 111195.0 * math.cos(math.radians(lat))
    for i in range(1, 41): pts.append([LNG0 + shift + i * 100 / k, lat])
    return pts

def osrm(shift=0.0, extra=0):
    pts = route_coords(shift)
    total = 10000 + extra
    ms = [{'speed': 50, 'unit': 'km/h'}] * 40 + [{'speed': 70, 'unit': 'km/h'}] * 60
    return {
        'distance': total, 'duration': total / 15.0 + extra / 5,
        'geometry': {'type': 'LineString', 'coordinates': pts},
        'legs': [{'summary': 'Al. Próbna' if shift == 0 else 'ul. Boczna',
                  'annotation': {'distance': [100] * 100, 'maxspeed': ms},
                  'steps': [
            {'name': 'ul. Testowa', 'distance': 6000, 'duration': 400, 'maneuver': {'type': 'depart', 'location': pts[0]}},
            {'name': 'Al. Próbna', 'distance': 4000 + extra, 'duration': 260, 'maneuver': {'type': 'turn', 'modifier': 'right', 'location': pts[60]}},
            {'name': '', 'distance': 0, 'duration': 0, 'maneuver': {'type': 'arrive', 'location': pts[-1]}}]}]}

def overpass():
    c = north(3000)
    a = north(4000); b = north(6000)
    return {'elements': [
        {'type': 'node', 'id': 1, 'lat': c[1], 'lon': c[0], 'tags': {'highway': 'speed_camera', 'maxspeed': '50'}},
        {'type': 'node', 'id': 3, 'lat': a[1], 'lon': a[0]},
        {'type': 'node', 'id': 4, 'lat': b[1], 'lon': b[0]},
        {'type': 'relation', 'id': 9, 'tags': {'type': 'enforcement', 'enforcement': 'average_speed', 'maxspeed': '70'},
         'members': [{'type': 'node', 'ref': 3, 'role': 'from'}, {'type': 'node', 'ref': 4, 'role': 'to'}]}]}

errors = []
with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                         geolocation={'latitude': LAT0, 'longitude': LNG0}, permissions=['geolocation'], locale='pl-PL')
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))

    def fulfill_json(route, data): route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(data))
    page.route('https://tiles.openfreemap.org/planet', lambda r: fulfill_json(r, {'tilejson': '2.2.0', 'tiles': ['https://tiles.mock/{z}/{x}/{y}.pbf'], 'minzoom': 0, 'maxzoom': 14, 'attribution': '© OpenStreetMap'}))
    page.route('https://tiles.mock/**', lambda r: r.fulfill(status=200, headers={'access-control-allow-origin': '*'}, body=b''))
    page.route('https://tiles.openfreemap.org/fonts/**', lambda r: r.fulfill(status=404, body=b''))
    page.route('https://router.project-osrm.org/**', lambda r: fulfill_json(r, {'code': 'Ok', 'routes': [osrm(0), osrm(0.01, 1800)]}))
    page.route('https://overpass-api.de/**', lambda r: fulfill_json(r, overpass()))
    end = route_coords()[-1]
    page.route('https://photon.komoot.io/**', lambda r: fulfill_json(r, {'features': [
        {'geometry': {'coordinates': end}, 'properties': {'name': 'Rynek Testowy', 'street': 'ul. Główna', 'housenumber': '1', 'postcode': '22-400', 'city': 'Zamość', 'state': 'Lubelskie'}}]}))

    page.goto(f'http://127.0.0.1:{PORT}/index.html')
    page.wait_for_function('window.__nav && window.__nav.map && window.__nav.map.loaded()', timeout=20000)
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/1-idle.png')

    page.fill('#q', 'Rynek Zamość')
    page.wait_for_selector('#results button', timeout=5000)
    page.screenshot(path=f'{OUT}/2-search.png')
    page.click('#results button')
    page.wait_for_selector('.route-card', timeout=8000)
    page.wait_for_selector('.route-card .tag.cam', timeout=8000)
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/3-preview.png')
    cards = page.eval_on_selector_all('.route-card', 'els => els.map(e => e.innerText.replace(/\\n+/g, " | "))')
    print('KARTY:', cards)

    # Symulacja: skok do 2300 m, by zobaczyć fotoradar
    page.click('#btn-sim')
    page.wait_for_timeout(1500)
    page.evaluate('window.__nav.S.sim.along = 2250')
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/4-nav-camera.png')
    print('BANER:', page.inner_text('#banner') if page.is_visible('#banner') else 'brak')
    print('MANEWR:', page.inner_text('#maneuver').replace('\n', ' | '))
    # Wjazd w odcinkowy pomiar z prędkością 90 km/h (powyżej limitu 70)
    page.evaluate('window.__nav.S.sim.setSpeed(90); window.__nav.S.sim.along = 4050')
    page.wait_for_timeout(5000)
    page.screenshot(path=f'{OUT}/5-nav-section.png')
    print('ODCINEK:', page.inner_text('#section').replace('\n', ' | ') if page.is_visible('#section') else 'brak')
    # Zgłoszenie
    page.click('#btn-report')
    page.screenshot(path=f'{OUT}/6-report.png')
    page.click('#report-grid button[data-t=police]')
    page.wait_for_timeout(500)
    # Skok pod sam skręt
    page.evaluate('window.__nav.S.sim.setSpeed(40); window.__nav.S.sim.along = 5800')
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/7-nav-turn.png')
    print('MANEWR2:', page.inner_text('#maneuver').replace('\n', ' | '))
    # Gest użytkownika: strzałka ma przejść z ekranu na mapę, a po powrocie wrócić
    page.evaluate("window.__nav.map.fire('movestart', {originalEvent: {}})")
    page.wait_for_timeout(300)
    print('GEST: puck ukryty =', not page.is_visible('#puck'), '| znacznik na mapie =', page.locator('.nav-arrow').count(), '| przycisk powrotu =', page.is_visible('#btn-resume'))
    page.screenshot(path=f'{OUT}/7b-gesture.png')
    page.evaluate("window.__nav.map.jumpTo({center: [22.60, 51.25], zoom: 12, pitch: 0, bearing: 90})")
    page.click('#btn-resume')
    page.wait_for_timeout(1200)
    st = page.evaluate("(() => { const m = window.__nav.map; return {pitch: Math.round(m.getPitch()), zoom: +m.getZoom().toFixed(1)}; })()")
    print('POWRÓT: puck widoczny =', page.is_visible('#puck'), '| znacznik =', page.locator('.nav-arrow').count(), '| przycisk =', page.is_visible('#btn-resume'), '|', st)
    page.screenshot(path=f'{OUT}/7c-resume.png')
    # Zjechanie z trasy: kilka odczytów 150 m na wschód od osi => przeliczenie
    page.evaluate('''() => { const n = window.__nav; n.S.sim.stop(); n.S.sim = null;
      const t0 = Date.now(); for (let i = 0; i < 4; i++) n.onFix({lng: 22.5521, lat: 51.2 + 0.0535, speed: 10, accuracy: 5, heading: 0, t: t0 + i*1000}); }''')
    page.wait_for_timeout(1500)
    print('PO ZJAZDZIE:', page.inner_text('#toast') if page.is_visible('#toast') else 'brak toastu', '| tras:', page.evaluate('window.__nav.S.routes.length'))
    page.click('#btn-end')
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/8-after.png')
    br.close()

print('BŁĘDY KONSOLI:', len(errors))
for e in errors[:15]: print('  ', e[:300])
