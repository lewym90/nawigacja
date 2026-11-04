"""Tekstury silnika i mapy z assets/textures: ziemia, droga, dachy, drzewa."""
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
def load(n): return Image.open(f'assets/textures/{n}.png')
for n, sat, br in (('grass', 0.48, 0.66), ('pave', 1, 1.05), ('asphalt', 0.5, 0.8)):
    i = ImageEnhance.Brightness(ImageEnhance.Color(load(n).convert('RGB')).enhance(sat)).enhance(br).resize((256, 256), Image.LANCZOS)
    i.save(f'icons/tx-{n}.webp', quality=74, method=6)
r = Image.new('RGB', (1024, 512))
r.paste(load('tile').convert('RGB').resize((512, 512), Image.LANCZOS), (0, 0))
r.paste(load('bitumen').convert('RGB').resize((512, 512), Image.LANCZOS), (512, 0))
r.save('icons/city-roofs.webp', quality=78, method=6)
t = Image.new('RGBA', (1024, 512), (0, 0, 0, 0))
for k, n in enumerate(('spruce', 'leaf')):
    i = load(n).convert('RGBA').resize((512, 512), Image.LANCZOS)
    a = i.getchannel('A').filter(ImageFilter.MinFilter(5))  # zjada jaskrawą obwódkę po wycinaniu tła
    p = np.asarray(i.convert('RGB')).astype(float); m = np.asarray(a) > 40
    # kolor poza liśćmi zastępujemy zielenią, żeby przy zmniejszaniu nie wchodziła czerń
    p[~m] = p[m].mean(0)
    o = Image.fromarray(np.clip(p, 0, 255).astype('uint8')).convert('RGBA'); o.putalpha(a)
    t.paste(o, (k * 512, 0))
t.save('icons/city-trees.webp', quality=82, method=6)
