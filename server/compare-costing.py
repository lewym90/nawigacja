#!/usr/bin/env python3
"""Porównuje trasy z Twojej Valhalli dla tych samych dwóch punktów przy różnych ustawieniach kosztów.
Użycie: python3 compare-costing.py LAT1 LNG1 LAT2 LNG2
Wynik pokazuje, czy ustawienia aplikacji (kolumna „aplikacja”) skracają objazdy względem domyślnych."""
import json, sys, urllib.parse, urllib.request

a, b, c, d = map(float, sys.argv[1:5])

def route(costing, opts=None, alts=0):
    body = {'locations': [{'lat': a, 'lon': b}, {'lat': c, 'lon': d}], 'costing': costing,
            'directions_options': {'language': 'pl-PL'}}
    if opts is not None:
        body['costing_options'] = opts
    if alts:
        body['alternates'] = alts
    url = 'http://127.0.0.1:8002/route?json=' + urllib.parse.quote(json.dumps(body))
    try:
        t = json.load(urllib.request.urlopen(url, timeout=30))['trip']
    except Exception as e:
        return f'błąd: {e}'
    return f"{t['summary']['length']*1000:6.0f} m  {t['summary']['time']/60:5.1f} min  {len(t['legs'][0]['maneuvers']):2d} manewrów"

APP = {'pedestrian': {'pedestrian': {'walkway_factor': 1, 'sidewalk_factor': 1, 'alley_factor': 1, 'driveway_factor': 1, 'use_living_streets': 1, 'use_tracks': 0.6}}}
print('PIESZO')
print('  domyślne Valhalli :', route('pedestrian'))
print('  aplikacja         :', route('pedestrian', APP['pedestrian']))
print('  najkrótsza (shortest):', route('pedestrian', {'pedestrian': {'shortest': True}}))
print('AUTO')
print('  domyślne Valhalli :', route('auto'))
print('  mało kar za serwisowe:', route('auto', {'auto': {'service_penalty': 5, 'use_living_streets': 0.8}}))
