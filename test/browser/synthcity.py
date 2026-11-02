"""Sztuczne kafelki wektorowe (schemat OpenMapTiles): siatka ulic, bloki z wysokościami, rzeka, park.
Służą do OGLĄDANIA wyglądu (niebo, światło, kamera) w teście w przeglądarce, bez dostępu do prawdziwych kafelków.
Układ: x na wschód, y na północ w metrach od (LNG0, LAT0); trasa testowa biegnie po x=0 na północ, potem na wschód."""
import math, random
import mapbox_vector_tile as mvt
from shapely.geometry import LineString, Polygon, box
from shapely import affinity

LAT0, LNG0 = 51.2, 22.55
M = 111195.0
KX = M * math.cos(math.radians(LAT0))
def to_ll(x, y): return LNG0 + x / KX, LAT0 + y / M
def to_tile(lng, lat, z, tx, ty):
    n = 2 ** z
    x = (lng + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (x - tx) * 4096, (y - ty) * 4096

def tile_bounds_m(z, x, y):
    n = 2 ** z
    def ll(tx, ty):
        lng = tx / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
        return lng, lat
    w, nn = ll(x, y); e, s = ll(x + 1, y + 1)
    return ((w - LNG0) * KX, (s - LAT0) * M, (e - LNG0) * KX, (nn - LAT0) * M)

STEP = 90
RIVER_Y = 3000  # rzeka biegnie na wschód-zachód, most na trasie

def river_poly(x0, x1):
    pts = [(x0, RIVER_Y - 70 + 40 * math.sin(x / 700)) for x in range(int(x0), int(x1) + 1, 100)]
    pts2 = [(x, RIVER_Y + 70 + 40 * math.sin(x / 700)) for x in range(int(x1), int(x0) - 1, -100)]
    return Polygon(pts + pts2)

def tile(z, tx, ty):
    x0, y0, x1, y1 = tile_bounds_m(z, tx, ty)
    pad = 200
    bx = box(x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    layers = {'transportation': [], 'building': [], 'water': [], 'park': [], 'landuse': []}
    def px(g):
        if g.geom_type == 'LineString':
            return LineString([to_tile(*to_ll(x, y), z, tx, ty) for x, y in g.coords])
        if g.geom_type == 'Polygon':
            return Polygon([to_tile(*to_ll(x, y), z, tx, ty) for x, y in g.exterior.coords])
    def add(layer, g, props):
        g = g.intersection(bx)
        if g.is_empty: return
        for part in (g.geoms if hasattr(g, 'geoms') else [g]):
            if part.geom_type in ('LineString', 'Polygon') and not part.is_empty:
                layers[layer].append({'geometry': px(part), 'properties': props})
    X0, X1, Y0, Y1 = -3600, 3600, -1200, 9200
    river = river_poly(X0, X1)
    add('water', river, {'class': 'river'})
    park = box(300, 1200, 900, 1800)
    add('park', park, {'class': 'park'})
    # ulice
    gx0 = int(max(X0, x0 - pad) // STEP * STEP); gx1 = int(min(X1, x1 + pad))
    gy0 = int(max(Y0, y0 - pad) // STEP * STEP); gy1 = int(min(Y1, y1 + pad))
    for x in range(gx0, gx1 + 1, STEP):
        cls = 'secondary' if x == 0 else ('tertiary' if x % 450 == 0 else 'minor')
        if z < 13 and cls == 'minor': continue
        add('transportation', LineString([(x, max(Y0, y0 - pad)), (x, min(Y1, y1 + pad))]), {'class': cls, 'name': f'ul. {abs(x)//STEP}'})
    for y in range(gy0, gy1 + 1, STEP):
        cls = 'primary' if y == 6000 else ('tertiary' if y % 450 == 0 else 'minor')
        if z < 13 and cls == 'minor': continue
        add('transportation', LineString([(max(X0, x0 - pad), y), (min(X1, x1 + pad), y)]), {'class': cls, 'name': f'ul. {abs(y)//STEP}'})
    # ekspresówka po skosie (na horyzoncie)
    add('transportation', LineString([(-3600, 1500), (3600, 7500)]), {'class': 'motorway', 'name': 'S12'})
    # budynki
    if z >= 14:
        for cx in range(gx0, gx1, STEP):
            for cy in range(gy0, gy1, STEP):
                if abs(cx) < 20 and True: continue
                cell = box(cx + 14, cy + 14, cx + STEP - 14, cy + STEP - 14)
                if cell.intersects(river) or cell.intersects(park): continue
                rnd = random.Random(cx * 7919 + cy * 104729)
                if rnd.random() < 0.18: continue
                dist = math.hypot(cx, cy - 4500) / 1000
                tall = rnd.random() < 0.12
                for sx in (0, 1):
                    for sy in (0, 1):
                        if rnd.random() < 0.25: continue
                        bxx = cx + 16 + sx * 38; byy = cy + 16 + sy * 38
                        h = rnd.choice([9, 12, 15, 18, 24, 33, 45]) if tall else rnd.choice([6, 9, 9, 12, 15, 18, 21])
                        add('building', box(bxx, byy, bxx + 32 - rnd.random() * 6, byy + 32 - rnd.random() * 6), {'render_height': h, 'render_min_height': 0})
    out = {k: v for k, v in layers.items() if v}
    data = [{'name': k, 'features': v} for k, v in out.items()]
    return mvt.encode(data, default_options={'extents': 4096, 'y_coord_down': True})
