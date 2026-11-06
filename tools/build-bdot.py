"""BDOT10k -> dane dla nowego wyglądu: teren (ground.json) i budynki (pickle) i drzewa (pickle).
Użycie: python3 tools/build-bdot.py <powiat_GML.zip> <katalog> <wyjście_pickle>"""
import json, pickle, re, sys, zipfile
from pyproj import Transformer
from shapely.geometry import Polygon
SRC, OUT, PKL = sys.argv[1:4]
z = zipfile.ZipFile(SRC)
wgs = Transformer.from_crs(2180, 4326, always_xy=True)
def read(k):
    n = [i.filename for i in z.infolist() if f'__{k}.xml' in i.filename]
    return z.read(n[0]).decode('utf8', 'ignore') if n else ''
FEAT = re.compile(r'<ot:(OT_\w+)\s+gml:id.*?</ot:\1>', re.S)
EXT = re.compile(r'<gml:exterior>.*?<gml:posList[^>]*>([^<]+)<', re.S)
INT = re.compile(r'<gml:interior>.*?<gml:posList[^>]*>([^<]+)<', re.S)
LIN = re.compile(r'<gml:LineString.*?<gml:posList[^>]*>([^<]+)<', re.S)
POS = re.compile(r'<gml:pos[^>]*>([^<]+)<')
def tag(x, t):
    m = re.search(rf'<ot:{t}[^>]*>([^<]+)', x); return m.group(1) if m else ''
def nums(s):
    v = s.split(); return [(float(v[i]), float(v[i + 1])) for i in range(0, len(v) - 1, 2)]
feats = []
def add(k, x):
    e = EXT.search(x)
    if not e: return
    p = Polygon(nums(e.group(1)), [nums(i) for i in INT.findall(x)])
    q = p.simplify(1.0, preserve_topology=True)
    if q.is_empty or q.area < 30: return
    for g in (q.geoms if hasattr(q, 'geoms') else [q]):
        rings = [g.exterior] + list(g.interiors)
        cc = [[[round(c, 6) for c in wgs.transform(*pt)] for pt in r.coords] for r in rings]
        feats.append({'type': 'Feature', 'properties': {'k': k}, 'geometry': {'type': 'Polygon', 'coordinates': cc}})
ZB = {'jednorodzinna': 'house', 'wielorodzinna': 'estate', 'handlowo-usługowa': 'paved', 'przemysłowo-składowa': 'paved', 'pozostała zabudowa': 'estate', 'śródmiejska': 'paved'}
for k, fn in (('OT_PTZB_A', lambda x: ZB.get(tag(x, 'rodzaj'), 'estate')), ('OT_PTPL_A', lambda x: 'paved'), ('OT_PTKM_A', lambda x: 'paved'), ('OT_PTNZ_A', lambda x: 'bare'),
              ('OT_PTTR_A', lambda x: 'field' if 'uprawa' in tag(x, 'rodzaj') else 'grass'), ('OT_PTUT_A', lambda x: 'field'), ('OT_PTRK_A', lambda x: 'grass'), ('OT_PTGN_A', lambda x: 'bare'),
              ('OT_PTLZ_A', lambda x: 'wood'), ('OT_PTWP_A', lambda x: 'water'), ('OT_PTWZ_A', lambda x: 'grass')):
    s = read(k); n0 = len(feats)
    for m in FEAT.finditer(s): add(fn(m.group(0)), m.group(0))
    print(k, len(feats) - n0)
# tereny zielone rysujemy na wierzchu zabudowy
order = {'field': 0, 'bare': 1, 'house': 2, 'estate': 3, 'paved': 4, 'grass': 5, 'wood': 6, 'water': 7}
feats.sort(key=lambda f: order[f['properties']['k']])
json.dump({'type': 'FeatureCollection', 'features': feats}, open(f'{OUT}/ground.json', 'w'), separators=(',', ':'))
out = {'bld': [], 'tree': [], 'row': [], 'wood': []}
for m in FEAT.finditer(read('OT_BUBD_A')):
    x = m.group(0); e = EXT.search(x)
    if not e or tag(x, 'kategoriaIstnienia') not in ('', 'eksploatowany'): continue
    out['bld'].append((nums(e.group(1)), tag(x, 'funkcjaOgolnaBudynku'), int(tag(x, 'liczbaKondygnacji') or 0)))
for m in FEAT.finditer(read('OT_OIPR_P')):
    x = m.group(0)
    if tag(x, 'rodzaj').startswith(('drzewo', 'mały las')):
        out['tree'].append(nums(POS.search(x).group(1))[0])
for m in FEAT.finditer(read('OT_OIPR_L')):
    x = m.group(0)
    if tag(x, 'rodzaj') == 'rząd drzew': out['row'] += [nums(l) for l in LIN.findall(x)]
for m in FEAT.finditer(read('OT_PTLZ_A')):
    e = EXT.search(m.group(0))
    if e: out['wood'].append(nums(e.group(1)))
pickle.dump(out, open(PKL, 'wb'))
print('teren', len(feats), 'budynki', len(out['bld']), 'drzewa', len(out['tree']), 'rzędy', len(out['row']), 'las', len(out['wood']))
