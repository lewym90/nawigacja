"""Siatka dróg z BDOT10k: prawdziwe szerokości, nawierzchnie, chodniki, krawężniki i linie, scalone w czyste skrzyżowania.
Użycie: python3 tools/build-roads.py <powiat_GML.zip> <katalog_kafli> [crossing.json] [signals.json] [lamps.json] [parkingi.json ...]
Przejścia dla pieszych i parkingi z OSM (Overpass, out geom) są opcjonalne.
Kafel <x>_<y>.r.bin (gzip): u32 liczba_trójkątów_wierzch, u32 liczba_wierzch_linii,
 powierzchnie [x,y,rodzaj] f32 (0 chodnik, 1 krawężnik, 2 asfalt główne, 3 kostka, 4 żwir, 5 asfalt ulice dwukierunkowe zbiorcze, lokalne i osiedlowe od 5,5 m, 6 asfalt wąskie uliczki, 7 parkingi), linie [x,y,u,rodzaj] f32 (0 ciągła, 1 przerywana), potem opcjonalnie u32 liczba i krawężniki [x,y,z,s,nx,ny] f32:
 bok krawężnika (s 0..1 od dołu, normalna w stronę jezdni) i cień na jezdni przy nim (s<0, normalna 0),
 potem opcjonalnie u32 liczba i obiekty przy drodze [x,y,rodzaj,kierunek] f32 (0 latarnia, 1 sygnalizator; kierunek w radianach, w stronę, w którą patrzy).
Argumenty z OSM rozpoznawane po nazwie pliku: signals.json, lamps.json, crossing.json, reszta to parkingi.
Plik axes.bin (gzip): u32 liczba, potem dla każdej osi u32 punkty, f32 szerokość, f32 dwukierunkowa (0/1), u16 długość nazwy, nazwa utf-8, punkty [x,y] f32 względem index.axesOrg. Na niej dopasowuje się tor jazdy."""
import gzip, json, math, os, re, struct, sys, zipfile
from collections import defaultdict
import numpy as np
import mapbox_earcut as earcut
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
SRC, OUT = sys.argv[1:3]; GRID = 400.0; M = 1 / math.cos(math.radians(51.2)); LANE = 3.3
to = Transformer.from_crs(2180, 3857, always_xy=True)
_t4 = Transformer.from_crs(4326, 3857, always_xy=True)
to4326 = lambda lon, lat: _t4.transform(lon, lat)
z = zipfile.ZipFile(SRC)
read = lambda k: z.read([i.filename for i in z.infolist() if f'__{k}.xml' in i.filename][0]).decode('utf8', 'ignore')
FEAT = lambda k: re.finditer(rf'<ot:{k}\s+gml:id.*?</ot:{k}>', read(k), re.S)
tag = lambda x, t: (re.search(rf'<ot:{t}[^>]*>([^<]+)', x) or [None, ''])[1]
def line(x):
    out = []
    for p in re.findall(r'<gml:posList[^>]*>([^<]+)<', x):
        v = list(map(float, p.split())); a = np.array(v).reshape(-1, 2); mx, my = to.transform(a[:, 0], a[:, 1]); out += list(zip(mx, my))
    return LineString(out) if len(out) > 1 else None
asphalt, asphaltMid, asphaltMin, cobble, gravel, axes, allAxes = [], [], [], [], [], [], []
MAJOR = ('ekspresowa', 'przyśpieszonego', 'główna'); MID = ('zbiorcza', 'lokalna')
for m in FEAT('OT_SKJZ_L'):
    x = m.group(0); L = line(x)
    if L is None or tag(x, 'kategoriaIstnienia') not in ('', 'eksploatowany') or 'tunel' in tag(x, 'polozenie'): continue
    w = float(tag(x, 'szerokoscNawierzchni') or tag(x, 'szerokosc') or 5); w = max(2.8, min(w, 16)); mat = tag(x, 'materialNawierzchni'); cl = tag(x, 'klasaDrogi')
    P = L.buffer(w / 2 * M, quad_segs=6)
    # wygląd według szerokości: osiedlowa 7-metrowa ulica z dwoma pasami to zwykła ulica, choć w BDOT bywa „wewnętrzna”
    tier = 0 if any(k in cl for k in MAJOR) else 1 if any(k in cl for k in MID) or w >= 5.5 else 2
    ((asphalt, asphaltMid, asphaltMin)[tier] if 'bitumiczna' in mat else cobble if 'kostka' in mat or 'płyty' in mat else gravel).append(P)
    allAxes.append((L, w, tag(x, 'ulicaNazwa1'), tier))
    if 'bitumiczna' in mat and tier < 2 and w >= 5: axes.append((L, w, cl if any(k in cl for k in MAJOR + MID) else 'droga lokalna'))
