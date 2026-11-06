"""Drogi i budynki z kafli OpenFreeMap dla obszaru miasta: plik pomocniczy dla build-city.py i build-trees.py.
Użycie: python3 tools/road-context.py <katalog_kafli_miasta> <wyjście.pkl>"""
import gzip, json, pickle, ssl, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import mapbox_vector_tile as mvt
OUT, DST = sys.argv[1], sys.argv[2]
GRID = 400.0; W = 40075016.68; z = 14; S = W / 2 ** z
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
op = urllib.request.build_opener(urllib.request.ProxyHandler(), urllib.request.HTTPSHandler(context=ctx))
get = lambda u: op.open(urllib.request.Request(u, headers={'User-Agent': 'nawigacja-build'}), timeout=30).read()
tmpl = json.loads(get('https://tiles.openfreemap.org/planet'))['tiles'][0]
t = json.load(open(f'{OUT}/index.json'))['tiles']
xs = [a[0] for a in t]; ys = [a[1] for a in t]
tx0 = int((min(xs) * GRID + W / 2) // S); tx1 = int(((max(xs) + 1) * GRID + W / 2) // S)
ty0 = int((W / 2 - (max(ys) + 1) * GRID) // S); ty1 = int((W / 2 - min(ys) * GRID) // S)
def one(a):
    tx, ty = a
    try: raw = get(tmpl.replace('{z}', '14').replace('{x}', str(tx)).replace('{y}', str(ty)))
    except Exception as e: print('brak', tx, ty, e); return None
    if raw[:2] == b'\x1f\x8b': raw = gzip.decompress(raw)
    d = mvt.decode(raw, default_options={'y_coord_down': True})
    ox = tx * S - W / 2; oy = W / 2 - ty * S
    cv = lambda c: (ox + c[0] / 4096 * S, oy - c[1] / 4096 * S)
    roads, blds, polys = [], [], []
    for f in d.get('transportation', {}).get('features', []):
        c = f['properties'].get('class'); g = f['geometry']
        if c in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway'):
            for l in ([g['coordinates']] if g['type'] == 'LineString' else g['coordinates'] if g['type'] == 'MultiLineString' else []):
                roads.append((c, [cv(q) for q in l]))
    def rings(g):
        if g['type'] == 'Polygon': return [g['coordinates']]
        if g['type'] == 'MultiPolygon': return g['coordinates']
        return []
    for f in d.get('building', {}).get('features', []):
        for p in rings(f['geometry']): blds.append([cv(q) for q in p[0]])
    for lay, cls in (('landcover', {'wood', 'forest', 'grass'}), ('park', None)):
        for f in d.get(lay, {}).get('features', []):
            c = f['properties'].get('class')
            if cls is not None and c not in cls: continue
            for p in rings(f['geometry']): polys.append((c or 'park', [[cv(q) for q in r] for r in p]))
    return roads, blds, polys
res = []
with ThreadPoolExecutor(6) as ex:
    res = list(ex.map(one, [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]))
res = [r for r in res if r]
out = {'roads': [x for r in res for x in r[0]], 'buildings': [x for r in res for x in r[1]], 'polys': [x for r in res for x in r[2]]}
pickle.dump(out, open(DST, 'wb'))
print('kafli', len(res), 'dróg', len(out['roads']), 'budynków', len(out['buildings']), 'zieleni', len(out['polys']))
