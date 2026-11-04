"""Prawdziwy Lublin: prawdziwe kafelki i Valhalla, symulacja z szumem GPS, pomiar kamery i zrzuty.
Użycie: python3 test/browser/real.py <katalog> [day|night] [sekundy]"""
import json, os, re, sys, threading, http.server, socketserver, functools, ssl, urllib.request, statistics as st
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/real'
THEME = sys.argv[2] if len(sys.argv) > 2 else 'day'
SECS = int(sys.argv[3]) if len(sys.argv) > 3 else 30
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ctxssl = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt')
opener = urllib.request.build_opener(urllib.request.ProxyHandler(), urllib.request.HTTPSHandler(context=ctxssl))
cache = {}
def forward(route):
    rq = route.request
    if '127.0.0.1' in rq.url: return route.continue_()
    if 'overpass' in rq.url: return route.fulfill(status=503, headers={'access-control-allow-origin': '*'}, body=b'')
    key = rq.url if rq.method == 'GET' else None
    if key in cache: s, h, b = cache[key]; return route.fulfill(status=s, headers=h, body=b)
    try:
        hdr = {k: v for k, v in rq.headers.items() if k.lower() in ('content-type', 'accept')}
        hdr['User-Agent'] = 'nawigacja-test'
        r = opener.open(urllib.request.Request(rq.url, data=rq.post_data_buffer, method=rq.method, headers=hdr), timeout=12)
        b = r.read(); s = r.status
        h = {'access-control-allow-origin': '*', 'content-type': r.headers.get('content-type', 'application/octet-stream')}
        if r.headers.get('content-encoding'): h['content-encoding'] = r.headers['content-encoding']
        if key: cache[key] = (s, h, b)
        route.fulfill(status=s, headers=h, body=b)
    except urllib.error.HTTPError as e: route.fulfill(status=e.code, headers={'access-control-allow-origin': '*'}, body=e.read())
    except Exception: route.fulfill(status=503, headers={'access-control-allow-origin': '*'}, body=b'')

START = (51.1905, 22.5465); DEST = [22.5680, 51.2477]
errors = []
SAMPLE = """() => { const m = window.__nav.map; const s = window.__cam = []; let on = true; window.__camStop = () => { on = false; };
  const f = (t) => { if (!on) return; const c = m.getCenter(); s.push([t, m.getBearing(), m.getPitch(), m.getZoom(), m.getRoll ? m.getRoll() : 0, c.lng, c.lat]); requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
# szum jak na prawdziwym telefonie: pozycja ±4 m, kurs ±7°, prędkość ±1 m/s
NOISE = """() => { const s = window.__nav.S.sim; const o = s.onFix; let r = 1; const n = () => { r = (r * 16807) % 2147483647; return (r / 2147483647 - 0.5) * 2; };
  s.onFix = (f) => o({ ...f, lat: f.lat + n() * 3.6e-5, lng: f.lng + n() * 5.7e-5, heading: f.heading == null ? f.heading : (f.heading + n() * 7 + 360) % 360, speed: Math.max(0, (f.speed || 0) + n()) }); }"""
with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, geolocation={'latitude': START[0], 'longitude': START[1]}, permissions=['geolocation'], locale='pl-PL', service_workers='block')
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.route('https://photon.komoot.io/**', lambda r: r.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}, body=json.dumps({'features': [{'geometry': {'coordinates': DEST}, 'properties': {'name': 'Stare Miasto', 'street': 'Rynek', 'housenumber': '1', 'city': 'Lublin'}}]})))
    page.route(re.compile(r'^https?://(?!127\.0\.0\.1|photon)'), forward)
    page.add_init_script("localStorage.setItem('nav.settings', JSON.stringify({theme: '%s'}))" % THEME)
    page.goto(f'http://127.0.0.1:{PORT}/index.html')
    page.wait_for_function('window.__nav && window.__nav.map && window.__nav.map.isStyleLoaded()', timeout=30000)
    page.wait_for_timeout(1500)
    page.fill('#q', 'Stare Miasto')
    page.wait_for_selector('#results button:has-text("Stare Miasto")', timeout=8000)
    page.click('#results button:has-text("Stare Miasto")')
    page.wait_for_selector('.route-card', timeout=20000)
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/{THEME}-preview.png')
    print('trasa ok', flush=True)
    page.click('#btn-sim')
    page.wait_for_timeout(4000)
    SPEEDUP = int(os.environ.get('SPEEDUP', '1'))
    page.evaluate("(k) => { const S = window.__nav.S; S.simSpeedup = k; S.sim.speedup = k; S.sim.start(); }", SPEEDUP)
    page.evaluate(NOISE)
    page.evaluate("window.__nav.S.sim.along = 1500")
    page.wait_for_timeout(7000)
    page.screenshot(path=f'{OUT}/{THEME}-a.png')
    page.evaluate(SAMPLE)
    page.wait_for_timeout(SECS * 1000)
    page.evaluate('window.__camStop()')
    d = page.evaluate('window.__cam')
    ang = lambda a, b: ((b - a + 540) % 360) - 180
    rates = [ang(d[i][1], d[i + 1][1]) / max(1e-3, (d[i + 1][0] - d[i][0]) / 1000) for i in range(len(d) - 1)]
    acc = [abs(rates[i + 1] - rates[i]) for i in range(len(rates) - 1)]
    sign = sum(1 for i in range(len(rates) - 1) if rates[i] * rates[i + 1] < 0 and abs(rates[i]) > 0.3 and abs(rates[i + 1]) > 0.3)
    dz = sum(abs(d[i + 1][3] - d[i][3]) for i in range(len(d) - 1)); dp = sum(abs(d[i + 1][2] - d[i][2]) for i in range(len(d) - 1))
    print(json.dumps({'klatek': len(d), 'fps': round(len(d) / (max(1, d[-1][0] - d[0][0]) / 1000), 1), 'kurs_std_deg_s': round(st.pstdev(rates), 2), 'zryw_sr': round(st.mean(acc), 2), 'odwrocen_kursu': sign, 'roll_max': round(max(abs(x[4]) for x in d), 2), 'zoom_przebieg': round(dz, 2), 'pitch_przebieg': round(dp, 2), 'pitch': round(d[-1][2], 1), 'zoom': round(d[-1][3], 2)}, ensure_ascii=False))
    print('BŁĘDY:', errors[:6], flush=True)
    json.dump(d, open(f'{OUT}/{THEME}-cam.json', 'w'))
    page.screenshot(path=f'{OUT}/{THEME}-b.png')
    print('stan', page.evaluate("(() => { const S = window.__nav.S; return { mode: S.mode, nav: !!S.nav, sim: !!S.sim, along: S.sim && S.sim.along, dist: S.sim && S.sim.route.distance }; })()"), flush=True)
    page.evaluate("(() => { const s = window.__nav.S.sim; if (s) s.along = Math.max(0, s.route.distance - 1800); })()")
    page.wait_for_timeout(12000)
    page.screenshot(path=f'{OUT}/{THEME}-c.png')
    br.close()
