#!/usr/bin/env python3
"""Szuka w pobliżu schodów (OSM highway=steps), do których Twoja Valhalla prowadzi pieszo,
i podaje współrzędne do wpisania w polu celu w aplikacji (do testu komunikatu o schodach).
Użycie: python3 find-stairs.py LAT LNG   (Twoja pozycja z Ustawienia → Diagnostyka)"""
import json, sys, urllib.parse, urllib.request

lat, lng = float(sys.argv[1]), float(sys.argv[2])
R = 1500
q = f'[out:json][timeout:25];way(around:{R},{lat},{lng})[highway=steps];out center 40;'
els = None
for host in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'):
    req = urllib.request.Request(host, data=urllib.parse.urlencode({'data': q}).encode(),
                                 headers={'User-Agent': 'nawigacja-test/1.0 (github.com/lewym90/nawigacja)'})
    try:
        els = json.load(urllib.request.urlopen(req, timeout=40))['elements']
        break
    except Exception as e:
        print(f'{host}: {e}')
if els is None:
    sys.exit('Overpass nie odpowiada. Spróbuj za chwilę.')
print(f'Schodów OSM w promieniu {R} m: {len(els)}')
found = 0
for e in els:
    c = e.get('center')
    if not c:
        continue
    body = {'locations': [{'lat': lat, 'lon': lng}, {'lat': c['lat'], 'lon': c['lon']}], 'costing': 'pedestrian',
            'directions_options': {'language': 'pl-PL'}}
    url = 'http://127.0.0.1:8002/route?json=' + urllib.parse.quote(json.dumps(body))
    try:
        trip = json.load(urllib.request.urlopen(url, timeout=20))['trip']
    except Exception:
        continue
    ms = trip['legs'][0]['maneuvers']
    hit = [m['instruction'] for m in ms if any(w in m['instruction'].lower() for w in ('schod', 'stair', 'steps'))]
    if hit:
        found += 1
        print(f"\nWpisz w polu celu:  {c['lat']:.5f}, {c['lon']:.5f}   ({trip['summary']['length']:.2f} km pieszo)")
        print('  Valhalla mówi:', hit[0])
        if found >= 3:
            break
if not found:
    print('Nie znalazłem trasy ze schodami blisko tej pozycji. Podaj inną pozycję albo powiększ promień.')
