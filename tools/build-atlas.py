"""Atlas elewacji 4 rodzaje x 3 warianty dla silnika 3D: icons/city-atlas-day.webp i -night.webp."""
from PIL import Image
K = ['house', 'tenement', 'block', 'office']; C = 256
for t in ('day', 'night'):
    a = Image.new('RGB', (C * 3, C * 4))
    for r, k in enumerate(K):
        for i in range(3):
            a.paste(Image.open(f'icons/fa-big/{k}-{i}-{t}.png').resize((C, C), Image.LANCZOS), (i * C, r * C))
    a.save(f'icons/city-atlas-{t}.webp', quality=82, method=6)
