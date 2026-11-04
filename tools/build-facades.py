"""Elewacje do mapy: z assets/facades/<rodzaj>-<numer>.png robi tekstury dzienne i nocne (zapalone okna).
Nowy obrazek = nowy plik w assets/facades + uruchomienie: python3 tools/build-facades.py
Rodzaje: house, tenement, block, office. Skrypt sam zapisuje listę w js/facade-list.js."""
import glob, json, os, re
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
SIZE = 256
os.makedirs('icons/fa-big', exist_ok=True)
rng = np.random.default_rng(3)
kinds = {}
os.makedirs('icons/fa', exist_ok=True)
for old in glob.glob('icons/fa/*'): os.remove(old)
for p in sorted(glob.glob('assets/facades/*.png')):
    m = re.match(r'(house|tenement|block|office)-(\d+)\.png', os.path.basename(p))
    if not m: continue
    kind, _ = m.groups(); n = kinds.get(kind, 0); kinds[kind] = n + 1
    im = Image.open(p).convert('RGB')
    day = im.resize((SIZE, SIZE), Image.LANCZOS)
    day.save(f'icons/fa-big/{kind}-{n}-day.png')
    day.resize((160, 160), Image.LANCZOS).save(f'icons/fa/{kind}-{n}-day.webp', quality=80, method=6)
    a = np.asarray(day).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = a.mean(-1)
    glass = (b >= r - 3) & (lum < 200)
    glass = ndi.binary_opening(glass, iterations=1)
    glass = ndi.binary_closing(glass, iterations=2)
    lab, cnt = ndi.label(glass)
    if lab.size and np.bincount(lab.ravel())[1:].max(initial=0) > 0.08 * lab.size:  # szyby jednym ciągiem (biurowiec): dzielimy na okna siatką
        gy, gx = np.mgrid[0:SIZE, 0:SIZE] * 4 // SIZE
        lab = (gy * 4 + gx + 1) * glass
        cnt = 16
    lit = np.zeros(lab.shape, bool)
    for i in range(1, cnt + 1):
        if rng.random() < 0.36: lit |= lab == i
    wall = a * np.array([0.13, 0.15, 0.2]) + np.array([5, 7, 12])
    win = np.stack([lum, lum, lum], -1) / 255
    night = wall.copy()
    night[glass] = (win[glass] * np.array([20, 30, 48]) + np.array([6, 11, 20]))
    night[lit] = (0.55 + 0.45 * win[lit]) * np.array([255, 200, 125])
    Image.fromarray(np.clip(night, 0, 255).astype('uint8')).save(f'icons/fa-big/{kind}-{n}-night.png')
    Image.open(f'icons/fa-big/{kind}-{n}-night.png').resize((160, 160), Image.LANCZOS).save(f'icons/fa/{kind}-{n}-night.webp', quality=82, method=6)
open('js/facade-list.js', 'w').write('// Plik tworzy tools/build-facades.py: ile wariantów elewacji ma każdy rodzaj budynku.\nexport const FACADE_KINDS = ' + json.dumps(kinds) + ';\n')
sw = open('sw.js').read()
sw = re.sub(r"\.\.\.\[.*?\.webp`\)\),", "...Object.entries(" + json.dumps(kinds) + ").flatMap(([k, n]) => [...Array(n).keys()].flatMap((i) => ['day', 'night'].map((t) => `./icons/fa/${k}-${i}-${t}.webp`))),", sw, count=1)
open('sw.js', 'w').write(sw)
print(kinds)
