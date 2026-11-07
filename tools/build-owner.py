"""Grafiki właściciela (assets/owner) -> atlasy silnika 3D i tekstury mapy.
Drzewa: icons/city2-trees.webp, 4x2 komórki: lipa, dąb, brzoza, klon, topola, sosna, młode, krzew (bez zielonej obwódki po wycinaniu tła).
Elewacje: icons/city2-atlas-day.webp i -night.webp, 4 kolumny x 6 wierszy (wiersze jak facade_row w build-city.py), rozmiar powtórzenia w FACADE_M.
Dachy: icons/city2-roofs.webp: dachówka, blacha na rąbek, papa. Ziemia: tx-asphalt, tx-pave, tx-grass."""
import json
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
O = 'assets/owner/'
def load(n): return Image.open(n if '/' in n else O + n + '.png')

# --- drzewa ---
TREES = ['drzewo-lipa', 'drzewo-dab', 'drzewo-brzoza', 'drzewo-klon', 'drzewo-topola', 'drzewo-sosna', 'drzewo-mlode', 'krzew']
C = 512; t = Image.new('RGBA', (C * 4, C * 2), (0, 0, 0, 0))
for k, n in enumerate(TREES):
    i = load(n).convert('RGBA')
    a = i.getchannel('A').filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(1))  # zjada jaskrawą obwódkę
    p = np.asarray(i.convert('RGB')).astype(float); m = np.asarray(a) > 128
    # resztki obwódki: piksele dużo bardziej zielone/żółte niż reszta korony
    g = p[..., 1] - (p[..., 0] + p[..., 2]) / 2; spill = g > np.percentile(g[m], 97)
    p[spill] = p[spill] * 0.55 + p[m].mean(0) * 0.45
    p[~m] = p[m].mean(0)  # kolor poza drzewem: średnia korony, żeby przy pomniejszaniu nie wchodziła czerń
    o = Image.fromarray(np.clip(p, 0, 255).astype('uint8')).convert('RGBA'); o.putalpha(a)
    bb = a.point(lambda v: 255 if v > 128 else 0).getbbox()
    # drzewo stoi pniem na dole komórki i wypełnia ją w pionie
    o = o.crop((0, 0, i.width, bb[3])); s = C / o.height
    o = o.resize((round(o.width * s), C), Image.LANCZOS)
    cell = Image.new('RGBA', (C, C), (0, 0, 0, 0)); cell.paste(o, ((C - o.width) // 2, 0))
    t.paste(cell, ((k % 4) * C, (k // 4) * C))
t.save('icons/city2-trees.webp', quality=86, method=6)

# --- elewacje ---
OLD = lambda n: 'assets/facades/' + n + '.png'
ROWS = [
    [(OLD('house-0'), 8), (OLD('house-1'), 8), (OLD('house-2'), 8), (OLD('house-0'), 8)],
    [('elew-kamienica', 15), (OLD('tenement-0'), 12), (OLD('tenement-1'), 12), ('elew-blok-zolty', 12)],
    [('elew-blok-balkony', 16), ('elew-blok-zolty', 12), (OLD('block-0'), 13), ('elew-blok-balkony', 16)],
    [('elew-biuro-panele', 11), ('elew-biuro-szklo', 20), ('elew-biuro-prl', 17), ('elew-przemysl-biuro', 10)],
    [('elew-handel-witryna', 7), ('elew-przemysl-biuro', 10), ('elew-biuro-panele', 11), ('elew-handel-witryna', 7)],
    [('elew-hala-blacha', 9), ('elew-cegla-fabryka', 10), ('elew-beton-prefab', 13), ('elew-przemysl-biuro', 10)],
]
F = 384; day = Image.new('RGB', (F * 4, F * 6)); night = Image.new('RGB', (F * 4, F * 6)); size = []
rng = np.random.default_rng(7)
for r, row in enumerate(ROWS):
    for c, (n, m) in enumerate(row):
        i = load(n).convert('RGB').resize((F, F), Image.LANCZOS); day.paste(i, (c * F, r * F)); size.append(m)
        # noc: ściana gaśnie, część okien świeci ciepło (okna = ciemniejsze od otoczenia i chłodne)
        a = np.asarray(i).astype(float); L = a.mean(2); bl = np.asarray(Image.fromarray(L.astype('uint8')).filter(ImageFilter.GaussianBlur(F / 24))).astype(float)
        win = (L < bl * 0.9) & (a[..., 2] >= a[..., 0] - 8)
        win = np.asarray(Image.fromarray((win * 255).astype('uint8')).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) > 128  # bez pojedynczych pikseli
        from scipy import ndimage
        lab, nl = ndimage.label(win); sz = ndimage.sum(win, lab, range(1, nl + 1))
        on = (rng.random(nl + 1) < 0.45); on[0] = False; on[1:] &= (sz > F * F / 4000) & (sz < F * F / 12)  # tylko kształty wielkości szyby
        lit = on[lab]
        n_ = a * 0.16; n_[lit] = np.array([255, 196, 120]) * (0.55 + 0.45 * (L[lit, None] / 255))
        night.paste(Image.fromarray(np.clip(n_, 0, 255).astype('uint8')), (c * F, r * F))
day.save('icons/city2-atlas-day.webp', quality=82, method=6); night.save('icons/city2-atlas-night.webp', quality=82, method=6)
open('js/facade-size.js', 'w').write('// Wygenerowane przez tools/build-owner.py: ile metrów ściany zajmuje jedno powtórzenie każdej elewacji atlasu.\nexport const FACADE_M = ' + json.dumps(size) + ';\n')

# --- dachy ---
R = 512; roofs = Image.new('RGB', (R * 3, R))
roofs.paste(load('assets/textures/tile.png').convert('RGB').resize((R, R), Image.LANCZOS), (0, 0))
roofs.paste(load('dach-blacha').convert('RGB').resize((R, R), Image.LANCZOS), (R, 0))
roofs.paste(ImageEnhance.Brightness(load('dach-papa').convert('RGB')).enhance(0.8).resize((R, R), Image.LANCZOS), (2 * R, 0))
roofs.save('icons/city2-roofs.webp', quality=80, method=6)

# --- ziemia ---
for src, n, sat, br in (('tx-trawa', 'grass', 0.62, 0.72), ('tx-kostka', 'pave', 0.9, 1.0), ('tx-asfalt', 'asphalt', 1.0, 1.15)):
    i = ImageEnhance.Brightness(ImageEnhance.Color(load(src).convert('RGB')).enhance(sat)).enhance(br).resize((512, 512), Image.LANCZOS)
    i.save(f'icons/tx2-{n}.webp', quality=76, method=6)
print('atlasy gotowe', size)