print('jezdnie', len(asphalt), len(asphaltMid), len(asphaltMin), len(cobble), len(gravel), 'osie', len(axes), flush=True)
A = unary_union(asphalt); AM = unary_union(asphaltMid).difference(A); AS = unary_union(asphaltMin).difference(unary_union([A, AM])); AALL = unary_union([A, AM, AS])
C = unary_union(cobble).difference(AALL); G = unary_union(gravel).difference(unary_union([AALL, C]))
R = unary_union([AALL, C, G]); KERB = R.buffer(0.4 * M, quad_segs=3).difference(R)
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
ntree = STRtree(nodes); print('węzły', len(nodes), flush=True)
def cutJ(g):
    """Linia bez kawałków na skrzyżowaniach: odejmujemy tylko pobliskie węzły (całość naraz była bardzo wolna)."""
    near = ntree.query(g)
    return g.difference(unary_union([nodes[i] for i in near])) if len(near) else g
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
    local = 'lokalna' in c
    L2 = L.simplify(0.3)
    H = (w / 2 - 0.25) * M
    for sgn in () if local else (-1, 1):
        try: addline(cutJ(L2.parallel_offset(H, 'left' if sgn < 0 else 'right', join_style=1)), 0)
        except Exception: pass
    lanes = 2 if local else max(2, round(w / LANE))
    for k in range(1, lanes):
        o = (k - lanes / 2) * (w / lanes) * M
        if abs(o) < 0.05: g = L2
        else:
            try: g = L2.parallel_offset(abs(o), 'left' if o < 0 else 'right', join_style=1)
            except Exception: continue
        addline(cutJ(g), 1)
