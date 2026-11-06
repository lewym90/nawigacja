"""Drzewa z danych: pojedyncze i rzędy z BDOT10k, las tylko w lasach, parki rzadko. Bez sadzenia na trawnikach.
Użycie: python3 tools/build-trees-real.py <katalog_kafli> <kontekst.pkl> <bdot.pkl>"""
import gzip, json, math, os, pickle, random, struct, sys
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, shape
OUT = sys.argv[1]; GRID = 400.0; PX = 2.0; N = int(GRID / PX)
ctx = pickle.load(open(sys.argv[2], 'rb')); bd = pickle.load(open(sys.argv[3], 'rb'))
to = Transformer.from_crs(2180, 3857, always_xy=True); rnd = random.Random(7)
idx = json.load(open(f'{OUT}/index.json')); tiles = {tuple(t) for t in idx['tiles']}
masks = {}
def mask(k):
    if k not in masks:
        im = Image.new('1', (N, N)); d = ImageDraw.Draw(im); p = f'{OUT}/{k[0]}_{k[1]}.bin'
        if os.path.exists(p):
            b = gzip.decompress(open(p, 'rb').read()); nw, nr = struct.unpack('<II', b[:8])
            r = np.frombuffer(b, np.float32, nr * 4, 8 + nw * 24).reshape(-1, 4)
            for t in r[:, :2].reshape(-1, 3, 2): d.polygon([(float(a) / PX, float(c) / PX) for a, c in t], fill=1)
        masks[k] = im
    return masks[k]
ROAD = {'service': 4, 'busway': 7, 'minor': 6, 'tertiary': 10, 'secondary': 11, 'primary': 14, 'trunk': 17, 'motorway': 19}
rmask = {}
for c, l in ctx['roads']:
    if len(l) < 2: continue
    L = LineString(l); w = ROAD[c] + 1
    for i in range(0, int(L.length) + 1, 3):
        p = L.interpolate(i)
        for k in {(int((p.x + a) // GRID), int((p.y + b) // GRID)) for a in (-w, 0, w) for b in (-w, 0, w)}:
            im = rmask.setdefault(k, Image.new('1', (N, N)))
            x = (p.x - k[0] * GRID) / PX; y = (p.y - k[1] * GRID) / PX; r = w / PX
            ImageDraw.Draw(im).ellipse((x - r, y - r, x + r, y + r), fill=1)
def blocked(x, y):
    k = (int(x // GRID), int(y // GRID)); px = int((x - k[0] * GRID) / PX); py = int((y - k[1] * GRID) / PX)
    if not (0 <= px < N and 0 <= py < N): return True
    if k in rmask and rmask[k].getpixel((px, py)): return True
    im = mask(k)
    return any(0 <= px + a < N and 0 <= py + b < N and im.getpixel((px + a, py + b)) for a in (-2, 0, 2) for b in (-2, 0, 2))
out = defaultdict(list)
def plant(x, y, kind, h):
    if blocked(x, y): return
    k = (int(x // GRID), int(y // GRID))
    out[k].append((x - k[0] * GRID, y - k[1] * GRID, h, kind + rnd.random() * 0.9))
for p in bd['tree']:
    x, y = to.transform(*p); plant(x, y, 1, rnd.uniform(8, 15))
for r in bd['row']:
    a = np.array(r); xs, ys = to.transform(a[:, 0], a[:, 1]); L = LineString(zip(xs, ys)); d = rnd.uniform(0, 8)
    while d < L.length:
        q = L.interpolate(d); plant(q.x, q.y, 1, rnd.uniform(8, 14)); d += rnd.uniform(14, 24)
for r in bd['wood']:
    a = np.array(r); xs, ys = to.transform(a[:, 0], a[:, 1])
    try: P = Polygon(zip(xs, ys)).buffer(0)
    except Exception: continue
    if P.is_empty: continue
    n = min(int(P.area / 420), 2500); b = P.bounds
    for _ in range(n):
        x = rnd.uniform(b[0], b[2]); y = rnd.uniform(b[1], b[3])
        if P.contains(Point(x, y)): plant(x, y, 0 if rnd.random() < 0.5 else 1, rnd.uniform(12, 22))
for c, p in ctx['polys']:
    if c != 'park' : continue
    try: P = shape({'type': 'Polygon', 'coordinates': p}).buffer(0)
    except Exception: continue
    n = min(int(P.area / 2600), 400); b = P.bounds
    for _ in range(n):
        x = rnd.uniform(b[0], b[2]); y = rnd.uniform(b[1], b[3])
        if P.contains(Point(x, y)): plant(x, y, 1, rnd.uniform(9, 17))
tot = 0
for k, v in out.items():
    tot += len(v)
    with gzip.open(f'{OUT}/{k[0]}_{k[1]}.t.bin', 'wb', 9) as f: f.write(np.array(v, dtype=np.float32).tobytes())
json.dump({'grid': GRID, 'tiles': idx['tiles'], 'trees': [list(k) for k in out]}, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
print('drzew', tot, 'kafli', len(out))
