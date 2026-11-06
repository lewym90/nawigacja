"""Miękkie cienie i przyciemnienie przy murach, policzone raz dla całego miasta: stabilne i lekkie dla telefonu.
Użycie: python3 tools/build-shadows.py <katalog_kafli>   -> <x>_<y>.s.webp (256 px)"""
import glob, gzip, json, math, os, re, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
Image.MAX_IMAGE_PIXELS = None
OUT = sys.argv[1]; GRID = 400.0; T = 256; PX = GRID / (T * 2)  # rysujemy w 512 na kafel
idx = json.load(open(f'{OUT}/index.json')); tiles = [tuple(t) for t in idx['tiles']]
az = 2.4; sun = (math.sin(az) * .75, math.cos(az) * .75, .66); dx, dy = -sun[0] / sun[2] * .85, -sun[1] / sun[2] * .85
x0 = min(t[0] for t in tiles) - 1; y0 = min(t[1] for t in tiles) - 1; x1 = max(t[0] for t in tiles) + 2; y1 = max(t[1] for t in tiles) + 2
W_ = (x1 - x0) * T * 2; H_ = (y1 - y0) * T * 2; print(W_, H_, flush=True)
sh = Image.new('1', (W_, H_)); foot = Image.new('1', (W_, H_)); ds = ImageDraw.Draw(sh); df = ImageDraw.Draw(foot)
def P(ox, oy, x, y): return ((x + ox - x0 * GRID) / PX, (y1 * GRID - (y + oy)) / PX)
for n, t in enumerate(tiles):
    p = f'{OUT}/{t[0]}_{t[1]}.bin'
    if not os.path.exists(p): continue
    b = gzip.decompress(open(p, 'rb').read()); nw, nr = struct.unpack('<II', b[:8]); ox, oy = t[0] * GRID, t[1] * GRID
    w = np.frombuffer(b, np.float32, nw * 6, 8).reshape(-1, 6)[:, :3].reshape(-1, 3, 3)
    r = np.frombuffer(b, np.float32, nr * 4, 8 + nw * 24).reshape(-1, 4)[:, :3].reshape(-1, 3, 3)
    for tri in w: ds.polygon([P(ox, oy, a + dx * c, e + dy * c) for a, e, c in tri], fill=1)
    for tri in r:
        ds.polygon([P(ox, oy, a + dx * c, e + dy * c) for a, e, c in tri], fill=1); df.polygon([P(ox, oy, a, e) for a, e, c in tri], fill=1)
    if n % 300 == 0: print(n, flush=True)
tr = {}
for t in idx.get('trees', []):
    p = f'{OUT}/{t[0]}_{t[1]}.t.bin'
    if not os.path.exists(p): continue
    a = np.frombuffer(gzip.open(p).read(), np.float32).reshape(-1, 4); ox, oy = t[0] * GRID, t[1] * GRID
    for x, y, h, k in a:
        c = P(ox, oy, x + dx * h * .5, y + dy * h * .5); r_ = h * .42 / PX
        ds.ellipse((c[0] - r_, c[1] - r_, c[0] + r_, c[1] + r_), fill=1)
print('rysunek gotowy', flush=True)
done = []
for tx in range(x0, x1):
    for ty in range(y0, y1):
        l = (tx - x0) * T * 2; u = (y1 - ty - 1) * T * 2; bx = (l - 32, u - 32, l + 512 + 32, u + 512 + 32)
        s = sh.crop(bx)
        if not s.getbbox(): continue
        a = np.asarray(s.convert('L').filter(ImageFilter.GaussianBlur(2.6)), dtype=np.float32) / 255 * .42
        f = np.asarray(foot.crop(bx).convert('L').filter(ImageFilter.GaussianBlur(9)), dtype=np.float32) / 255 * .34
        v = 1 - (1 - a) * (1 - f)
        im = Image.fromarray((v * 255).astype('uint8')).crop((32, 32, 544, 544)).resize((T, T), Image.LANCZOS)
        im.save(f'{OUT}/{tx}_{ty}.s.webp', quality=55, method=4); done.append([tx, ty])
idx['shadows'] = done; json.dump(idx, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
print('kafli cieni', len(done))
