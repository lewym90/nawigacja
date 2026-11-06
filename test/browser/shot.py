"""Zdjęcia tego samego miejsca w starym i nowym wyglądzie, z prawdziwą trasą i kamerą jazdy.
Użycie: python3 test/browser/shot.py <katalog> <cache.pkl> [old|new] [day|night]"""
import json, math, os, pickle, re, ssl, sys, threading, http.server, socketserver, functools, urllib.request
from playwright.sync_api import sync_playwright
OUT, CACHE, LOOK, THEME = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else 'day'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
op = urllib.request.build_opener(urllib.request.ProxyHandler(), urllib.request.HTTPSHandler(context=ctx))
cache = pickle.load(open(CACHE, 'rb')) if os.path.exists(CACHE) else {}
def forward(route):
    u = route.request.url
    if u in cache: s, h, b = cache[u]; return route.fulfill(status=s, headers=h, body=b)
    try:
        r = op.open(urllib.request.Request(u, headers={'User-Agent': 'nawigacja-test'}), timeout=15); b = r.read()
        h = {'access-control-allow-origin': '*', 'content-type': r.headers.get('content-type', 'application/octet-stream')}
        if r.headers.get('content-encoding'): h['content-encoding'] = r.headers['content-encoding']
        cache[u] = (200, h, b); route.fulfill(status=200, headers=h, body=b)
    except Exception: route.fulfill(status=503, headers={'access-control-allow-origin': '*'}, body=b'')
def valhalla(a, b):
    body = {'locations': [{'lat': a[0], 'lon': a[1]}, {'lat': b[0], 'lon': b[1]}], 'costing': 'auto'}
    key = json.dumps(body)
    if key not in cache:
        cache[key] = json.load(op.open(urllib.request.Request('https://188-68-247-201.sslip.io/valhalla/route', data=key.encode(), headers={'Content-Type': 'application/json'}), timeout=40))
    s = cache[key]['trip']['legs'][0]['shape']; i = 0; la = lo = 0; o = []
    while i < len(s):
        for ax in (0, 1):
            sh = r = 0
            while True:
                c = ord(s[i]) - 63; i += 1; r |= (c & 31) << sh; sh += 5
                if c < 32: break
            d = ~(r >> 1) if r & 1 else r >> 1
            if ax == 0: la += d
            else: lo += d
        o.append([lo / 1e6, la / 1e6])
    return o
SPOTS = {'vivo': ((51.2440, 22.5760), (51.2560, 22.5790), (51.2482, 22.5760)), 'centrum': ((51.2462, 22.5470), (51.2487, 22.5640), (51.2475, 22.5530)),
         'osiedle': ((51.2300, 22.5300), (51.2420, 22.5400), (51.2360, 22.5345)), 'cassino': ((51.2402, 22.5096), (51.2560, 22.5120), (51.2425, 22.5075))}
with sync_playwright() as p:
    br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    c = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, locale='pl-PL', service_workers='block')
    page = c.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route(re.compile(r'^https://(tiles\.openfreemap\.org)'), forward)
    page.route(re.compile(r'^https://(overpass|188-68|photon|router|valhalla1)'), lambda r: r.fulfill(status=503, headers={'access-control-allow-origin': '*'}, body=b''))
    page.add_init_script("localStorage.setItem('nav.settings', JSON.stringify({theme: '%s', look100: true, look110: true, newLook: %s}))" % (THEME, 'true' if LOOK == 'new' else 'false'))
    page.goto(f'http://127.0.0.1:{PORT}/index.html')
    page.wait_for_function("window.__nav && window.__nav.map && window.__nav.map.getLayer('sel-line')", timeout=40000)
    for name, (a, b, near) in SPOTS.items():
        if len(sys.argv) > 5 and name not in sys.argv[5]: continue
        pts = valhalla(a, b); k = min(range(len(pts) - 1), key=lambda i: math.hypot(pts[i][0] - near[1], pts[i][1] - near[0]))
        j = k
        while j < len(pts) - 1 and math.hypot((pts[j][0] - pts[k][0]) * 70000, (pts[j][1] - pts[k][1]) * 111000) < 90: j += 1
        brg = math.degrees(math.atan2((pts[j][0] - pts[k][0]) * 0.626, pts[j][1] - pts[k][1]))
        page.evaluate("""([pts, k, brg, new_]) => { const m = window.__nav.map; document.body.classList.add('driving');
          for (const id of ['search', 'hint', 'fabs']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
          try { m.setVerticalFieldOfView(50); } catch {}
          if (m.getLayer('road-label') && new_) m.setLayoutProperty('road-label', 'visibility', 'none');
          m.getSource('sel').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.slice(k) } });
          for (const id of ['sel-line', 'sel-glow']) m.setPaintProperty(id, 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, '#00D9FF', 1, '#00D9FF']);
          const S = window.__nav.S; if (S.city && new_) { S.mode = 'nav'; S.cityCover = true; S.city.setRoute(pts); S.city.along = 0; window.__nav.roadLabels(); const K = 1 / Math.cos(pts[0][1] * Math.PI / 180); let L = 0; for (let i = 1; i <= k; i++) L += Math.hypot((pts[i][0] - pts[i - 1][0]) * 111320 * Math.cos(pts[0][1] * Math.PI / 180), (pts[i][1] - pts[i - 1][1]) * 110570); S.city.along = L; }
          const h = innerHeight; if (new_) { const pad = { top: Math.round(h * 0.46), bottom: 40 }; const cy = pad.top + (h - pad.top - pad.bottom) / 2; const y = cy - (h / 2 / Math.tan(25 * Math.PI / 180)) * Math.tan((90 - 68) * Math.PI / 180); document.documentElement.style.setProperty('--horizon', y + 'px'); } m.jumpTo({ center: pts[k], bearing: brg, pitch: new_ ? 68 : 73, zoom: 18.2, padding: { top: Math.round(h * 0.46), bottom: 40, left: 0, right: 0 } }); }""", [pts, k, brg, LOOK == 'new'])
        page.wait_for_timeout(25000 if not os.environ.get('FAST') else 9000)
        page.evaluate("window.__nav.map.triggerRepaint()"); page.wait_for_timeout(2500)
        page.screenshot(path=f'{OUT}/{name}-{LOOK}-{THEME}.png'); print(name, 'ok', flush=True)
        if os.environ.get('SEQ'):
            for q in range(1, 7):
                k2 = min(len(pts) - 2, k + q * int(os.environ['SEQ']))
                page.evaluate("([p, b]) => { window.__nav.map.jumpTo({ center: p, bearing: b }); }", [pts[k2], math.degrees(math.atan2((pts[min(k2 + 6, len(pts) - 1)][0] - pts[k2][0]) * 0.626, pts[min(k2 + 6, len(pts) - 1)][1] - pts[k2][1]))])
                page.wait_for_timeout(5000); page.screenshot(path=f'{OUT}/{name}-seq{q}.png')
        pickle.dump(cache, open(CACHE, 'wb'))
    print('błędy', errs[:3]); br.close()
