"""Panoramy nieba bez szwu (dzień i noc), generowane proceduralnie. Użycie: python3 tools/build-sky.py"""
import numpy as np
from PIL import Image
W, H = 2048, 460
rng = np.random.default_rng(7)
def fbm(aniso=4.0, beta=2.2):
    fx = np.fft.fftfreq(W)[None, :] * W; fy = np.fft.fftfreq(H)[:, None] * H * aniso
    f = np.sqrt(fx ** 2 + fy ** 2); f[0, 0] = 1
    spec = (rng.normal(size=(H, W)) + 1j * rng.normal(size=(H, W))) / f ** beta
    spec[f < 2] = 0
    n = np.fft.ifft2(spec).real
    return (n - n.mean()) / n.std()
y = np.linspace(0, 1, H)[:, None]  # 0 góra, 1 horyzont
def lerp(a, b, t): return a[None, None, :] * (1 - t[..., None]) + b[None, None, :] * t[..., None]
# dzień
n = fbm(); nl = fbm(aniso=2.5, beta=1.7)
sky = lerp(np.array([38, 112, 214.]), np.array([196, 226, 247.]), np.broadcast_to(y ** 1.5, (H, W)))
dens = np.clip((n + 0.35 * nl) * 0.55 - 0.1 + 0.25 * y, 0, 1) ** 0.8
dens *= np.clip((1.03 - y) * 8, 0, 1) * np.clip(y * 9, 0.25, 1)
shade = np.clip(0.8 + 0.2 * (np.roll(n, 8, 0) - n), 0.62, 1)
cloud = np.stack([255 * shade, 255 * shade, 258 * shade], -1)
day = sky * (1 - dens[..., None]) + cloud * dens[..., None]
Image.fromarray(np.clip(day, 0, 255).astype('uint8')).save('icons/sky-day.webp', quality=78, method=6)
# noc
m = fbm(); 
sky = lerp(np.array([4, 8, 24.]), np.array([28, 52, 104.]), np.broadcast_to(y ** 2.2, (H, W)))
d = np.clip(m * 0.3 - 0.15, 0, 0.45) * (0.3 + 0.7 * y)
night = sky * (1 - d[..., None]) + np.array([52, 70, 116.]) * d[..., None]
st = rng.random((H, W)) > 0.9988
s = (st * rng.uniform(90, 255, (H, W)) * np.clip(1.15 - y * 1.3, 0, 1))
night = night + s[..., None]
Image.fromarray(np.clip(night, 0, 255).astype('uint8')).save('icons/sky-night.webp', quality=82, method=6)
