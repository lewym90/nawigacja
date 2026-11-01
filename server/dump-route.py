#!/usr/bin/env python3
"""Pokazuje, co Twoja Valhalla naprawdę zwraca dla trasy pieszo (manewry, kierunki, schody).
Użycie: python3 dump-route.py LAT1 LNG1 LAT2 LNG2"""
import json, sys, urllib.parse, urllib.request
a, b, c, d = map(float, sys.argv[1:5])
body = {'locations': [{'lat': a, 'lon': b}, {'lat': c, 'lon': d}], 'costing': 'pedestrian',
        'directions_options': {'language': 'pl-PL'}}
url = 'http://127.0.0.1:8002/route?json=' + urllib.parse.quote(json.dumps(body))
trip = json.load(urllib.request.urlopen(url, timeout=30))['trip']
ms = trip['legs'][0]['maneuvers']
print(f"{trip['summary']['length']:.2f} km, {len(ms)} manewrów\n")
for i, m in enumerate(ms):
    print(f"{i:2d} typ={m['type']:2d} {m.get('travel_mode','?'):10s} {m['length']*1000:6.0f} m  {m['instruction']}  | ulice={m.get('street_names') or m.get('begin_street_names')}")
print('\nPola manewru (pierwszy ze schodami lub pierwszy):')
pick = next((m for m in ms if 'schod' in m['instruction'].lower() or 'stair' in m['instruction'].lower()), ms[0])
print(json.dumps(pick, ensure_ascii=False))
