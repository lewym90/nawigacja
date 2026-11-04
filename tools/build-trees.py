"""Drzewa do własnej mapy: lasy, parki i trawniki z kafli OpenFreeMap + szpalery wzdłuż ulic.
Omija budynki (z kafli miasta) i jezdnie. Użycie: python3 tools/build-trees.py <katalog_kafli>
Plik <x>_<y>.t.bin: f32 [x, y, wysokość_m, rodzaj], rodzaj 0 świerk, 1 liściaste, część ułamkowa = odcień."""
import gzip, json, math, os, random, ssl, struct, sys, urllib.request
from collections import defaultdict
import numpy as np
import mapbox_vector_tile as mvt
from PIL import Image, ImageDraw
from shapely.geometry import shape, Point, LineString
OUT = sys.argv[1]; GRID = 400.0; PX = 2.0; N = int(GRID / PX); W = 40075016.68
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
op = urllib.request.build_opener(urllib.request.ProxyHandler(), urllib.request.HTTPSHandler(context=ctx))
get = lambda u: op.open(urllib.request.Request(u, headers={'User-Agent': 'nawigacja-build'}), timeout=30).read()
tmpl = json.loads(get('https://tiles.openfreemap.org/planet'))['tiles'][0]
idx = json.load(open(f'{OUT}/index.json')); tiles = {tuple(t) for t in idx['tiles']}
xs = [t[0] for t in tiles]; ys = [t[1] for t in tiles]
masks = {}
def mask(k):
    if k not in masks:
        im = Image.new('1', (N, N)); d = ImageDraw.Draw(im); p = f'{OUT}/{k[0]}_{k[1]}.bin'
        if os.path.exists(p):
            b = open(p, 'rb').read(); b = gzip.decompress(b) if b[:2] == b'\x1f\x8b' else b; nw, nr = struct.unpack('<II', b[:8])
            r = np.frombuffer(b, np.float32, nr * 4, 8 + nw * 24).reshape(-1, 4)
            for t in r[:, :2].reshape(-1, 3, 2):
                d.polygon([(float(a) / PX, float(c) / PX) for a, c in t], fill=1)
        masks[k] = im
    return masks[k]
def blocked(x, y):
    k = (int(x // GRID), int(y // GRID)); im = mask(k)
    px = int((x - k[0] * GRID) / PX); py = int((y - k[1] * GRID) / PX)
    return any(0 <= px + a < N and 0 <= py + b < N and im.getpixel((px + a, py + b)) for a in (-2, 0, 2) for b in (-2, 0, 2))
z = 14; S = W / 2 ** z
tx0 = int((min(xs) * GRID + W / 2) // S); tx1 = int(((max(xs) + 1) * GRID + W / 2) // S)
ty0 = int((W / 2 - (max(ys) + 1) * GRID) // S); ty1 = int((W / 2 - min(ys) * GRID) // S)
polys = []; roads = []; rnd = random.Random(5)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        try: raw = get(tmpl.replace('{z}', str(z)).replace('{x}', str(tx)).replace('{y}', str(ty)))
        except Exception as e: print('brak', tx, ty, e); continue
        if raw[:2] == b'\x1f\x8b': raw = gzip.decompress(raw)
        d = mvt.decode(raw, default_options={'y_coord_down': True})
        ox = tx * S - W / 2; oy = W / 2 - ty * S
        conv = lambda c: (ox + c[0] / 4096 * S, oy - c[1] / 4096 * S)
        def walk(g):
            if g['type'] == 'Polygon': return [[[conv(c) for c in r] for r in g['coordinates']]]
            if g['type'] == 'MultiPolygon': return [[[conv(c) for c in r] for r in p] for p in g['coordinates']]
            return []
        for lay, cls in (('landcover', {'wood', 'forest', 'grass'}), ('park', None)):
            for f in d.get(lay, {}).get('features', []):
                c = f['properties'].get('class')
                if cls is not None and c not in cls: continue
                for p in walk(f['geometry']):
                    polys.append((c or 'park', shape({'type': 'Polygon', 'coordinates': p}).buffer(0)))
        for f in d.get('transportation', {}).get('features', []):
            c = f['properties'].get('class'); g = f['geometry']
            if c in ('minor', 'tertiary', 'secondary', 'primary'):
                ls = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates'] if g['type'] == 'MultiLineString' else []
                for l in ls: roads.append((c, LineString([conv(q) for q in l])))
print('wielokąty', len(polys), 'drogi', len(roads))
ROAD = {'minor': 5, 'tertiary': 9, 'secondary': 10, 'primary': 13}  # połowa pasa drogi z zapasem: drzewo nie może zasłaniać trasy
rmask = {}
def rmark(l, w):
    for i in range(0, int(l.length) + 1, 2):
        p = l.interpolate(i); k = (int(p.x // GRID), int(p.y // GRID))
        im = rmask.setdefault(k, Image.new('1', (N, N)))
        px = (p.x - k[0] * GRID) / PX; py = (p.y - k[1] * GRID) / PX; r = w / PX
        ImageDraw.Draw(im).ellipse((px - r, py - r, px + r, py + r), fill=1)
for c, l in roads: rmark(l, ROAD[c] + 1)
def onroad(x, y):
    k = (int(x // GRID), int(y // GRID)); im = rmask.get(k)
    if im is None: return False
    px = int((x - k[0] * GRID) / PX); py = int((y - k[1] * GRID) / PX)
    return 0 <= px < N and 0 <= py < N and im.getpixel((px, py))
out = defaultdict(list)
def plant(x, y, kind, h):
    k = (int(x // GRID), int(y // GRID))
    if k not in tiles and not (min(xs) <= k[0] <= max(xs) and min(ys) <= k[1] <= max(ys)): return
    if len(out[k]) >= 420 or blocked(x, y) or onroad(x, y): return
    out[k].append((x - k[0] * GRID, y - k[1] * GRID, h, kind + rnd.random() * 0.9))
DENS = {'wood': 120, 'forest': 120, 'park': 420, 'grass': 900}
for c, p in polys:
    n = min(int(p.area / DENS.get(c, 420)), 4000); a, b, e, f = p.bounds
    for _ in range(n):
        x = rnd.uniform(a, e); y = rnd.uniform(b, f)
        if p.contains(Point(x, y)): plant(x, y, 0 if (c in ('wood', 'forest') and rnd.random() < 0.45) else 1, rnd.uniform(9, 19))
for c, l in roads:
    off = ROAD[c] + 4; dist = rnd.uniform(0, 12)
    while dist < l.length:
        p = l.interpolate(dist); q = l.interpolate(min(l.length, dist + 2))
        dx, dy = q.x - p.x, q.y - p.y; L = math.hypot(dx, dy) or 1
        s = rnd.choice((-1, 1))
        if rnd.random() < 0.8: plant(p.x - dy / L * off * s, p.y + dx / L * off * s, 1, rnd.uniform(7, 13))
        dist += rnd.uniform(14, 30)
tot = 0
for k, v in out.items():
    a = np.array(v, dtype=np.float32); tot += len(v)
    with gzip.open(f'{OUT}/{k[0]}_{k[1]}.t.bin', 'wb', 9) as f: f.write(a.tobytes())
print('drzew', tot, 'kafli', len(out))
json.dump({'grid': GRID, 'tiles': idx['tiles'], 'trees': [list(k) for k in out]}, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
