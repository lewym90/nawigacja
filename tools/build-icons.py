"""Ikony aplikacji z assets/icon-source.png: przycina czarne tło i narożniki grafiki, żeby system nie pokazał czerni.
Użycie: python3 tools/build-icons.py"""
import numpy as np
from PIL import Image
src = Image.open('assets/icon-source.png').convert('RGB')
a = np.asarray(src).astype(int).sum(2)
xs = np.where((a > 60).mean(0) > 0.4)[0]; ys = np.where((a > 60).mean(1) > 0.4)[0]
x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
pad = round((x1 - x0) * 0.022)  # bez jasnej ramki grafiki
s = min(x1 - x0, y1 - y0) - 2 * pad
c = src.crop((x0 + pad, y0 + pad, x0 + pad + s, y0 + pad + s))
print('kadr', x0, y0, x1, y1, s)
# narożniki kadru wciąż leżą poza zaokrągleniem grafiki: zamalowujemy je najbliższym kolorem zamiast czerni
arr = np.asarray(c).copy(); n = arr.shape[0]; r = round(n * 0.14)
yy, xx = np.mgrid[0:n, 0:n]
dx = np.maximum(np.maximum(r - xx, xx - (n - 1 - r)), 0); dy = np.maximum(np.maximum(r - yy, yy - (n - 1 - r)), 0)
mask = np.hypot(dx, dy) > r
px = np.clip(xx + np.sign(n / 2 - xx) * r * 0.75, 0, n - 1).astype(int); py = np.clip(yy + np.sign(n / 2 - yy) * r * 0.75, 0, n - 1).astype(int)
arr[mask] = arr[py[mask], px[mask]]
c = Image.fromarray(arr)
for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180), ('favicon-64.png', 64)):
    c.resize((size, size), Image.LANCZOS).convert('RGB').save(f'icons/{name}', optimize=True)
m = Image.new('RGB', (512, 512), (7, 20, 38))
m.paste(c.resize((430, 430), Image.LANCZOS), (41, 41))
m.save('icons/icon-maskable-512.png', optimize=True)
