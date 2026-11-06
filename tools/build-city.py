"""Własna mapa 3D: modele budynków GUGiK (CityGML LoD2) -> lekkie kafle binarne dla silnika js/city3d.js.
Użycie: python3 tools/build-city.py <powiat_gml.zip> <katalog_wyjściowy> [kontekst.pkl]
Z kontekstem (tools/road-context.py) pomija budynki z modeli, które leżą na dzisiejszej jezdni i nie istnieją już w OSM: modele są z 2017 r.
Kafel: siatka 400 m w metrach Web Mercator. Plik: u32 liczba_wierzch_ścian, u32 liczba_wierzch_dachów, potem
ściany [x,y,z,u,v,cell] f32 i dachy [x,y,z,rodzaj] f32. Pozycje względem narożnika kafla, trójkąty bez indeksów."""
import gzip, json, math, os, re, struct, sys, zipfile
from collections import defaultdict
import numpy as np
import mapbox_earcut as earcut
from pyproj import Transformer

GRID = 400.0
SRC, OUT = sys.argv[1], sys.argv[2]
ROADW = {'motorway': 13, 'trunk': 13, 'primary': 11, 'secondary': 9, 'tertiary': 7}  # połowa jezdni w metrach Mercatora
road_tree = None
if len(sys.argv) > 3:
    import pickle
    from shapely.geometry import LineString, Polygon, MultiPoint
    from shapely.strtree import STRtree
    ctxd = pickle.load(open(sys.argv[3], 'rb'))
    rl = [(c, LineString(l)) for c, l in ctxd['roads'] if c in ROADW and len(l) > 1]
    road_tree = STRtree([l.buffer(ROADW[c], cap_style=2) for c, l in rl])
    ob = []
    for p in ctxd['buildings']:
        try:
            q = Polygon(p).buffer(0)
            if not q.is_empty: ob.append(q)
        except Exception: pass
    bld_tree = STRtree(ob)
skipped = 0
def stale(xy):
    """Bryła wchodzi na jezdnię, a OSM nie zna tam budynku: to budynek wyburzony po 2017 r."""
    f = MultiPoint([tuple(p) for p in xy]).convex_hull
    if f.geom_type != 'Polygon' or f.area < 8: return False
    hits = road_tree.query(f.buffer(-1.5), predicate='intersects')
    if not len(hits): return False
    cov = sum(f.intersection(ob[i]).area for i in bld_tree.query(f)) / f.area
    return cov < 0.3
to3857 = Transformer.from_crs(2180, 3857, always_xy=True)
LAT = 51.2; MERC = 1 / math.cos(math.radians(LAT))
BLD = re.compile(rb'<bldg:Building .*?</bldg:Building>', re.S)
SURF = re.compile(rb'<bldg:(RoofSurface|WallSurface)\b.*?</bldg:\1>', re.S)
RING = re.compile(rb'<gml:exterior>(.*?)</gml:exterior>', re.S)
POS = re.compile(rb'<gml:pos[^>]*>([^<]+)<')
WIDTH = [8.0, 12.0, 13.0, 14.0]  # house, tenement, block, office: szerokość jednego powtórzenia tekstury w metrach
walls, roofs = defaultdict(list), defaultdict(list)

def tri(pts):
    n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
    for i in range(2, len(pts)):
        n = np.cross(pts[1] - pts[0], pts[i] - pts[0])
        if np.linalg.norm(n) > 1e-6: break
    drop = int(np.argmax(np.abs(n)))
    p2 = np.delete(pts, drop, axis=1).astype(np.float64)
    return earcut.triangulate_float64(p2, np.array([len(pts)], dtype=np.uint32))

count = 0
z = zipfile.ZipFile(SRC)
for info in z.infolist():
    if info.file_size == 0: continue
    data = z.read(info)
    for b in BLD.finditer(data):
        body = b.group(0)
        surfaces = []
        for s in SURF.finditer(body):
            kind = s.group(1)
            for r in RING.finditer(s.group(0)):
                pts = np.array([[float(v) for v in p.split()] for p in POS.findall(r.group(1))])
                if len(pts) >= 4 and np.allclose(pts[0], pts[-1]): pts = pts[:-1]
                if len(pts) >= 3: surfaces.append((kind, pts))
        if not surfaces: continue
        if road_tree is not None:
            allp = np.concatenate([p for _, p in surfaces])
            mx0, my0 = to3857.transform(allp[:, 0], allp[:, 1])
            if stale(np.stack([mx0, my0], 1)):
                skipped += 1
                continue
        allz = np.concatenate([p[:, 2] for _, p in surfaces])
        base, top = allz.min(), allz.max(); h = top - base
        kind_i = 0 if h < 9 else 1 if h < 16 else 2 if h < 34 else 3
        idn = abs(hash(body[:90])) % 3
        cell = kind_i * 3 + idn
        c = np.concatenate([p for _, p in surfaces])[:, :2].mean(0)
        cx, cy = to3857.transform(c[0], c[1])
        tile = (int(cx // GRID), int(cy // GRID)); ox, oy = tile[0] * GRID, tile[1] * GRID
        pitched = 0.0
        for kind, pts in surfaces:
            mx, my = to3857.transform(pts[:, 0], pts[:, 1])
            P = np.stack([mx - ox, my - oy, (pts[:, 2] - base) * MERC], 1)
            try: idx = tri(P)
            except Exception: continue
            if kind == b'WallSurface':
                d = P[1:] - P[:-1]; k = int(np.argmax(np.hypot(d[:, 0], d[:, 1])))
                e = d[k, :2]; L = np.hypot(*e) or 1; e = e / L
                u = ((P[:, 0] - P[0, 0]) * e[0] + (P[:, 1] - P[0, 1]) * e[1]) / MERC / WIDTH[kind_i]
                v = (pts[:, 2] - base) / WIDTH[kind_i]
                for i in idx: walls[tile].append((P[i, 0], P[i, 1], P[i, 2], u[i], v[i], cell))
            else:
                n = np.cross(P[1] - P[0], P[2] - P[0]); nn = np.linalg.norm(n)
                if nn and abs(n[2]) / nn < 0.97: pitched = 1.0
                for i in idx: roofs[tile].append((P[i, 0], P[i, 1], P[i, 2], float(hash(body[:80]) % 3) + 3 * (abs(n[2]) / (nn or 1) < 0.97)))
        count += 1
os.makedirs(OUT, exist_ok=True)
index = []; total = 0
for t in sorted(set(walls) | set(roofs)):
    w = np.array(walls.get(t, []), dtype=np.float32); r = np.array(roofs.get(t, []), dtype=np.float32)
    with open(f'{OUT}/{t[0]}_{t[1]}.bin', 'wb') as f:
        f.write(gzip.compress(struct.pack('<II', len(w), len(r)) + w.tobytes() + r.tobytes(), 9))
    index.append(list(t)); total += 8 + w.nbytes + r.nbytes
json.dump({'grid': GRID, 'tiles': index}, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
print('pominięte wyburzone', skipped)
print('budynków', count, 'kafli', len(index), 'MB', total // 1024 ** 2)
