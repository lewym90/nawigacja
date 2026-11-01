#!/usr/bin/env python3
"""Pokazuje, jak Twoja Valhalla i OpenStreetMap opisują drogi wokół punktu (kto może nimi iść/jechać).
Użycie: python3 inspect-edges.py LAT LNG [PROMIEŃ_M, domyślnie 70]"""
import json, sys, urllib.parse, urllib.request

lat, lng = float(sys.argv[1]), float(sys.argv[2])
R = int(sys.argv[3]) if len(sys.argv) > 3 else 70

def loc(costing):
    body = {'locations': [{'lat': lat, 'lon': lng, 'radius': R}], 'costing': costing, 'verbose': True}
    url = 'http://127.0.0.1:8002/locate?json=' + urllib.parse.quote(json.dumps(body))
    return json.load(urllib.request.urlopen(url, timeout=30))

ways = {}
for costing in ('pedestrian', 'auto'):
    for res in loc(costing):
        for e in res.get('edges', []):
            ei = e.get('edge_info', {})
            wid = ei.get('way_id')
            if wid is None:
                continue
            w = ways.setdefault(wid, {'names': ei.get('names'), 'use': e.get('edge', {}).get('use'), 'class': e.get('edge', {}).get('classification', {}).get('classification') if isinstance(e.get('edge', {}).get('classification'), dict) else e.get('edge', {}).get('classification'), 'ped': False, 'auto': False, 'len': 0})
            acc = e.get('edge', {}).get('access', {})
            w['ped'] = w['ped'] or bool(acc.get('pedestrian'))
            w['auto'] = w['auto'] or bool(acc.get('car'))
            w['len'] = max(w['len'], e.get('edge', {}).get('length', 0))
print(f'Dróg w promieniu {R} m: {len(ways)}\n')
tags = {}
ids = ','.join(str(i) for i in ways)
q = f'[out:json][timeout:25];way(id:{ids});out tags;'
for host in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'):
    try:
        req = urllib.request.Request(host, data=urllib.parse.urlencode({'data': q}).encode(),
                                     headers={'User-Agent': 'nawigacja-test/1.0 (github.com/lewym90/nawigacja)'})
        for el in json.load(urllib.request.urlopen(req, timeout=40))['elements']:
            tags[el['id']] = el.get('tags', {})
        break
    except Exception as e:
        print('Overpass:', e)
for wid, w in sorted(ways.items(), key=lambda kv: -kv[1]['len']):
    t = tags.get(wid, {})
    keep = {k: t[k] for k in ('highway', 'service', 'access', 'foot', 'motor_vehicle', 'vehicle', 'oneway', 'surface', 'sidewalk', 'name') if k in t}
    print(f"way {wid}: valhalla use={w['use']} pieszo={'tak' if w['ped'] else 'NIE'} auto={'tak' if w['auto'] else 'NIE'}  OSM={keep}")
