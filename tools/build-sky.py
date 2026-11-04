"""Panoramy nieba z gotowych obrazków: scala lewą i prawą krawędź, żeby obraz nie miał szwu.
Użycie: python3 tools/build-sky.py <dzień.png> <noc.png>"""
import sys
import numpy as np
from PIL import Image
W, H = 2048, 683
def build(src, dst, q):
    im = Image.open(src).convert('RGB')
    im = im.crop((0, 0, im.width, im.height - 5)).resize((W + 200, H), Image.LANCZOS)
    a = np.asarray(im).astype(float)
    n = 200
    t = (np.linspace(0, 1, n)[None, :, None]) ** 1
    out = a[:, :W].copy()
    out[:, :n] = a[:, W:W + n] * (1 - t) + a[:, :n] * t  # początek płynnie przechodzi z końca
    Image.fromarray(out.round().astype('uint8')).save(dst, quality=q, method=6)
build(sys.argv[1], 'icons/sky-day.webp', 80)
build(sys.argv[2], 'icons/sky-night.webp', 84)