def quad(c, d, n, hl, hw):
    """Prostokąt: środek c, kierunek d (jednostkowy), normalna n, pół długości hl wzdłuż d i pół szerokości hw wzdłuż n."""
    p = [c + d * hl + n * hw, c + d * hl - n * hw, c - d * hl - n * hw, c - d * hl + n * hw]
    k = (int(c[0] // GRID), int(c[1] // GRID)); ox, oy = k[0] * GRID, k[1] * GRID
    marks[k] += [(q[0] - ox, q[1] - oy, 0.0, 0) for q in (p[0], p[1], p[2], p[0], p[2], p[3])]
zebras = 0
ARG = {os.path.basename(a): a for a in sys.argv[3:]}
if 'crossing.json' in ARG:
    at = STRtree([a[0] for a in allAxes])
    for e in json.load(open(ARG['crossing.json']))['elements']:
        if e.get('tags', {}).get('crossing') in ('unmarked', 'informal', 'no'): continue
        x, y = to4326(e['lon'], e['lat'])
        P = Point(x, y)
        j = at.nearest(P); L, w = allAxes[j][0], allAxes[j][1]
        if L.distance(P) > (w / 2 + 0.5) * M: continue  # przejście poza jezdnią BDOT
        s0 = L.project(P); a = L.interpolate(max(0, s0 - 2)); b = L.interpolate(min(L.length, s0 + 2))
        d = np.array([b.x - a.x, b.y - a.y]); d /= (np.hypot(*d) or 1); n = np.array([-d[1], d[0]])
        q = L.interpolate(s0); c0 = np.array([q.x, q.y]); half = (w / 2 - 0.4) * M
        # pasy zebry równoległe do jezdni, ułożone w poprzek: 0,5 m szerokości co 1 m, długość 4 m
        o = -half + 0.25 * M
        while o <= half - 0.25 * M:
            quad(c0 + n * o, d, n, 2.0 * M, 0.25 * M); o += 1.0 * M
        zebras += 1
print('przejścia', zebras, flush=True)
print('linie', sum(len(v) for v in marks.values()) // 6, flush=True)
idx = json.load(open(f'{OUT}/index.json')); xs = [t[0] for t in idx['tiles']]; ys = [t[1] for t in idx['tiles']]
# osie do dopasowania toru: jezdnia podwójna (druga równoległa blisko) jest jednokierunkowa
t3 = STRtree([a[0] for a in allAxes]); ax0 = min(a[0].bounds[0] for a in allAxes); ay0 = min(a[0].bounds[1] for a in allAxes); blob = bytearray(struct.pack('<I', len(allAxes)))
for i, (L, w, nm, tier) in enumerate(allAxes):
    m = L.interpolate(0.5, normalized=True); q = L.interpolate(min(L.length, L.length * 0.5 + 3)); dx, dy = q.x - m.x, q.y - m.y; dl = math.hypot(dx, dy) or 1; two = 1
    for j in t3.query(m.buffer(35)):
        if j == i: continue
        o = allAxes[j][0]; d = o.distance(m)
        if d < 6 or d > 35: continue
        s = o.project(m); a = o.interpolate(s); b = o.interpolate(min(o.length, s + 3)); ex, ey = b.x - a.x, b.y - a.y; el = math.hypot(ex, ey) or 1
        same = nm == allAxes[j][2] and (nm or tier == 0) # druga jezdnia tej samej ulicy, nie boczna równoległa
        if same and abs(dx * ex + dy * ey) / (dl * el) > 0.97 and allAxes[j][1] >= 5 and w >= 5: two = 0; break
    c = np.array(L.simplify(0.5).coords, dtype=np.float64)[:, :2] - (ax0, ay0)
    nb = nm.encode('utf8'); blob += struct.pack('<IffH', len(c), w, two, len(nb)) + nb + c.astype(np.float32).tobytes()
with gzip.open(f'{OUT}/axes.bin', 'wb', 9) as f: f.write(blob)
print('osie', len(allAxes), len(blob) // 1024, 'KB', flush=True)
PK = []
for f in sys.argv[3:]:
    if os.path.basename(f) in ('crossing.json', 'signals.json', 'lamps.json') or not os.path.exists(f): continue
    for e in json.load(open(f)).get('elements', []):
        g = e.get('geometry') or []
        if len(g) < 4: continue
        try:
            q = Polygon([to4326(v['lon'], v['lat']) for v in g]).buffer(0)
            if q.area > 30: PK.append(q)
        except Exception: pass
PKU = unary_union(PK).difference(R.buffer(0.3 * M)).difference(W) if PK else Polygon()
print('parkingi', len(PK), flush=True)
# krawężnik: pionowy bok od jezdni do chodnika i miękki cień na jezdni przy nim
from shapely.geometry.polygon import orient
CURB_H = 0.25 * M; SHADE = 0.5 * M  # 25 cm: wyżej niż w rzeczywistości, żeby z kamery było widać bryłę
curbs = defaultdict(list)
for poly in getattr(R, 'geoms', [R]):
    if poly.geom_type != 'Polygon': continue
    o = orient(poly.simplify(0.2), 1.0)  # zewnętrzny obrys przeciwnie do zegara: jezdnia zawsze po lewej
    for ring in [o.exterior, *o.interiors]:
        c = np.array(ring.coords)
        for i in range(len(c) - 1):
            a, b = c[i], c[i + 1]; L = np.hypot(*(b - a))
            if L < 0.05: continue
            d = (b - a) / L; n = np.array([-d[1], d[0]])  # do środka jezdni
            k = (int(((a[0] + b[0]) / 2) // GRID), int(((a[1] + b[1]) / 2) // GRID)); ox, oy = k[0] * GRID, k[1] * GRID
            A0 = (a[0] - ox, a[1] - oy); B0 = (b[0] - ox, b[1] - oy); A1 = (A0[0] + n[0] * SHADE, A0[1] + n[1] * SHADE); B1 = (B0[0] + n[0] * SHADE, B0[1] + n[1] * SHADE)
            v = lambda P, z, s_, nn=n: (P[0], P[1], z, s_, nn[0], nn[1])
            curbs[k] += [v(A0, 0, 0), v(B0, 0, 0), v(B0, CURB_H, 1), v(A0, 0, 0), v(B0, CURB_H, 1), v(A0, CURB_H, 1)]
            z0 = (0, 0)
            curbs[k] += [v(A0, 0, -1, z0), v(B0, 0, -1, z0), v(B1, 0, -0.001, z0), v(A0, 0, -1, z0), v(B1, 0, -0.001, z0), v(A1, 0, -0.001, z0)]
print('krawężniki', sum(len(x) for x in curbs.values()) // 12, flush=True)
# obiekty przy drodze: sygnalizatory z OSM (po jednym na prawej krawędzi dla każdego kierunku) i latarnie (OSM, a przy głównych ulicach co 35 m)
props = defaultdict(list)
def put(x, y, kind, ang):
    k = (int(x // GRID), int(y // GRID)); props[k].append((x - k[0] * GRID, y - k[1] * GRID, kind, ang))
atree = STRtree([a[0] for a in allAxes])
def frame(P):
    j = atree.nearest(P); L, w = allAxes[j][0], allAxes[j][1]; s0 = L.project(P)
    a = L.interpolate(max(0, s0 - 3)); b = L.interpolate(min(L.length, s0 + 3)); d = np.array([b.x - a.x, b.y - a.y]); d /= (np.hypot(*d) or 1)
    q = L.interpolate(s0); return np.array([q.x, q.y]), d, np.array([-d[1], d[0]]), w, L.distance(P)
nsig = 0
if 'signals.json' in ARG:
    for e in json.load(open(ARG['signals.json']))['elements']:
        P = Point(*to4326(e['lon'], e['lat'])); c, d, n, w, dist = frame(P)
        if dist > 12 * M: continue
        off = (w / 2 + 0.7) * M
        for sg in (1, -1):  # ruch wzdłuż sg*d: sygnalizator po jego prawej, zwrócony do nadjeżdżających
            p = c - n * sg * off; put(p[0], p[1], 1, math.atan2(-d[1] * sg, -d[0] * sg)); nsig += 1
lamp_pts = []
if 'lamps.json' in ARG:
    for e in json.load(open(ARG['lamps.json']))['elements']:
        P = Point(*to4326(e['lon'], e['lat'])); c, d, n, w, dist = frame(P)
        if dist > 15 * M: continue
        side = 1 if np.dot(np.array([P.x, P.y]) - c, n) > 0 else -1
        lamp_pts.append((P.x, P.y)); put(P.x, P.y, 0, math.atan2(-n[1] * side, -n[0] * side))
ltree = STRtree([Point(p) for p in lamp_pts]) if lamp_pts else None
added_l = 0
for L, w, cl in axes:
    main = 'główna' in cl or 'przyśpieszonego' in cl or 'ekspresowa' in cl
    sides = (1, -1) if main else (1,)
    for sg in sides:
        t = 17.5 * M if sg < 0 else 0.0
        while t < L.length:
            q = L.interpolate(t); q2 = L.interpolate(min(L.length, t + 2)); d = np.array([q2.x - q.x, q2.y - q.y]); d /= (np.hypot(*d) or 1); n = np.array([-d[1], d[0]])
            p = np.array([q.x, q.y]) + n * sg * (w / 2 + 0.8) * M; P = Point(p)
            if not (ltree is not None and len(ltree.query(P.buffer(20 * M)))):
                put(p[0], p[1], 0, math.atan2(-n[1] * sg, -n[0] * sg)); added_l += 1
            t += 35 * M
print('sygnalizatory', nsig, 'latarnie OSM', len(lamp_pts), 'dostawione', added_l, flush=True)
# kolejność rysowania: najpierw nawierzchnie na poziomie jezdni, na końcu podniesione chodniki i krawężniki
surf = [(A, 2), (AM, 5), (AS, 6), (C, 3), (G, 4), (PKU, 7), (W, 0), (KERB, 1)]
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
        m = marks.get((tx, ty), []); cb = curbs.get((tx, ty), []); pr = props.get((tx, ty), [])
        if not v and not m and not cb and not pr: continue
        a = np.array(v, dtype=np.float32).reshape(-1, 3); l = np.array(m, dtype=np.float32).reshape(-1, 4)
        with gzip.open(f'{OUT}/{tx}_{ty}.r.bin', 'wb', 9) as f: f.write(struct.pack('<II', len(a), len(l)) + a.tobytes() + l.tobytes() + struct.pack('<I', len(cb)) + np.array(cb, dtype=np.float32).reshape(-1, 6).tobytes() + struct.pack('<I', len(pr)) + np.array(pr, dtype=np.float32).reshape(-1, 4).tobytes())
        tot += len(a) + len(l); done.append([tx, ty])
idx['roads'] = done; idx['axesOrg'] = [ax0, ay0]; json.dump(idx, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
print('kafli dróg', len(done), 'wierzchołków', tot)
