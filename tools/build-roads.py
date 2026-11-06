"""Siatka dróg z BDOT10k: prawdziwe szerokości, nawierzchnie, chodniki, krawężniki i linie, scalone w czyste skrzyżowania.
Użycie: python3 tools/build-roads.py <powiat_GML.zip> <katalog_kafli>
Kafel <x>_<y>.r.bin (gzip): u32 liczba_trójkątów_wierzch, u32 liczba_wierzch_linii,
 powierzchnie [x,y,rodzaj] f32 (0 chodnik, 1 krawężnik, 2 asfalt, 3 kostka, 4 żwir), linie [x,y,u,rodzaj] f32 (0 ciągła, 1 przerywana)."""
import gzip, json, math, re, struct, sys, zipfile
from collections import defaultdict
import numpy as np
import mapbox_earcut as earcut
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, box
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
SRC, OUT = sys.argv[1:3]; GRID = 400.0; M = 1 / math.cos(math.radians(51.2)); LANE = 3.3
to = Transformer.from_crs(2180, 3857, always_xy=True)
z = zipfile.ZipFile(SRC)
read = lambda k: z.read([i.filename for i in z.infolist() if f'__{k}.xml' in i.filename][0]).decode('utf8', 'ignore')
FEAT = lambda k: re.finditer(rf'<ot:{k}\s+gml:id.*?</ot:{k}>', read(k), re.S)
tag = lambda x, t: (re.search(rf'<ot:{t}[^>]*>([^<]+)', x) or [None, ''])[1]
def line(x):
    out = []
    for p in re.findall(r'<gml:posList[^>]*>([^<]+)<', x):
        v = list(map(float, p.split())); a = np.array(v).reshape(-1, 2); mx, my = to.transform(a[:, 0], a[:, 1]); out += list(zip(mx, my))
    return LineString(out) if len(out) > 1 else None
asphalt, cobble, gravel, axes = [], [], [], []
for m in FEAT('OT_SKJZ_L'):
    x = m.group(0); L = line(x)
    if L is None or tag(x, 'kategoriaIstnienia') not in ('', 'eksploatowany') or 'tunel' in tag(x, 'polozenie'): continue
    w = float(tag(x, 'szerokoscNawierzchni') or tag(x, 'szerokosc') or 5); w = max(2.8, min(w, 16)); mat = tag(x, 'materialNawierzchni'); cl = tag(x, 'klasaDrogi')
    P = L.buffer(w / 2 * M, quad_segs=6)
    (asphalt if 'bitumiczna' in mat else cobble if 'kostka' in mat or 'płyty' in mat else gravel).append(P)
    if 'bitumiczna' in mat and 'wewnętrzna' not in cl and w >= 5: axes.append((L, w, cl))
print('jezdnie', len(asphalt), len(cobble), len(gravel), 'osie', len(axes), flush=True)
A = unary_union(asphalt); C = unary_union(cobble).difference(A); G = unary_union(gravel).difference(unary_union([A, C]))
R = unary_union([A, C, G]); KERB = R.buffer(0.3 * M, quad_segs=3).difference(R)
print('scalone', flush=True)
paths = []
for m in FEAT('OT_SKRP_L'):
    L = line(m.group(0))
    if L is not None: paths.append(L.buffer(max(1.5, float(tag(m.group(0), 'szerokosc') or 2)) / 2 * M, quad_segs=3))
W = unary_union(paths).difference(R.buffer(0.3 * M)); print('chodniki', flush=True)
# linie: pomijamy kawałki przy skrzyżowaniach, gdzie jezdnie się przecinają
tree = STRtree([a[0] for a in axes]); nodes = []
for i, (L, w, c) in enumerate(axes):
    for j in tree.query(L):
        if j <= i: continue
        p = L.intersection(axes[j][0])
        for g in getattr(p, 'geoms', [p]):
            if g.geom_type == 'Point': nodes.append(g.buffer((max(w, axes[j][1]) * 0.75 + 3) * M))
