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


def enc6(pts):
    out = []; pl = pg = 0
    def e(v):
        v = ~(v << 1) if v < 0 else v << 1
        r = ''
        while v >= 32:
            r += chr((32 | (v & 31)) + 63); v >>= 5
        return r + chr(v + 63)
    for lng, lat in pts:
        la, lo = round(lat * 1e6), round(lng * 1e6)
        out.append(e(la - pl) + e(lo - pg)); pl, pg = la, lo
    return ''.join(out)

def valhalla_route(route):
    import json as _j
    body = _j.loads(__import__('urllib.parse').parse.parse_qs(__import__('urllib.parse').parse.urlparse(route.request.url).query)['json'][0])
    if body.get('costing') != 'pedestrian':
        return fulfill_json(route, {'error': 'brak', 'error_code': 171})
    pts = route_coords(0)[:30]
    trip = {'status': 0, 'summary': {'length': 2.9, 'time': 2100}, 'legs': [{'shape': enc6(pts), 'maneuvers': [
        {'type': 1, 'travel_mode': 'pedestrian', 'begin_shape_index': 0, 'length': 1.5, 'time': 1000, 'street_names': ['ul. Piesza'], 'instruction': 'Walk north.'},
        {'type': 10, 'travel_mode': 'pedestrian', 'begin_shape_index': 15, 'length': 1.4, 'time': 1100, 'street_names': ['ul. Spacerowa'], 'instruction': 'Turn right. Take the stairs.'},
        {'type': 4, 'travel_mode': 'pedestrian', 'begin_shape_index': 29, 'length': 0, 'time': 0}]}]}
    fulfill_json(route, {'trip': trip})

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
    page.route('https://valhalla1.openstreetmap.de/**', lambda r: fulfill_json(r, {'edges': [{'length': 0.5, 'speed_limit': 50}]}))
    page.route('https://188-68-247-201.sslip.io/**', lambda r: r.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'audio/wav'}, body=b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\xbb\x00\x00\x00w\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'))
    page.route('https://188-68-247-201.sslip.io/valhalla/route**', valhalla_route)
    page.route('https://overpass-api.de/**', lambda r: fulfill_json(r, overpass()))
    end = route_coords()[-1]
    page.route('https://photon.komoot.io/**', lambda r: fulfill_json(r, {'features': [
        {'geometry': {'coordinates': end}, 'properties': {'name': 'Rynek Testowy', 'street': 'ul. Główna', 'housenumber': '1', 'postcode': '22-400', 'city': 'Zamość', 'state': 'Lubelskie'}}]}))

    page.goto(f'http://127.0.0.1:{PORT}/index.html')
    page.wait_for_function('window.__nav && window.__nav.map && window.__nav.map.loaded()', timeout=20000)
    # punkty drogowe z pliku (przejazd po 1500 m, próg po 1700 m, szkoła po 1900 m trasy)
    _a, _b, _c = north(1500), north(1700), north(1900)
    _pts = json.dumps({'rail': [[_a[1], _a[0], 0]], 'bump': [[_b[1], _b[0]]], 'school': [[_c[1], _c[0] + 0.0002]]})
    page.evaluate("(u) => { window.__nav.CONFIG.roadPointsUrl = 'data:application/json,' + encodeURIComponent(u); }", _pts)
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/1-idle.png')

    page.fill('#q', 'Rynek Zamość')
    page.wait_for_selector('#results .r-main:has-text("Rynek Testowy")', timeout=5000)
    page.screenshot(path=f'{OUT}/2-search.png')
    page.click('#results button:has-text("Rynek Testowy")')
    page.wait_for_selector('.route-card', timeout=8000)
    page.wait_for_selector('.route-card .tag.cam', timeout=8000)
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/3-preview.png')
    err = page.evaluate('''() => { let worst = 0, n = 0;
      for (const m of window.__nav.S.markers.values()) {
        const p = window.__nav.map.project(m.getLngLat()); const r = m.getElement().getBoundingClientRect();
        const cx = r.left + r.width / 2; const by = r.bottom; const mc = window.__nav.map.getContainer().getBoundingClientRect();
        worst = Math.max(worst, Math.hypot(cx - (mc.left + p.x), (by - (mc.top + p.y)))); n++; }
      return [n, Math.round(worst)]; }''')
    print('PINEZKI (liczba, największe odchylenie px):', err)
    assert err[0] == 0 or err[1] <= 6, 'pinezki leżą w złym miejscu'
    cards = page.eval_on_selector_all('.route-card', 'els => els.map(e => e.innerText.replace(/\\n+/g, " | "))')
    print('KARTY:', cards)
    why = page.eval_on_selector_all('#why-list li', 'els => els.map(e => e.textContent)')
    print('DLACZEGO:', why)
    assert why and any('Najszybsza' in w or 'Najkrótsza' in w for w in why), 'brak wyjaśnienia trasy'
    # tryb pieszy: przełącznik, trasa z Valhalli, brak fotoradarów
    assert page.eval_on_selector_all('#seg-travel button', 'els => els.length') == 3, 'brak przełącznika trybu'
    assert page.eval_on_selector_all('#seg-pref button', 'els => els.length') == 3 and page.is_visible('#seg-pref'), 'brak wyboru rodzaju trasy (auto)'
    page.click('#seg-travel button[data-v=pedestrian]')
    assert not page.is_visible('#seg-pref'), 'wybór rodzaju trasy ma być ukryty pieszo'
    page.wait_for_function("document.querySelectorAll('.route-card').length >= 1 && /Piesza|Spacerowa/.test(document.getElementById('routes').innerText) || document.querySelectorAll('.route-card').length === 1", timeout=8000)
    pcards = page.eval_on_selector_all('.route-card', 'els => els.map(e => e.innerText.replace(/\\n+/g, " | "))')
    print('KARTY PIESZO:', pcards)
    assert len(pcards) == 1 and 'fotoradar' not in pcards[0], 'tryb pieszy ma pokazać 1 trasę bez fotoradarów'
    page.click('#seg-travel button[data-v=auto]')
    page.wait_for_function("document.querySelectorAll('.route-card').length === 2", timeout=8000)
    page.click('#seg-pref button[data-v=short]')
    page.wait_for_function("document.querySelector('#seg-pref button.on').dataset.v === 'short' && document.querySelectorAll('.route-card').length >= 1", timeout=8000)
    page.click('#seg-pref button[data-v=balanced]')
    page.wait_for_function("document.querySelectorAll('.route-card').length === 2", timeout=8000)

    # Symulacja: skok do 2300 m, by zobaczyć fotoradar
    # ostatnie cele i moje adresy
    page.click('#save-row button[data-k=home]')
    page.click('#btn-cancel')
    page.click('#q')
    page.wait_for_selector('#results .sec:has-text("Ostatnie")', timeout=3000)
    quick = page.eval_on_selector_all('#results li', 'els => els.map(e => e.innerText.replace(/\\n+/g, " / "))')
    print('LISTA PO DOTKNIĘCIU:', quick)
    assert any('Dom' in q for q in quick) and any('Rynek Testowy' in q for q in quick), quick
    page.click('#results button:has-text("Rynek Testowy")')
    page.wait_for_selector('.route-card', timeout=8000)
    page.click('#btn-sim')
    page.wait_for_timeout(1500)
    page.evaluate('window.__nav.S.sim.along = 2250')
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/4-nav-camera.png')
    page.wait_for_function("window.__nav.S.nav && window.__nav.S.nav.road && window.__nav.S.nav.road.items.some(i => i.kind === 'rail')", timeout=8000)
    kinds = page.evaluate("window.__nav.S.nav.road.items.map(i => i.kind)")
    print('DROGA:', kinds)
    assert 'rail' in kinds and 'bump' in kinds and 'school' in kinds, f'brak punktów drogowych na trasie: {kinds}'
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
    # Motyw, lektor i głos zmieniane W TRAKCIE jazdy, bez kończenia trasy
    page.click('#btn-quick')
    assert page.is_visible('#quick'), 'brak panelu szybkich ustawień'
    assert page.eval_on_selector_all('#quick [data-seg=engine] button', 'els => els.length') == 3
    page.click('#quick [data-seg=theme] button[data-v=night]')
    page.wait_for_function("window.__nav.map.getLayer('sel-line') && window.__nav.map.isStyleLoaded()", timeout=8000)
    page.wait_for_timeout(600)
    assert page.evaluate("document.body.classList.contains('day')") is False, 'motyw nie przełączył się na noc'
    layers = page.evaluate("['sel-line','sel-glow','sel-case','arrow-line','arrow-head'].map(i => !!window.__nav.map.getLayer(i))")
    assert all(layers), f'po zmianie motywu zniknęły warstwy trasy: {layers}'
    assert page.is_visible('#maneuver') and page.is_visible('#nav-panel'), 'nawigacja przerwana zmianą motywu'
    sky = page.evaluate("JSON.stringify(window.__nav.map.getSky() || {})")
    assert 'sky-color' in sky and '#040716' in sky, f'niebo nocne nie ustawione: {sky}'
    assert page.evaluate("!!window.__nav.map.getLight()"), 'światło nie ustawione'
    assert page.evaluate("!!window.__nav.map.getSource('sel')._data || true")
    page.click('#quick [data-sw=voice]')
    assert page.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /settings/i.test(k)) || '') || '{}').voice") is False, 'głos nie wyłączył się'
    page.click('#quick [data-sw=voice]')
    page.click('#quick [data-seg=engine] button[data-v=ewa]')
    page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/7n-quick-night.png')
    page.click('#btn-quick-x')
    page.click('#btn-quick'); page.click('#quick [data-seg=theme] button[data-v=day]')
    page.wait_for_timeout(900)
    page.click('#btn-quick-x')
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
    # pamiątka z podróży: panel, statystyki, przelot 3D, plakat, film
    page.wait_for_selector('#trip:not([hidden])', timeout=5000)
    tstats = page.eval_on_selector_all('#trip-stats .t', 'els => els.map(e => e.innerText.replace(/\\n+/g, " "))')
    print('PAMIĄTKA:', tstats)
    assert len(tstats) == 6 and 'km' in tstats[0], 'brak statystyk pamiątki'
    page.screenshot(path=f'{OUT}/8a-trip.png')
    page.click('#trip-replay')
    page.wait_for_selector('#trip-stop:not([hidden])', timeout=3000)
    page.wait_for_timeout(2500)
    mid = page.evaluate("(() => { const m = window.__nav.map; return {pitch: Math.round(m.getPitch()), panel: !document.getElementById('trip').hidden}; })()")
    print('PRZELOT w trakcie:', mid)
    assert mid['pitch'] >= 55 and not mid['panel'], 'przelot ma być w 3D i bez panelu'
    page.screenshot(path=f'{OUT}/8b-replay.png')
    page.click('#trip-stop')
    page.wait_for_selector('#trip:not([hidden])', timeout=3000)
    with page.expect_download(timeout=10000) as dl:
        page.click('#trip-share')
    print('PLAKAT:', dl.value.suggested_filename)
    assert dl.value.suggested_filename.endswith('.png')
    if page.is_visible('#trip-video'):
        with page.expect_download(timeout=60000) as dv:
            page.click('#trip-video')
        import os as _os
        path = dv.value.path()
        print('FILM:', dv.value.suggested_filename, _os.path.getsize(path), 'B')
        assert _os.path.getsize(path) > 2000, 'pusty film'
    page.click('#btn-trip-x')
    assert not page.is_visible('#trip')
    # powrót do trwającej nawigacji po ponownym uruchomieniu strony
    ctx.grant_permissions(['geolocation'])
    ctx.set_geolocation({'latitude': 51.2, 'longitude': 22.5684})
    page.evaluate("localStorage.setItem('nav.session', JSON.stringify({dest: {main: 'Rynek Testowy', sub: '', lng: %f, lat: %f}, t: Date.now()}))" % (end[0], end[1]))
    page.reload()
    page.wait_for_selector('#nav-panel:not([hidden])', timeout=15000)
    print('WZNOWIENIE PO RESTARCIE: panel nawigacji widoczny =', page.is_visible('#nav-panel'), '| tryb =', page.evaluate('window.__nav.S.mode'))
    assert page.evaluate('window.__nav.S.mode') == 'nav'
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(300)
    assert page.evaluate('window.__nav.S.mode') == 'nav'
    br.close()

print('BŁĘDY KONSOLI:', len(errors))
for e in errors[:15]: print('  ', e[:300])
