"""Ikony aplikacji z oryginalnego znaku. Użycie: python3 tools/build-icons.py <oryginał.png>"""
import sys
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGB')
W = src.width
c = src.crop((round(W * .03), round(W * .03), round(W * .97), round(W * .97)))
for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180), ('favicon-64.png', 64)):
    c.resize((size, size), Image.LANCZOS).save(f'icons/{name}', optimize=True)
m = Image.new('RGB', (512, 512), (7, 20, 38))
m.paste(c.resize((410, 410), Image.LANCZOS), (51, 51))
m.save('icons/icon-maskable-512.png', optimize=True)
