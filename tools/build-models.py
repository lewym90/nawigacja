"""Modele 3D właściciela (assets/models/*.glb) -> city/models/<nazwa>.bin i city/models/tex.webp dla silnika.
Wierzchołek (trójkąty bez indeksów, f32): x, y, z (metry, z w górę, przód modelu = +x), nx, ny, nz, u, v, warstwa tekstury (-1: bez), r, g, b, rodzaj.
Rodzaj: 0 zwykły, 1 liście z przezroczystością, 2 klosz lampy (świeci nocą), 3/4/5 soczewki czerwona, żółta, zielona.
Tekstury: wszystkie w jednej kolumnie 512x512 warstw (tekstura tablicowa w WebGL2), kolejność warstw w city/models/index.json."""
import glob, io, json, os, struct
import numpy as np
import trimesh
from PIL import Image
from pygltflib import GLTF2
OUT = 'city/models'; os.makedirs(OUT, exist_ok=True)
NAMES = {'Tilia': 'lipa', 'Quercus': 'dab', 'Betula': 'brzoza', 'Pinus': 'sosna', 'Ornamental': 'krzew', 'lamp': 'latarnia', 'traffic_signal': 'sygnalizator', 'sign_post': 'znak'}
R = np.array([[0, 0, -1], [-1, 0, 0], [0, 1, 0]], float)  # glTF: y w górę, przód -z  ->  silnik: z w górę, przód +x
layers = []; index = {}
def layer(img):
    im = img.convert('RGBA').resize((512, 512), Image.LANCZOS); a = np.asarray(im).astype(float); m = a[..., 3] > 128
    if m.any() and not m.all(): a[~m, :3] = a[m, :3].mean(0)  # pod przezroczystymi pikselami kolor liści, a nie tło
    layers.append(Image.fromarray(a.astype('uint8'), 'RGBA')); return len(layers) - 1
for f in sorted(glob.glob('assets/models/*.glb')):
    key = next(v for k, v in NAMES.items() if k in os.path.basename(f))
    g = GLTF2().load(f); sc = trimesh.load(f, force='scene'); V = []
    for name, geom in sc.geometry.items():
        node = next(n for n in sc.graph.nodes_geometry if sc.graph[n][1] == name); M, _ = sc.graph[node]
        p = trimesh.transform_points(geom.vertices, M) @ R.T
        nrm = (geom.vertex_normals @ M[:3, :3].T) @ R.T; nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        mat = geom.visual.material if hasattr(geom.visual, 'material') else None
        uv = geom.visual.uv if getattr(geom.visual, 'uv', None) is not None else np.zeros((len(p), 2))
        mname = (getattr(mat, 'name', '') or '').lower()
        col = np.array(getattr(mat, 'baseColorFactor', None) if getattr(mat, 'baseColorFactor', None) is not None else [255, 255, 255, 255], float)[:3]
        if col.max() <= 1.0: col = col * 255
        tex = getattr(mat, 'baseColorTexture', None); L = -1
        if tex is not None:
            k = id(tex)
            if k not in index: index[k] = layer(tex)
            L = index[k]
        alpha = getattr(mat, 'alphaMode', None) == 'MASK' or any(w in mname for w in ('leaf', 'leaves', 'foliage', 'needle', 'alpha'))
        kind = 2 if 'emissive' in mname or 'glass' in mname else 3 if 'red_lens' in mname or mname.startswith('red lens') else 4 if 'amber' in mname else 5 if 'green_lens' in mname or 'green lens' in mname else 1 if alpha else 0
        for t in geom.faces:
            for i in t: V.append([*p[i], *nrm[i], uv[i][0], 1 - uv[i][1], L, *(col / 255), kind])
    a = np.array(V, np.float32); a[:, 0:2] -= 0; open(f'{OUT}/{key}.bin', 'wb').write(a.tobytes())
    print(key, len(a) // 3, 'trójkątów, wysokość', round(float(a[:, 2].max()), 2))
strip = Image.new('RGBA', (512, 512 * max(1, len(layers))))
for i, im in enumerate(layers): strip.paste(im, (0, 512 * i))
strip.save(f'{OUT}/tex.webp', quality=82, method=6, lossless=False)
json.dump({'layers': len(layers)}, open(f'{OUT}/index.json', 'w'))
print('warstw tekstur', len(layers))
