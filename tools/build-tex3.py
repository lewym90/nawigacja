"""Tekstury właściciela dla silnika Three.js (assets/owner/tex3/*.png) -> icons/t3-<nazwa>.webp i icons/t3-<nazwa>-n.webp.
Mapa nierówności (normal map) liczona z jasności zdjęcia: ciemne fugi i szczeliny leżą niżej, jasne kamyki wyżej.
Niebo: panorama 2:1 do kopuły nieba i odbić."""
import numpy as np
from PIL import Image, ImageFilter
SRC = 'assets/owner/tex3'
TEX = {'asfalt': 2.2, 'asfalt-stary': 2.6, 'plyty': 3.0, 'kostka': 3.4, 'kraweznik': 2.0, 'trawa': 1.6}  # siła nierówności
def normal(img, k):
    g = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
    dx = (np.roll(g, -1, 1) - np.roll(g, 1, 1)) * k; dy = (np.roll(g, -1, 0) - np.roll(g, 1, 0)) * k
    n = np.dstack([-dx, dy, np.ones_like(g)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype('uint8'), 'RGB')
for name, k in TEX.items():
    im = Image.open(f'{SRC}/{name}.png').convert('RGB').resize((1024, 1024), Image.LANCZOS)
    im.save(f'icons/t3-{name}.webp', quality=86, method=6)
    normal(im, k * 4).save(f'icons/t3-{name}-n.webp', quality=90, method=6)
    print(name)
Image.open(f'{SRC}/niebo.png').convert('RGB').resize((2048, 1024), Image.LANCZOS).save('icons/t3-niebo.webp', quality=88, method=6)
print('niebo')
