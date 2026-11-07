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
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=float(os.environ.get('DSF','1')), geolocation={'latitude': START[0], 'longitude': START[1]}, permissions=['geolocation'], locale='pl-PL', service_workers='block', ignore_https_errors=True, extra_http_headers={})
    page = ctx.new_page(); page.set_default_timeout(45000)
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
    page.click('#btn-menu-x')
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
    if os.environ.get('CAMS'):
        for name, H, D, AX in json.loads(os.environ['CAMS']):
            page.evaluate("""([H, D, AX]) => { const S = window.__nav.S; const m = window.__nav.map; S.follow = false; S.sim.setSpeed(0.1); m.setMaxZoom(24);
              const R = 6371000; const L = S.nav.route.line.coords; const toM = (a, c) => Math.hypot((c[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (c[1] - a[1]) * 110540);
              let k = 0; let w = 0; while (k < L.length - 2 && w + toM(L[k], L[k + 1]) < S.nav.along) { w += toM(L[k], L[k + 1]); k++; }
              const u = Math.min(1, (S.nav.along - w) / (toM(L[k], L[k + 1]) || 1)); const f = { lng: L[k][0] + (L[k + 1][0] - L[k][0]) * u, lat: L[k][1] + (L[k + 1][1] - L[k][1]) * u };
              let q = k + 1; while (q < L.length - 1 && toM(L[k + 1], L[q]) < 12) q++;
              const b = Math.atan2((L[q][0] - f.lng) * Math.cos((f.lat * Math.PI) / 180), L[q][1] - f.lat); const K = Math.cos((f.lat * Math.PI) / 180);
              const at = (d) => new maplibregl.LngLat(f.lng + ((d * Math.sin(b)) / (R * K)) * 180 / Math.PI, f.lat + ((d * Math.cos(b)) / R) * 180 / Math.PI);
              const dep = (AX * Math.PI) / 180; const cc = S.city; cc.ribbonW = 1.9; cc.setRoute(S.nav.route.line.coords); cc.along = S.nav.along; const pv = document.getElementById('puck-svg'); if (pv) pv.style.transform = 'none';
              const c = m.calculateCameraOptionsFromTo(at(-D), H, at(-D + H / Math.tan(dep)), 0);
              m.jumpTo({ ...c, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
              const p = m.project([f.lng, f.lat]); const e = document.getElementById('puck'); e.style.position = 'fixed'; e.style.left = p.x + 'px'; e.style.top = p.y + 'px'; e.style.transform = 'translate(-50%,-50%)';
              const hz = innerHeight / 2 - (innerHeight / 2 / Math.tan((m.getVerticalFieldOfView() * Math.PI) / 360)) * Math.tan(((90 - c.pitch) * Math.PI) / 180);
              document.documentElement.style.setProperty('--horizon', Math.max(0, hz) + 'px'); document.body.style.setProperty('--horizon', Math.max(0, hz) + 'px'); const hh = document.getElementById('haze'); if (hh) hh.style.display = 'none';
              return [c.pitch, c.zoom]; }""", [H, D, AX])
            page.wait_for_timeout(int(os.environ.get('CAMWAIT', '14')) * 1000); page.evaluate("window.__nav.map.triggerRepaint()"); page.wait_for_timeout(2000)
            page.screenshot(path=f'{OUT}/{THEME}-cam-{name}.png'); print('KAMERA', name, flush=True)
        sys.exit(0) if False else None
    if os.environ.get('DUMP'):
        d = page.evaluate("(() => { const N = window.__nav; const st = N.S.nav.route.steps.filter((x) => x.type === 'turn' && x.at > 120)[0]; const out = []; for (let s = 0; s < N.S.nav.route.line.total; s += 1) out.push(N.cam.path(s).point); return { at: st.at, m: st.modifier, p: N.cam.path(st.at).point, raw: N.S.nav.route.coords, out, path: { pts: N.S.city.path.pts, along: N.S.city.path.along, K: N.S.city.path.K }, turns: N.S.city.turns, fill: N.S.city.path.fill }; })()")
        json.dump(d, open(os.environ['DUMP'], 'w'))
    if os.environ.get('ROT'):
        page.evaluate("window.__rot = setInterval(() => { const N = window.__nav; N.S.city.carHd = N.map.getBearing() + 60; }, 1)")
        page.evaluate("(() => { const N = window.__nav; const f = N.S.city.drawPuck.bind(N.S.city); N.S.city.drawPuck = (gl) => { N.S.city.carHd = N.map.getBearing() + 60; f(gl); }; })()")
        page.wait_for_timeout(2500); page.screenshot(path=f'{OUT}/{THEME}-rot.png')
    if os.environ.get('HEADS'):
        for o in json.loads(os.environ['HEADS']):
            r = page.evaluate("""(o) => { const S = window.__nav.S; const st = S.nav.route.steps.filter((x) => x.type === 'turn' && new RegExp(o.turn).test(x.modifier || '') && x.at > 120)[0];
              S.city.setHeadStyle(o.style); S.sim.setSpeed(o.speed || 5); S.sim.along = st.at - o.car; document.querySelectorAll('#toast').forEach((e) => { e.style.display = 'none'; }); return [st.at, st.name]; }""", o)
            print('GROT', o['name'], r, flush=True)
            page.wait_for_timeout(int(os.environ.get('CAMWAIT', '10')) * 1000)
            page.screenshot(path=f"{OUT}/{THEME}-head-{o['name']}.png")
            print('KIER', page.evaluate("(() => { const N = window.__nav; return [N.S.city.carHd, N.map.getBearing(), N.cam.path(N.cam.s).bearing, N.cam.s, N.S.nav.along]; })()"), flush=True)
    if os.environ.get('ARROWS'):
        for o in json.loads(os.environ['ARROWS']):
            r = page.evaluate("""(o) => { const N = window.__nav; const S = N.S; const m = N.map; const cam = N.cam;
              const st = S.nav.route.steps.filter((x) => x.type === 'turn' && new RegExp(o.turn).test(x.modifier || '') && x.at > 120)[0]; const at = st.at;
              S.sim.setSpeed(5); S.sim.along = at - o.car - 16; S.city.ribbonOff = true; document.querySelectorAll('.turn-chip,.cross-chip,#toast').forEach((e) => { e.style.display = 'none'; }); S.closeUntil = at + 200;
              const P = (d) => cam.path(d).point; const shaft = []; for (let d = at - o.before; d <= at + o.after; d += 1.5) shaft.push(P(d));
              const e = cam.path(at + o.after); const b = (e.bearing * Math.PI) / 180; const k = 1 / (111320 * Math.cos((e.point[1] * Math.PI) / 180)); const q = 1 / 110540;
              const off = (f, r) => [e.point[0] + (Math.sin(b) * f + Math.cos(b) * r) * k, e.point[1] + (Math.cos(b) * f - Math.sin(b) * r) * q];
              const head = o.up ? [off(0, 0), off(0.01, 0), off(0, 0.01), off(0, 0)] : [off(0, o.w * 1.25), off(o.w * 2.4, 0), off(0, -o.w * 1.25), off(0, o.w * 1.25)];
              const W = (w) => ['interpolate', ['exponential', 2], ['zoom'], 16, w * 1.33, 22, w * 1.33 * 64];
              for (const id of ['arrow-case', 'arrow-line', 'arrow-head-case', 'arrow-head']) { m.setLayoutProperty(id, 'visibility', 'visible'); m.moveLayer(id); }
              m.setPaintProperty('arrow-case', 'line-color', o.edge); m.setPaintProperty('arrow-line', 'line-color', o.fill); m.setPaintProperty('arrow-head-case', 'line-color', o.edge); m.setPaintProperty('arrow-head', 'fill-color', o.fill);
              m.setPaintProperty('arrow-line', 'line-width', W(o.w)); m.setPaintProperty('arrow-case', 'line-width', W(o.w + o.e)); m.setPaintProperty('arrow-head-case', 'line-width', W(o.e));
              m.getSource('arrow').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: shaft } }, { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [head] } }] });
              document.querySelectorAll('.up-arrow').forEach((e) => e.remove());
              const mk = (html, pt, an) => { const el = document.createElement('div'); el.className = 'up-arrow'; el.innerHTML = html; el.style.pointerEvents = 'none'; new maplibregl.Marker({ element: el, anchor: an }).setLngLat(pt).addTo(m); return el; };
              setTimeout(() => { setInterval(() => document.querySelectorAll('.up-arrow').forEach((e) => { const t = e.style.transform; const q = /translate\((-?[\d.]+)px/.exec(t); if (q && +q[1] > innerWidth - 56) e.style.transform = t.replace(q[0], `translate(${innerWidth - 56}px`); }), 50);
                const dir = Math.atan2(m.project(P(at + o.after)).y - m.project(P(at + o.after - 7)).y, m.project(P(at + o.after)).x - m.project(P(at + o.after - 7)).x) * 180 / Math.PI;
                const sh = 'style="filter:drop-shadow(0 4px 6px rgba(0,0,0,.45))"';
                if (o.up === 1) mk(`<svg width="84" height="84" viewBox="0 0 84 84" ${sh}><g transform="rotate(${dir} 42 42)"><path d="M14 10 L76 42 L14 74 L28 42Z" fill="#fff" stroke="#071426" stroke-width="5" stroke-linejoin="round"/></g></svg>`, P(at + o.after + 3), 'center');
                if (o.up === 2) mk(`<svg width="84" height="118" viewBox="0 0 84 118" ${sh}><rect x="38" y="70" width="8" height="48" fill="#071426"/><rect x="4" y="4" width="76" height="76" rx="14" fill="#fff" stroke="#071426" stroke-width="5"/><path d="M30 62 V36 Q30 28 38 28 H50" fill="none" stroke="#071426" stroke-width="9"/><path d="M48 15 L66 28 L48 41Z" fill="#071426"/></svg>`, P(at + o.after + 3), 'bottom');
                if (o.up === 3) mk(`<svg width="150" height="70" viewBox="0 0 150 70" ${sh}><g transform="rotate(${dir > 90 || dir < -90 ? 180 : 0} 75 35)">${[0, 44, 88].map((x) => `<path d="M${x + 12} 8 L${x + 48} 35 L${x + 12} 62 L${x + 28} 35Z" fill="#fff" stroke="#071426" stroke-width="4" stroke-linejoin="round"/>`).join('')}</g></svg>`, P(at + o.after + 3), 'center');
              }, 9000);
              return [at, st.modifier, st.name]; }""", o)
            print('STRZAŁKA', o['name'], r, flush=True)
            page.wait_for_timeout(int(os.environ.get('CAMWAIT', '14')) * 1000); page.evaluate("window.__nav.map.triggerRepaint()"); page.wait_for_timeout(1500)
            page.screenshot(path=f"{OUT}/{THEME}-arr-{o['name']}.png")
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
    if os.environ.get('CLOSELOG'):
        page.evaluate("window.__cl = []; setInterval(() => { const S = window.__nav.S; window.__cl.push([Math.round(S.nav.along), +(S.closeK || 0).toFixed(2), Math.round(S.closeUntil ?? -1)]); }, 1000)")
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
    if os.environ.get('CLOSELOG'): print('CLOSE', page.evaluate('window.__cl'), flush=True)
    print('stan', page.evaluate("(() => { const S = window.__nav.S; return { mode: S.mode, nav: !!S.nav, sim: !!S.sim, along: S.sim && S.sim.along, dist: S.sim && S.sim.route.distance }; })()"), flush=True)
    page.wait_for_timeout(2500)
    print('pasy', page.evaluate("(() => { const st = window.__nav.S.sim.route.steps; return st.filter(x => x.lanes).map(x => [Math.round(x.at), x.lanes.length, x.toward || '']); })()"), flush=True)
    page.evaluate("(() => { const s = window.__nav.S.sim; const l = s.route.steps.filter(x => x.lanes && x.at > 1500); const J = window.__nav.S.nav.junctions || []; if (s) s.along = Math.max(0, %s); })()" % os.environ.get('JUMP', 's.route.distance - 1800'))
    page.wait_for_timeout(int(os.environ.get('WAITC', '12')) * 1000)
    print('CEL c', page.evaluate("(() => { const N = window.__nav.S.nav; return { along: Math.round(N.along), teraz: N.targetJ ? [Math.round(N.targetJ.at), N.targetJ.lanes.map(l => (l.on ? '*' : '') + l.angles.join('/')).join(' ')] : null }; })()"), flush=True)
    print('PASY NA EKRANIE', page.evaluate("(() => { const e = document.getElementById('m-lanes'); const S = window.__nav.S; return { widoczne: !e.hidden, n: e.querySelectorAll('.lane').length, on: e.querySelectorAll('.lane.on').length, along: Math.round(S.nav.along), skrz: (S.nav.junctions || []).slice(0, 6).map(j => [Math.round(j.at), j.lanes.length]), linii: (S.nav.laneF || []).length, tekst: document.getElementById('m-text').textContent }; })()"), flush=True)
    page.screenshot(path=f'{OUT}/{THEME}-c.png')
    br.close()