J = unary_union(nodes + [a for a in []]); print('węzły', len(nodes), flush=True)
marks = defaultdict(list)
def addline(g, kind):
    for l in getattr(g, 'geoms', [g]):
        if l.geom_type != 'LineString' or l.length < 8: continue
        c = np.array(l.coords); s = np.r_[0, np.cumsum(np.hypot(*(c[1:] - c[:-1]).T))]
        n = np.array(c[1:] - c[:-1]); n = np.stack([-n[:, 1], n[:, 0]], 1) / np.maximum(np.hypot(n[:, 0], n[:, 1]), 1e-6)[:, None]
        hw = 0.075 * M
        for i in range(len(c) - 1):
            a, b = c[i], c[i + 1]; k = (int(((a[0] + b[0]) / 2) // GRID), int(((a[1] + b[1]) / 2) // GRID)); ox, oy = k[0] * GRID, k[1] * GRID; d = n[i] * hw
            q = [(a + d, s[i]), (a - d, s[i]), (b - d, s[i + 1]), (a + d, s[i]), (b - d, s[i + 1]), (b + d, s[i + 1])]
            marks[k] += [(p[0] - ox, p[1] - oy, u / M, kind) for p, u in q]
for L, w, c in axes:
    two = w >= 5
    L2 = L.simplify(0.3)
    H = (w / 2 - 0.25) * M
    for sgn in (-1, 1):
        try: addline(L2.parallel_offset(H, 'left' if sgn < 0 else 'right', join_style=1).difference(J), 0)
        except Exception: pass
    lanes = max(2, round(w / LANE))
    for k in range(1, lanes):
        o = (k - lanes / 2) * (w / lanes) * M
        if abs(o) < 0.05: g = L2
        else:
            try: g = L2.parallel_offset(abs(o), 'left' if o < 0 else 'right', join_style=1)
            except Exception: continue
        addline(g.difference(J), 1)
print('linie', sum(len(v) for v in marks.values()) // 6, flush=True)
idx = json.load(open(f'{OUT}/index.json')); xs = [t[0] for t in idx['tiles']]; ys = [t[1] for t in idx['tiles']]
surf = [(W, 0), (KERB, 1), (A, 2), (C, 3), (G, 4)]
parts = [(np.array(g.simplify(0.25).exterior.coords)) for g in []]
polys = []
for geom, kind in surf:
    for g in getattr(geom, 'geoms', [geom]):
        if g.geom_type == 'Polygon' and not g.is_empty: polys.append((g.simplify(0.25), kind))
t2 = STRtree([p for p, _ in polys]); tot = 0; done = []
x0 = min(xs) - 5; x1 = max(xs) + 5; y0 = min(ys) - 5; y1 = max(ys) + 5
for tx in range(x0, x1 + 1):
    for ty in range(y0, y1 + 1):
        b = (tx * GRID, ty * GRID, (tx + 1) * GRID, (ty + 1) * GRID); v = []
        for i in t2.query(box(*b)):
            p, kind = polys[i]; c = shapely.clip_by_rect(p, *b)
            for g in getattr(c, 'geoms', [c]):
                if g.geom_type != 'Polygon' or g.is_empty or g.area < 0.3: continue
                rings = [np.array(g.exterior.coords)[:-1]] + [np.array(r.coords)[:-1] for r in g.interiors]
                pts = np.concatenate(rings); ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
                for k in earcut.triangulate_float64(pts, ends): v.append((pts[k, 0] - b[0], pts[k, 1] - b[1], kind))
        m = marks.get((tx, ty), [])
        if not v and not m: continue
        a = np.array(v, dtype=np.float32).reshape(-1, 3); l = np.array(m, dtype=np.float32).reshape(-1, 4)
        with gzip.open(f'{OUT}/{tx}_{ty}.r.bin', 'wb', 9) as f: f.write(struct.pack('<II', len(a), len(l)) + a.tobytes() + l.tobytes())
        tot += len(a) + len(l); done.append([tx, ty])
idx['roads'] = done; json.dump(idx, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
print('kafli dróg', len(done), 'wierzchołków', tot)
