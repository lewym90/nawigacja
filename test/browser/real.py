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
        r = opener.open(urllib.request.Request(rq.url, data=rq.post_data_buffer, method=rq.method, headers=hdr), timeout=20)
        b = r.read(); s = r.status
        h = {'access-control-allow-origin': '*', 'content-type': r.headers.get('content-type', 'application/octet-stream')}
        if r.headers.get('content-encoding'): h['content-encoding'] = r.headers['content-encoding']
        if key: cache[key] = (s, h, b)
        route.fulfill(status=s, headers=h, body=b)
    except urllib.error.HTTPError as e: route.fulfill(status=e.code, headers={'access-control-allow-origin': '*'}, body=e.read())
    except Exception: route.fulfill(status=503, headers={'access-control-allow-origin': '*'}, body=b'')

START = tuple(json.loads(os.environ.get('ROUTE_FROM', '[51.1905, 22.5465]'))); DEST = json.loads(os.environ.get('ROUTE_TO', '[22.5680, 51.2477]'))
errors = []
SAMPLE = """() => { const m = window.__nav.map; const s = window.__cam = []; let on = true; window.__camStop = () => { on = false; };
  const f = (t) => { if (!on) return; const c = m.getCenter(); s.push([t, m.getBearing(), m.getPitch(), m.getZoom(), m.getRoll ? m.getRoll() : 0, c.lng, c.lat]); requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
# szum jak na prawdziwym telefonie: pozycja ±4 m, kurs ±7°, prędkość ±1 m/s
NOISE = """() => { const s = window.__nav.S.sim; const o = s.onFix; let r = 1; const n = () => { r = (r * 16807) % 2147483647; return (r / 2147483647 - 0.5) * 2; };
  s.onFix = (f) => o({ ...f, lat: f.lat + n() * 3.6e-5, lng: f.lng + n() * 5.7e-5, heading: f.heading == null ? f.heading : (f.heading + n() * 7 + 360) % 360, speed: Math.max(0, (f.speed || 0) + n()) }); }"""
with sync_playwright() as p:
    br = p.chromium.launch(proxy={'server': os.environ['HTTPS_PROXY'], 'bypass': '127.0.0.1'}, args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, geolocation={'latitude': START[0], 'longitude': START[1]}, permissions=['geolocation'], locale='pl-PL', service_workers='block', ignore_https_errors=True, extra_http_headers={})
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    def photon(r):
        pick = 'wawinek' in r.request.url or 'awinek' in r.request.url
        f = {'geometry': {'coordinates': [22.5150, 51.2640] if pick else DEST}, 'properties': {'name': 'Sławinek' if pick else 'Stare Miasto', 'city': 'Lublin'}}
        r.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}, body=json.dumps({'features': [f]}))
    page.route('https://photon.komoot.io/**', photon)
    page.route('https://overpass-api.de/**', lambda r: r.fulfill(status=503, headers={'access-control-allow-origin': '*'}, body=b''))
    page.route(re.compile(r'^https?://(?!127\.0\.0\.1|photon|mapy\.geoportal|overpass)'), forward)
    orto = []
    page.on('response', lambda r: orto.append(r.status) if 'ORTO' in r.url else None)
    page.add_init_script("localStorage.setItem('nav.settings', JSON.stringify({theme: '%s', ...%s}))" % (THEME, os.environ.get('SETTINGS', '{}')))
    page.goto(f'http://127.0.0.1:{PORT}/index.html' + ('?nowy=1' if os.environ.get('NOWY') else ''))
    page.wait_for_function("window.__nav && window.__nav.map && window.__nav.map.getLayer('sel-line')", timeout=30000)
    page.wait_for_timeout(1500)
    page.click('#btn-menu')
    page.evaluate("document.getElementById('menu').scrollTop = 99999")
    page.wait_for_timeout(300)
    box = page.locator('#btn-menu-x').bounding_box()
    page.screenshot(path=f'{OUT}/{THEME}-menu.png')
    assert box and box['y'] >= 0, f'zamknięcie poza ekranem {box}'
    page.click('#btn-menu-x', timeout=3000)
    assert page.is_hidden('#menu'), 'menu nie zamknęło się'
    print('MENU zamknięte po przewinięciu', box, flush=True)
    page.fill('#q', 'Stare Miasto')
    page.wait_for_selector('#results button:has-text("Stare Miasto")', timeout=8000)
    page.click('#results button:has-text("Stare Miasto")')
    page.wait_for_selector('.route-card', timeout=20000)
    page.wait_for_timeout(1500)
    page.wait_for_timeout(5000)
    print('KARTY', page.inner_text('#routes').replace('\n', ' | '), '| wyjazd', page.is_visible('#seg-depart'), flush=True)
    page.screenshot(path=f'{OUT}/{THEME}-preview.png')
    if os.environ.get('PICK'):
        page.click('#p-from'); page.fill('#q', 'Sławinek'); page.wait_for_selector('#results button:has-text("Sławinek")', timeout=8000)
        page.click('#results button:has-text("Sławinek")')
        page.wait_for_function("document.getElementById('p-from-name').textContent === 'Sławinek' && document.getElementById('toast').hidden", timeout=20000)
        page.wait_for_timeout(6000)
        print('KARTY SKĄD', page.inner_text('#routes').replace('\n', ' | ')[:160], '|', page.inner_text('#go-txt'), flush=True)
        page.screenshot(path=f'{OUT}/{THEME}-from.png')
        page.click('#btn-sim'); page.wait_for_timeout(5000)
        print('SIM START', page.evaluate("(() => { const S = window.__nav.S; const c = S.sim.route.line.coords[0]; const p = S.lastFix; return { start: c, teraz: [p.lng, p.lat], tryb: S.mode }; })()"), flush=True)
        br.close(); sys.exit(0)
    cards = page.locator('.route-card').count()
    print('PANEL', page.evaluate("Math.round(document.getElementById('preview').offsetHeight / innerHeight * 100)"), '% ekranu, kart', cards, flush=True)
    if cards > 1 and not os.environ.get('NOCARDS'):
        for i in range(1, cards):
            page.locator('.route-card').nth(i).click(); page.wait_for_timeout(2500)
            page.screenshot(path=f'{OUT}/{THEME}-route{i}.png')
            print('WYBRANA', page.evaluate('window.__nav.S.sel'), flush=True)
        page.locator('.route-card').nth(0).click(); page.wait_for_timeout(800)
    print('trasa ok', flush=True)
    print('sim klik', flush=True)
    page.click('#btn-sim')
    print('sim ok', flush=True)
    page.wait_for_timeout(4000)
    SPEEDUP = int(os.environ.get('SPEEDUP', '1'))
    page.evaluate("(k) => { const S = window.__nav.S; S.simSpeedup = k; S.sim.speedup = k; S.sim.start(); }", SPEEDUP)
    print('szum', flush=True)
    page.evaluate("(() => { const s = window.__nav.S.sim; s.setSpeed(0.1); })()") if os.environ.get('PRELOAD') else None
    page.evaluate(NOISE)
    print('szum ok', flush=True)
    import time as _t
    if os.environ.get('NOLANE'):
        page.evaluate("for (const id of ['lane-div','lane-solid','lane-road']) window.__nav.map.setLayoutProperty(id,'visibility','none')")
    for _i in range(6):
        t0 = _t.time(); r = page.evaluate("(() => { const n = window.__nav.S.nav; return [(n.laneF||[]).length, (n.junctions||[]).length, Math.round(n.along||0)]; })()"); print('puls', round(_t.time()-t0,1), r, flush=True); page.wait_for_timeout(1500)
    page.wait_for_timeout(int(os.environ.get('PRELOAD', '0')) * 1000)
    page.evaluate("window.__nav.S.sim.along = %s; window.__nav.S.sim.setSpeed(45)" % os.environ.get('FIRST', '1500'))
    page.wait_for_timeout(int(os.environ.get('SETTLE', '0')) * 1000)
    page.wait_for_timeout(7000)
    print('A', page.evaluate("(() => { const e = document.getElementById('m-lanes'); const S = window.__nav.S; return { widoczne: !e.hidden, n: e.querySelectorAll('.lane').length, on: e.querySelectorAll('.lane.on').length, along: Math.round(S.nav.along) }; })()"), flush=True)
    page.screenshot(path=f'{OUT}/{THEME}-a.png')
    print('A zrzut', flush=True)
    if os.environ.get('QUICK'):
        page.evaluate("document.getElementById('btn-quick').click()"); page.wait_for_timeout(1200); page.screenshot(path=f'{OUT}/{THEME}-quick.png')
        print('JAKOŚĆ', page.evaluate("(() => { const b = document.querySelector('#quick [data-seg=quality] button[data-v=high]'); b.click(); return { on: b.classList.contains('on'), pr: window.__nav.map.getPixelRatio() }; })()"), flush=True)
        page.evaluate("document.getElementById('btn-quick-x').click()")
    if os.environ.get('TOP'):
        page.evaluate("(() => { const S = window.__nav.S; S.follow = false; const m = window.__nav.map; m.jumpTo({ pitch: 45, zoom: 17.2, bearing: 20 }); })()"); page.wait_for_timeout(4000); page.screenshot(path=f'{OUT}/{THEME}-top.png'); br.close(); sys.exit(0)
    print('CEL', page.evaluate("(() => { const N = window.__nav.S.nav; return { skrz: (N.junctions||[]).slice(0,4).map(j => [Math.round(j.at), j.lanes.length, j.both, Math.round(j.back)]), teraz: N.targetJ ? Math.round(N.targetJ.at) : null, warstwa: !!window.__nav.map.getLayer('target-lane') }; })()"), flush=True)
    if os.environ.get('TOGGLE'):
        ST = "(() => { const m = window.__nav.map; const c = m.getLayer('city3d'); const i = c && (c.implementation || c); return { motyw: document.body.classList.contains('day') ? 'dzien' : 'noc', silnik_noc: i && i.night, pokrycie: i && i.cover, kafli: i && i.tiles && i.tiles.size, stare: m.getLayer('building-3d') ? m.getLayoutProperty('building-3d', 'visibility') : null, styl: m.getStyle().name, warstw_miasta: m.getStyle().layers.filter(l => l.id === 'city3d').length }; })()"
        print('PRZED', page.evaluate(ST), flush=True)
        for t in os.environ['TOGGLE'].split(','):
            page.evaluate("document.querySelector('#quick [data-seg=theme] button[data-v=%s]').click()" % t)
            page.wait_for_timeout(9000)
            print('PO', t, page.evaluate(ST), flush=True)
            page.screenshot(path=f'{OUT}/toggle-{t}.png')
    page.evaluate(SAMPLE)
    page.wait_for_timeout(SECS * 1000)
    print('orto', len(orto), orto[:6], flush=True)
    print('orto', len(orto), orto[:6], flush=True)
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
    page.wait_for_timeout(2500)
    print('pasy', page.evaluate("(() => { const st = window.__nav.S.sim.route.steps; return st.filter(x => x.lanes).map(x => [Math.round(x.at), x.lanes.length, x.toward || '']); })()"), flush=True)
    page.evaluate("(() => { const s = window.__nav.S.sim; const l = s.route.steps.filter(x => x.lanes && x.at > 1500); const J = window.__nav.S.nav.junctions || []; if (s) s.along = Math.max(0, %s); })()" % os.environ.get('JUMP', 's.route.distance - 1800'))
    page.wait_for_timeout(int(os.environ.get('WAITC', '12')) * 1000)
    print('CEL c', page.evaluate("(() => { const N = window.__nav.S.nav; return { along: Math.round(N.along), teraz: N.targetJ ? [Math.round(N.targetJ.at), N.targetJ.lanes.map(l => (l.on ? '*' : '') + l.angles.join('/')).join(' ')] : null }; })()"), flush=True)
    print('PASY NA EKRANIE', page.evaluate("(() => { const e = document.getElementById('m-lanes'); const S = window.__nav.S; return { widoczne: !e.hidden, n: e.querySelectorAll('.lane').length, on: e.querySelectorAll('.lane.on').length, along: Math.round(S.nav.along), skrz: (S.nav.junctions || []).slice(0, 6).map(j => [Math.round(j.at), j.lanes.length]), linii: (S.nav.laneF || []).length, tekst: document.getElementById('m-text').textContent }; })()"), flush=True)
    page.screenshot(path=f'{OUT}/{THEME}-c.png')
    br.close()
