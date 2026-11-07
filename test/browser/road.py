"""Test: czy auto i wstęga mieszczą się na jezdni. Plik wejściowy: zrzut z real.py (env DUMP).
Użycie: python3 test/browser/road.py <zrzut.json>. Kod wyjścia 1, gdy coś wypada poza jezdnię.
Sprawdza tor jazdy względem jezdni narysowanej na ekranie (trójkąty z city/nowy/*.r.bin, rodzaje 2-6).
Dla każdego metra toru: czy auto (punkt) i oba brzegi wstęgi (±1,1 m) leżą na jezdni."""
import gzip, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
CITY = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'city', 'nowy'); G = 400.0; RES = 4  # px na metr Merkatora
W = 40075016.68
cache = {}
def mask(tx, ty):
    k = (tx, ty)
    if k in cache: return cache[k]
    f = f'{CITY}/{tx}_{ty}.r.bin'; m = None
    if os.path.exists(f):
        b = gzip.open(f).read(); n = int.from_bytes(b[0:4], 'little')
        v = np.frombuffer(b, '<f4', n * 3, 8).reshape(-1, 3)
        im = Image.new('1', (int(G * RES), int(G * RES)), 0); d = ImageDraw.Draw(im)
        for i in range(0, len(v) - 2, 3):
            t = v[i:i + 3]
            if int(round(t[0, 2])) in (2, 3, 4, 5, 6): d.polygon([(float(x) * RES, (G - float(y)) * RES) for x, y, _ in t], fill=1)
        from PIL import ImageFilter
        m = np.array(im.convert('L').filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))) > 0  # domknięcie szwów między trójkątami (1 px = 25 cm), bez poszerzania jezdni
    cache[k] = m; return m
def on(x, y):
    tx = math.floor(x / G); ty = math.floor(y / G); m = mask(tx, ty)
    if m is None: return None
    px = int((x - tx * G) * RES); py = int((G - (y - ty * G)) * RES)
    return bool(m[min(m.shape[0] - 1, max(0, py)), min(m.shape[1] - 1, max(0, px))])
d = json.load(open(sys.argv[1])); out = d['out']; K = 1 / math.cos(math.radians(51.25)); HW = 1.1 * K
xy = [(q[0] * W / 360, math.log(math.tan(math.pi / 4 + q[1] * math.pi / 360)) * W / (2 * math.pi)) for q in out]
bad = []; known = 0
for i in range(1, len(xy) - 1):
    a, b = xy[i - 1], xy[i + 1]; l = math.hypot(b[0] - a[0], b[1] - a[1]) or 1; nx, ny = -(b[1] - a[1]) / l, (b[0] - a[0]) / l
    x, y = xy[i]; r = [on(x, y), on(x + nx * HW, y + ny * HW), on(x - nx * HW, y - ny * HW)]
    if None in r: continue
    if any(a - 1 <= i <= b + 1 for a, b in d.get('fill') or []): r = [True] * 3  # własny asfalt pod torem
    known += 1
    if not all(r): bad.append((i, ''.join('X' if not v else '.' for v in r)))
skip = int(sys.argv[2]) if len(sys.argv) > 2 else 15
core = [b for b in bad if skip <= b[0] <= len(xy) - 1 - skip]
print(f'metrów {known}, poza jezdnią {len(core)} (+{len(bad) - len(core)} przy samym starcie/celu)')
runs = []
for i, s in core:
    if runs and i - runs[-1][1] <= 2: runs[-1][1] = i
    else: runs.append([i, i])
print('odcinki [m]:', [(a, b) for a, b in runs][:40])
json.dump(runs, open(sys.argv[1] + '.bad', 'w'))
sys.exit(1 if core else 0)
