// Silnik jazdy w Three.js: jedna scena 3D nad mapą w czasie nawigacji po Lublinie.
// Mapa pod spodem rysuje tylko ziemię (trawniki, woda) i podaje kamerę. Wszystko, co stoi albo leży na drodze, jest tutaj:
// jezdnie, chodniki, krawężniki, budynki, drzewa, latarnie, znaki, wstęga i znacznik auta.
// Prawdziwe cienie słońca, zacienienie w zakamarkach (GTAO), poświata na Ultra i obróbka kolorów, która nie przekłamuje barw (Neutral).
// Układ współrzędnych: metry Merkatora jak w city3d.js, x na wschód, y na północ, z w górę, początek blisko auta.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ribbonMesh, puckMesh, RIB, PN } from './solid.js';
import { FACADE_M } from './facade-size.js';
import { VS_SOL, FS_SOL, FS_UNDER, VS_PUCK, FS_PUCK, SIGN_KMH, W } from './city3d.js';

const SUN = new THREE.Vector3(-0.35, -0.45, 0.82).normalize(); // kierunek do słońca, ten sam co w starym silniku
const mercX = (lng) => (lng * W) / 360;
const mercY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * W) / (2 * Math.PI);

// Ustawienia jakości silnika Three.js (obok QUALITY_PROFILES z profiles.js).
const Q3 = {
  ultra: { shadow: 4096, shadowR: 320, ao: true, bloom: true, trees: 700 },
  high: { shadow: 2048, shadowR: 260, ao: true, bloom: false, trees: 520 },
  eco: { shadow: 1024, shadowR: 200, ao: false, bloom: false, trees: 360 },
};

// Wstęga i znacznik mają dopracowany wygląd we własnych shaderach: kolor z nich jest już „ekranowy”.
// Cały obraz przechodzi na końcu przez obróbkę „Neutral” (Khronos PBR Neutral: nie przekłamuje barw) i sRGB,
// więc tu ten kolor odwracamy, żeby po obróbce wyszedł taki jak dawniej.
const UNTONE = `
vec3 untone(vec3 c){
  c=clamp(c,0.0,0.995);
  vec3 y=mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(0.04045,c));
  float pk=max(y.r,max(y.g,y.b));
  if(pk>0.76){ float d=0.24; float p0=d*d/(1.0-pk)-d+0.76; y*=p0/pk; }
  float m=min(y.r,min(y.g,y.b)); float x=m<0.04?sqrt(m/6.25):m+0.04;
  return y+(x-m);
}`;

/** Shader z city3d.js jako materiał Three.js: macierz u_m składa Three, a kolor wraca do przestrzeni przed obróbką. */
function rawMat(vs, fs, uniforms, { apow = 1, ...opts } = {}) {
  const v = vs.replace('#version 300 es\n', '').replace('uniform mat4 u_m;', 'uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;\n#define u_m (projectionMatrix*modelViewMatrix)\n');
  const f = fs.replace('#version 300 es\n', '').replace('out vec4 o;', `out vec4 o_; vec4 o;\n${UNTONE}\n`).replace('void main(){', 'void main_(){') + `\nvoid main(){ main_(); o_=vec4(untone(o.rgb),pow(o.a,${apow.toFixed(2)})); }\n`;
  return new THREE.RawShaderMaterial({ vertexShader: v, fragmentShader: f, glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms, ...opts });
}

/** Tekstura z pliku: powtarzana, ostra pod kątem, bez odwracania (tak jak w starym silniku). */
function loadTex(url, renderer, srgb = true) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Nav3D {
  constructor(map, getCity, { quality = 'high' } = {}) {
    this.map = map; this.getCity = getCity; this.qid = quality; this.enabled = true;
    this.tiles = new Map(); this.loading = 0; this.pending = new Set(); this.t = 0; this.O = null;
    const canvas = document.createElement('canvas'); canvas.id = 'three';
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none';
    const mc = map.getCanvas(); mc.parentNode.insertBefore(canvas, mc.nextSibling); this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setClearColor(0x000000, 0); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1; r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    const scene = new THREE.Scene(); this.scene = scene;
    const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5; pm.dispose();
    this.camera = new THREE.PerspectiveCamera(); this.camera.matrixAutoUpdate = false;
    this.hemi = new THREE.HemisphereLight(0xb8c8e6, 0x81796a, 1.15); this.hemi.position.set(0, 0, 1); scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.castShadow = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
    scene.add(sun); scene.add(sun.target); this.sun = sun;
    scene.fog = new THREE.Fog(0xa8c2d6, 900, 3400);
    // niebo właściciela: kopuła wokół kamery i odbicia w szybach, wodzie i wstędze
    const sky = new THREE.TextureLoader().load('./icons/t3-niebo.webp', (t) => {
      const g = new THREE.PMREMGenerator(r); scene.environment = g.fromEquirectangular(t).texture; g.dispose();
    });
    sky.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.SphereGeometry(1, 64, 32); dome.rotateX(Math.PI / 2);
    // panorama ma horyzont na 89% wysokości obrazka, a nie w połowie: wysokość nad horyzontem rozkładamy na górne 89%
    { const P = dome.attributes.position; const U = dome.attributes.uv;
      for (let i = 0; i < P.count; i++) { const e = Math.asin(Math.max(-1, Math.min(1, P.getZ(i)))) / (Math.PI / 2); U.setY(i, 1 - (e >= 0 ? 0.89 * (1 - e) : 0.89 - 0.11 * e)); } }
    this.sky = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }));
    // słońce z panoramy obrócone w stronę światła sceny
    this.sky.rotation.z = Math.atan2(SUN.y, SUN.x) - 1.257; this.sky.renderOrder = -100; this.sky.frustumCulled = false; this.sky.visible = false; scene.add(this.sky);
    scene.environmentRotation.set(Math.PI / 2, 0, 0);
    this.world = new THREE.Group(); scene.add(this.world);
    this.mats = this.materials();
    this.inst = new Map(); this.instDirty = true;
    // wygładzanie krawędzi: wielopróbkowy bufor (WebGL2), bo zwykłe antialias nie działa przy obróbce obrazu
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.setQuality(quality);
    this.loadModels();
    this.layer = { id: 'nav3d-sync', type: 'custom', renderingMode: '3d', render: (gl, args) => this.frame(args) };
  }

  setQuality(id) {
    this.qid = id; const q = Q3[id] || Q3.high; this.q = q;
    this.sun.shadow.mapSize.set(q.shadow, q.shadow); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    const c = this.sun.shadow.camera; c.left = -q.shadowR; c.right = q.shadowR; c.top = q.shadowR; c.bottom = -q.shadowR; c.near = 10; c.far = 3000; c.updateProjectionMatrix();
    const passes = this.composer.passes; while (passes.length > 1) this.composer.removePass(passes[passes.length - 1]);
    const w = Math.max(1, this.canvas.clientWidth); const h = Math.max(1, this.canvas.clientHeight);
    this.ao = null; this.bloom = null;
    if (q.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, w, h);
      this.ao.updateGtaoMaterial({ radius: 3.5, distanceExponent: 1.5, thickness: 3, scale: 1.2, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.ao.blendIntensity = 0.85; this.composer.addPass(this.ao);
    }
    if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.35, 0.92); this.composer.addPass(this.bloom); }
    this.composer.addPass(new OutputPass());
    this.size = null; this.instDirty = true;
  }

  /** Materiały dróg, krawężników, budynków i linii. */
  materials() {
    const r = this.renderer; const night = () => this.night;
    const atlas = loadTex(`./icons/city2-atlas-day.webp`, r); const roofs = loadTex('./icons/city2-roofs.webp', r);
    const cut = { u_camp: { value: new THREE.Vector2() }, u_car: { value: new THREE.Vector2() }, u_camz: { value: 0 } };
    this.cut = cut;
    const CUT = `
uniform vec2 u_camp; uniform vec2 u_car; uniform float u_camz; varying vec3 v_wp;
void cutAway(vec3 p){
  vec2 ab=u_car-u_camp; float l=dot(ab,ab); if(l<1.0) return;
  float t=dot(p.xy-u_camp,ab)/l; if(t<0.0||t>1.0) return;
  float d=length(p.xy-(u_camp+ab*t)); float r=mix(14.0,5.0,t);
  if(p.z<mix(u_camz,1.5,t)-1.0) return;
  float f=smoothstep(r,r+3.0,d);
  if(f<1.0 && f<fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))) discard;
}`;
    // budynki: ściany z atlasu elewacji (komórka wg funkcji budynku, współrzędne w metrach), dachy z atlasu dachów
    const building = (fragMap, extraAttr) => {
      const m = new THREE.MeshStandardMaterial({ map: fragMap === 'wall' ? atlas : roofs, roughness: fragMap === 'wall' ? 0.82 : 0.7, metalness: 0, vertexColors: fragMap !== 'wall', side: THREE.DoubleSide });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, cut, { u_fm: { value: FACADE_M } });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute float ${extraAttr}; varying float v_x; varying vec3 v_wp;`)
          .replace('#include <project_vertex>', `#include <project_vertex>\nv_x=${extraAttr}; v_wp=(modelMatrix*vec4(transformed,1.0)).xyz;`);
        const pick = fragMap === 'wall'
          ? `{ float c=floor(v_x+0.5); vec2 cell=vec2(mod(c,4.0),floor(c/4.0)); vec2 uv=vMapUv/u_fm[int(c)]; vec2 f=fract(uv); vec2 s=vec2(0.25,1.0/6.0);
              vec4 tx=textureGrad(map,(cell+0.005+f*0.99)*s,dFdx(uv)*s,dFdy(uv)*s); tx.rgb=mix(tx.rgb,vec3(dot(tx.rgb,vec3(.3,.55,.15))),0.15); diffuseColor*=tx; }`
          : `{ float k=floor(v_x+0.5); bool p=k>2.5; float g=p?(abs(k-4.0)<0.5?1.0:0.0):2.0; vec2 sc=vec2(1.0/3.0,1.0); vec2 f=fract(vMapUv);
              diffuseColor*=textureGrad(map,vec2(g/3.0,0.0)+(0.01+f*0.98)*sc,dFdx(vMapUv)*sc,dFdy(vMapUv)*sc); }`;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying float v_x;${fragMap === 'wall' ? '\nuniform float u_fm[24];' : ''}\n${CUT}`)
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\ncutAway(v_wp);')
          .replace('#include <map_fragment>', pick);
      };
      m.customProgramCacheKey = () => fragMap;
      return m;
    };
    // nawierzchnie z tekstur właściciela (tools/build-tex3.py): kolor, nierówności i duża, wolna zmiana jasności, żeby nie było widać powtórzeń
    const T = (n, srgb = true) => loadTex(`./icons/t3-${n}.webp`, r, srgb);
    const surf = (name, rough, ns, color = 0xffffff) => {
      const m = new THREE.MeshStandardMaterial({ map: T(name), normalMap: T(`${name}-n`, false), normalScale: new THREE.Vector2(ns, ns), roughness: rough, metalness: 0, vertexColors: true, color, side: THREE.DoubleSide });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  { float avg=dot(textureLod(map,vMapUv,11.0).rgb,vec3(0.333)); float big=dot(texture(map,vMapUv*0.0713+vec2(0.31,0.57)).rgb,vec3(0.333));
    float big2=dot(texture(map,vMapUv*0.0191+vec2(0.71,0.13)).rgb,vec3(0.333));
    diffuseColor.rgb*=clamp(1.0+0.9*(big-avg)+0.9*(big2-avg),0.72,1.28); }`);
      };
      m.customProgramCacheKey = () => 'surf';
      return m;
    };
    this.surf = surf;
    const mark = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0xe6e6e0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
    mark.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 a_mk; varying vec2 v_mk;').replace('#include <begin_vertex>', '#include <begin_vertex>\nv_mk=a_mk;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 v_mk;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif(v_mk.y>0.5 && fract(v_mk.x/9.0)>0.42) discard;');
    };
    return {
      asphalt: surf('asfalt', 0.9, 0.6), asphaltOld: surf('asfalt-stary', 0.92, 0.7), slabs: surf('plyty', 0.85, 0.8), kostka: surf('kostka', 0.85, 0.9),
      kerb: surf('kraweznik', 0.8, 0.6, 0xf2f2ee), gravel: surf('asfalt-stary', 1, 0.9, 0xc8b89a), mark,
      curb: surf('kraweznik', 0.78, 0.7, 0xf4f4f0),
      grass: surf('trawa', 0.95, 0.9), water: new THREE.MeshStandardMaterial({ color: 0x3f7fae, roughness: 0.08, metalness: 0.1, envMapIntensity: 1.4 }),
      wall: building('wall', 'a_cell'), roof: building('roof', 'a_kind'), night,
    };
  }

  /** Modele właściciela z city/models (format build-models.py): osobna siatka na teksturę i rodzaj materiału. */
  async loadModels() {
    try {
      const names = ['lipa', 'dab', 'brzoza', 'sosna', 'krzew', 'latarnia', 'sygnalizator', 'znak'];
      const bufs = await Promise.all(names.map((n) => fetch(`./city/models/${n}.bin`).then((x) => { if (!x.ok) throw new Error(n); return x.arrayBuffer(); })));
      const img = await fetch('./city/models/tex.webp').then((x) => x.blob()).then((b) => createImageBitmap(b));
      const layers = []; const an = this.renderer.capabilities.getMaxAnisotropy();
      for (let i = 0; i < img.height / 512; i++) {
        const c = document.createElement('canvas'); c.width = c.height = 512; c.getContext('2d').drawImage(img, 0, i * 512, 512, 512, 0, 0, 512, 512);
        const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, an); layers.push(t);
      }
      const mats = new Map();
      const mat = (layer, kind) => {
        const key = `${layer}|${kind}`; if (mats.has(key)) return mats.get(key);
        let m;
        if (kind === 2) m = new THREE.MeshStandardMaterial({ color: 0xdadbd4, emissive: 0xffeec0, emissiveIntensity: 0, roughness: 0.3 });
        else if (kind >= 3) m = new THREE.MeshStandardMaterial({ color: [0, 0, 0, 0xf52a1c, 0xf0b020, 0x1fd27a][kind], emissive: [0, 0, 0, 0xff2a10, 0xffa000, 0x10ff70][kind], emissiveIntensity: 0.6, roughness: 0.25 });
        else m = new THREE.MeshStandardMaterial({ map: layer >= 0 ? layers[layer] : null, vertexColors: true, roughness: kind === 1 ? 0.75 : 0.6, metalness: 0, alphaTest: kind === 1 ? 0.3 : 0, side: kind === 1 ? THREE.DoubleSide : THREE.FrontSide });
        if (kind === 2) this.lampGlass = m;
        mats.set(key, m); return m;
      };
      const models = {};
      names.forEach((n, i) => {
        const d = new Float32Array(bufs[i]); const groups = new Map(); let h = 0;
        for (let k = 0; k < d.length; k += 13) {
          h = Math.max(h, d[k + 2]);
          const key = `${d[k + 8]}|${d[k + 12]}`; if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(k);
        }
        models[n] = { h, parts: [...groups.entries()].map(([key, idx]) => {
          const [layer, kind] = key.split('|').map(Number); const nv = idx.length;
          const p = new Float32Array(nv * 3); const nr = new Float32Array(nv * 3); const uv = new Float32Array(nv * 2); const col = new Float32Array(nv * 3);
          idx.forEach((k, j) => { p.set(d.subarray(k, k + 3), j * 3); nr.set(d.subarray(k + 3, k + 6), j * 3); uv.set(d.subarray(k + 6, k + 8), j * 2); col.set(d.subarray(k + 9, k + 12), j * 3); });
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          return { g, m: mat(layer, Math.round(kind)) };
        }) };
      });
      this.models = models; this.instDirty = true; this.signsDirty = true;
    } catch (e) { console.warn('nav3d: modele', e); this.models = null; }
  }

  /** Kafle wokół punktu przed autem: te same pliki co city3d.js (przeglądarka ma je już w pamięci podręcznej). */
  update(city) {
    const g = city.grid; const [x, y] = this.eye; const br = (this.map.getBearing() * Math.PI) / 180;
    const ax = x + Math.sin(br) * 500; const ay = y + Math.cos(br) * 420; const R = city.q.radius; const want = [];
    for (let i = Math.floor((ax - R) / g); i <= Math.floor((ax + R) / g); i++) {
      for (let j = Math.floor((ay - R) / g); j <= Math.floor((ay + R) / g); j++) {
        const k = `${i}_${j}`; if (!city.index.has(k) || this.tiles.has(k) || this.pending.has(k)) continue;
        want.push([Math.hypot((i + 0.5) * g - x, (j + 0.5) * g - y), k]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, k] of want) {
      if (this.loading >= 4) break;
      this.pending.add(k); this.loading++;
      Promise.all([city.bld.has(k) ? city.get(`${city.base}${k}.bin`).catch(() => null) : null, city.treeIndex.has(k) ? city.get(`${city.base}${k}.t.bin`).catch(() => null) : null,
        city.roadIndex.has(k) ? city.get(`${city.base}${k}.r.bin`).catch(() => null) : null])
        .then(([b, t, r]) => { if (!this.disposed) this.build(k, g, b, t, r); this.map.triggerRepaint(); })
        .finally(() => { this.loading--; this.pending.delete(k); });
    }
    for (const [k, t] of this.tiles) if (Math.hypot(t.ox + g / 2 - x, t.oy + g / 2 - y) > city.q.drop) this.drop(k);
  }

  drop(k) {
    const t = this.tiles.get(k); this.world.remove(t.group);
    t.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.tiles.delete(k); this.instDirty = true;
  }

  /** Jeden kafel: jezdnie i chodniki wg rodzaju, linie, krawężniki, ściany i dachy. Latarnie i drzewa idą do wspólnych instancji. */
  build(k, g, b, tr, r) {
    const [i, j] = k.split('_').map(Number); const ox = i * g; const oy = j * g;
    const group = new THREE.Group(); group.position.set(ox - this.O[0], oy - this.O[1], 0);
    const tile = { ox, oy, group, trees: null, props: null };
    const add = (geo, mat, { cast = false, recv = true, order = 0 } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; m.renderOrder = order; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); return m; };
    const geo = (attrs) => { const ge = new THREE.BufferGeometry(); for (const [n, a, s] of attrs) ge.setAttribute(n, new THREE.BufferAttribute(a, s)); ge.computeBoundingSphere(); return ge; };
    const wx = ox % 4000; const wy = oy % 4000;
    if (r) {
      const h = new Uint32Array(r, 0, 2); const n = h[0]; const m = h[1];
      const s = new Float32Array(r, 8, n * 3);
      // jezdnie (2, 5, 6, 7), chodniki i kocie łby (0, 3), góra krawężnika (1), żwir (4)
      const bucket = { asphalt: [], asphaltOld: [], slabs: [], kostka: [], kerb: [], gravel: [] };
      const BY = ['slabs', 'kerb', 'asphalt', 'kostka', 'gravel', 'asphalt', 'asphaltOld', 'asphaltOld'];
      for (let q = 0; q < n; q += 3) bucket[BY[Math.round(s[q * 3 + 2])] || 'gravel'].push(q);
      for (const [name, list] of Object.entries(bucket)) {
        if (!list.length) continue;
        const nv = list.length * 3; const p = new Float32Array(nv * 3); const uv = new Float32Array(nv * 2); const col = new Float32Array(nv * 3); const nr = new Float32Array(nv * 3);
        let v = 0;
        for (const q of list) for (let e = 0; e < 3; e++, v++) {
          const x = s[(q + e) * 3]; const y = s[(q + e) * 3 + 1]; const kind = Math.round(s[(q + e) * 3 + 2]);
          const up = kind === 0 || kind === 1 ? 0.4 : 0;
          p.set([x, y, up], v * 3); nr.set([0, 0, 1], v * 3);
          // metry Merkatora: płyta 50 cm, kostka i krawężnik ok. 1 m, asfalt 2,5 m na powtórzenie
          const sc = kind === 0 || kind === 1 || kind === 3 ? 1.6 : 4;
          uv.set([(x + wx) / sc, (y + wy) / sc], v * 2);
          const c = kind === 2 ? [0.9, 0.9, 0.9] : kind === 5 ? [1, 1, 1] : kind === 7 ? [1.06, 1.06, 1.06] : [1, 1, 1];
          col.set(c, v * 3);
        }
        add(geo([['position', p, 3], ['normal', nr, 3], ['uv', uv, 2], ['color', col, 3]]), this.mats[name]);
      }
      if (m) {
        const a = new Float32Array(r, 8 + n * 12, m * 4); const p = new Float32Array(m * 3); const mk = new Float32Array(m * 2); const nr = new Float32Array(m * 3);
        for (let q = 0; q < m; q++) { p.set([a[q * 4], a[q * 4 + 1], 0.02], q * 3); mk.set([a[q * 4 + 2], a[q * 4 + 3]], q * 2); nr.set([0, 0, 1], q * 3); }
        add(geo([['position', p, 3], ['normal', nr, 3], ['a_mk', mk, 2]]), this.mats.mark, { order: 1 });
      }
      const co = 8 + n * 12 + m * 16; let c = 0;
      if (r.byteLength >= co + 4) {
        c = new Uint32Array(r.slice(co, co + 4))[0];
        if (c) {
          // tylko boki krawężników: cień przy nich robi teraz prawdziwe światło
          const a = new Float32Array(r.slice(co + 4, co + 4 + c * 24)); const P = []; const N = []; const C = []; const U = [];
          for (let q = 0; q + 2 < c; q += 3) {
            if (a[q * 6 + 3] < 0 || a[(q + 1) * 6 + 3] < 0 || a[(q + 2) * 6 + 3] < 0) continue;
            for (let e = 0; e < 3; e++) {
              const o = (q + e) * 6; P.push(a[o], a[o + 1], a[o + 2]); N.push(a[o + 4], a[o + 5], 0); const l = 0.82 + 0.18 * a[o + 3]; C.push(l, l, l);
              // wzdłuż krawężnika metr na powtórzenie, w pionie cała wysokość tekstury (góra obrazka to górna krawędź)
              U.push(((a[o] + wx) * -a[o + 5] + (a[o + 1] + wy) * a[o + 4]) / 1.6, 1 - a[o + 3]);
            }
          }
          if (P.length) add(geo([['position', new Float32Array(P), 3], ['normal', new Float32Array(N), 3], ['color', new Float32Array(C), 3], ['uv', new Float32Array(U), 2]]), this.mats.curb, { cast: true });
        }
      }
      const po = co + 4 + c * 24;
      if (r.byteLength >= po + 4) { const np = new Uint32Array(r.slice(po, po + 4))[0]; tile.props = new Float32Array(r.slice(po + 4, po + 4 + np * 16)); }
    }
    if (b) {
      const h = new Uint32Array(b, 0, 2); const nw = h[0]; const nr = h[1];
      if (nw) {
        const a = new Float32Array(b, 8, nw * 6); const p = new Float32Array(nw * 3); const uv = new Float32Array(nw * 2); const cell = new Float32Array(nw);
        for (let q = 0; q < nw; q++) { p.set([a[q * 6], a[q * 6 + 1], a[q * 6 + 2]], q * 3); uv.set([a[q * 6 + 3], a[q * 6 + 4]], q * 2); cell[q] = a[q * 6 + 5]; }
        const ge = geo([['position', p, 3], ['uv', uv, 2], ['a_cell', cell, 1]]); ge.computeVertexNormals();
        add(ge, this.mats.wall, { cast: true });
      }
      if (nr) {
        const a = new Float32Array(b, 8 + nw * 24, nr * 4); const p = new Float32Array(nr * 3); const uv = new Float32Array(nr * 2); const kd = new Float32Array(nr); const col = new Float32Array(nr * 3);
        const v3 = (q) => [a[q * 4], a[q * 4 + 1], a[q * 4 + 2]];
        for (let q = 0; q + 2 < nr; q += 3) {
          const A = v3(q); const B = v3(q + 1); const Cc = v3(q + 2);
          const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]; const w = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
          let nx = u[1] * w[2] - u[2] * w[1]; let ny = u[2] * w[0] - u[0] * w[2]; let nz = u[0] * w[1] - u[1] * w[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const lt = Math.hypot(nx, ny); const t = lt > 0.05 ? [-ny / lt, nx / lt, 0] : [1, 0, 0];
          const bb = [ny * t[2] - nz * t[1], nz * t[0] - nx * t[2], nx * t[1] - ny * t[0]];
          for (let e = 0; e < 3; e++) {
            const P = v3(q + e); const kind = Math.round(a[(q + e) * 4 + 3]); const pr = kind >= 3; const sc = pr ? (kind === 4 ? 6 : 5) : 10;
            p.set(P, (q + e) * 3); kd[q + e] = kind;
            uv.set([(P[0] * t[0] + P[1] * t[1] + P[2] * t[2]) / sc, (P[0] * bb[0] + P[1] * bb[1] + P[2] * bb[2]) / sc], (q + e) * 2);
            const tint = kind === 5 ? [0.82, 0.7, 0.64] : kind === 1 ? [1.1, 1.1, 1.1] : kind === 2 ? [0.88, 0.88, 0.88] : [1, 1, 1];
            col.set(tint, (q + e) * 3);
          }
        }
        const ge = geo([['position', p, 3], ['uv', uv, 2], ['a_kind', kd, 1], ['color', col, 3]]); ge.computeVertexNormals();
        add(ge, this.mats.roof, { cast: true });
      }
    }
    if (tr) tile.trees = new Float32Array(tr instanceof ArrayBuffer ? tr.slice(0) : tr);
    if (this.tiles.has(k)) this.drop(k);
    this.tiles.set(k, tile); this.world.add(group); this.instDirty = true;
  }

  /** Drzewa (blisko auta), latarnie, sygnalizatory i znaki jako instancje modeli. */
  rebuildInstances() {
    if (!this.models) return;
    const lists = new Map(); const K = this.K; const near = this.q.trees; const [ex, ey] = this.eye;
    const push = (name, sx, x, y, z, ang, s, sz) => {
      const key = `${name}:${sx}`; if (!lists.has(key)) lists.set(key, { name, a: [] });
      const c = Math.cos(ang); const sn = Math.sin(ang); const lx = x - this.O[0]; const ly = y - this.O[1];
      lists.get(key).a.push(c * s * sx, sn * s * sx, 0, 0, -sn * s * sx, c * s * sx, 0, 0, 0, 0, sz, 0, lx, ly, z, 1);
    };
    const fr = (v) => v - Math.floor(v);
    for (const t of this.tiles.values()) {
      if (t.props) for (let q = 0; q < t.props.length; q += 4) push(t.props[q + 2] ? 'sygnalizator' : 'latarnia', 1, t.ox + t.props[q], t.oy + t.props[q + 1], 0, t.props[q + 3], K, K);
      if (!t.trees) continue;
      const a = t.trees;
      for (let q = 0; q < a.length; q += 4) {
        const x = a[q]; const y = a[q + 1];
        if (Math.hypot(t.ox + x - ex, t.oy + y - ey) > near) continue;
        let h = a[q + 2] * 1.25; const kind = Math.floor(a[q + 3]);
        const r = fr(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
        const sp = kind < 0.5 ? 5 : h < 4.5 ? 7 : r < 0.24 ? 0 : r < 0.4 ? 1 : r < 0.56 ? 2 : r < 0.76 ? 3 : r < 0.84 ? 4 : 6;
        if (sp === 7) h *= 0.5;
        const [name, sx] = [['lipa', 1], ['dab', 1], ['brzoza', 1], ['lipa', 1], ['lipa', 0.55], ['sosna', 1], ['lipa', 0.8], ['krzew', 1]][sp];
        const s = h / this.models[name].h; push(name, sx, t.ox + x, t.oy + y, 0, r * 6.2832, s, s);
      }
    }
    for (const sg of this.signList || []) push('znak', 1, sg.x, sg.y, 0, sg.ang, K, K);
    for (const [key, e] of this.inst) if (!lists.has(key)) for (const m of e.meshes) m.count = 0;
    for (const [key, { name, a }] of lists) {
      const n = a.length / 16; let e = this.inst.get(key);
      if (!e || e.cap < n) {
        if (e) for (const m of e.meshes) { this.scene.remove(m); m.dispose(); }
        const cap = Math.ceil(n * 1.5) + 8;
        e = { cap, meshes: this.models[name].parts.map(({ g, m }) => { const im = new THREE.InstancedMesh(g, m, cap); im.frustumCulled = false; im.castShadow = name !== 'krzew'; im.receiveShadow = true; this.scene.add(im); return im; }) };
        this.inst.set(key, e);
      }
      for (const m of e.meshes) { m.instanceMatrix.array.set(a); m.count = n; m.instanceMatrix.needsUpdate = true; }
    }
    this.instEye = [ex, ey]; this.instDirty = false;
  }

  /** Cyfry na tarczach znaków: kwadrat z liczbą przed białą tarczą modelu. */
  rebuildSignNumbers() {
    if (this.signNums) { this.scene.remove(this.signNums); this.signNums.traverse((o) => o.geometry && o.geometry.dispose()); }
    this.signNums = new THREE.Group(); this.scene.add(this.signNums);
    this.numTex = this.numTex || new Map(); const K = this.K;
    for (const sg of this.signList || []) {
      let t = this.numTex.get(sg.kmh);
      if (!t) {
        const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
        const s = String(sg.kmh); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${s.length > 2 ? 62 : 84}px Arial, sans-serif`; g.fillText(s, 64, 68);
        t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.numTex.set(sg.kmh, t);
      }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, roughness: 0.6 }));
      const ex = new THREE.Vector3(Math.cos(sg.ang), Math.sin(sg.ang), 0); const ey = new THREE.Vector3(-Math.sin(sg.ang), Math.cos(sg.ang), 0);
      m.matrix.makeBasis(ey, new THREE.Vector3(0, 0, 1), ex).scale(new THREE.Vector3(K, K, K));
      m.matrix.setPosition(sg.x - this.O[0] + ex.x * 0.078 * K, sg.y - this.O[1] + ex.y * 0.078 * K, 2.48 * K);
      m.matrixAutoUpdate = false; this.signNums.add(m);
    }
    this.signsDirty = false;
  }

  /** Ziemia z BDOT10k (ground.json, ten sam plik co dla mapy): trawniki, lasy, pola, place, woda; pod spodem trawa do horyzontu. */
  async loadGround(city) {
    this.groundLoading = true;
    try {
      const d = await fetch(`${city.base}ground.json`).then((x) => x.json());
      const O = this.O; const ox = O[0] % 4000; const oy = O[1] % 4000;
      const KIND = { grass: ['grass', [1, 1, 1], 4.8], house: ['grass', [1, 1, 1], 4.8], estate: ['grass', [0.97, 1, 0.95], 4.8], wood: ['grass', [0.55, 0.68, 0.5], 4.8],
        field: ['grass', [1.0, 0.98, 0.8], 6], bare: ['gravel', [1, 1, 1], 4], paved: ['kostka', [1, 1, 1], 1.6], water: ['water', [1, 1, 1], 8] };
      const acc = {};
      for (const f of d.features) {
        const k = KIND[f.properties.k]; if (!k) continue;
        const rings = f.geometry.coordinates.map((r) => { const a = r.map(([lng, lat]) => new THREE.Vector2(mercX(lng) - O[0], mercY(lat) - O[1])); if (a.length > 1 && a[0].equals(a[a.length - 1])) a.pop(); return a; });
        if (rings[0].length < 3) continue;
        const tris = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1)); const all = rings.flat();
        const key = f.properties.k === 'water' ? 'water' : `${k[0]}|${f.properties.k}`;
        const a = acc[key] || (acc[key] = { mat: k[0], col: k[1], sc: k[2], z: f.properties.k === 'water' ? -0.03 : f.properties.k === 'paved' ? -0.04 : -0.05, P: [], U: [] });
        for (const t of tris) for (const i of t) { const v = all[i]; a.P.push(v.x, v.y, a.z); a.U.push((v.x + ox) / a.sc, (v.y + oy) / a.sc); }
      }
      for (const a of Object.values(acc)) {
        const n = a.P.length / 3; const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(a.U, 2));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => a.col[i % 3]), 3));
        const m = new THREE.Mesh(g, this.mats[a.mat]); m.receiveShadow = true; m.renderOrder = -2; this.scene.add(m);
      }
    } catch (e) { console.warn('nav3d: ziemia', e); }
    // trawa pod wszystkim, 24 km w każdą stronę
    const S = 48000; const g = new THREE.PlaneGeometry(S, S); const uv = g.attributes.uv; const ox = this.O[0] % 4000; const oy = this.O[1] % 4000;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ((uv.getX(i) - 0.5) * S + ox) / 4.8, ((uv.getY(i) - 0.5) * S + oy) / 4.8);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(uv.count * 3).fill(0.92), 3));
    const bg = new THREE.Mesh(g, this.mats.grass); bg.position.z = -0.4; bg.receiveShadow = true; bg.renderOrder = -3; this.scene.add(bg);
  }

  /** Wstęga z solid.js w shaderach starego silnika (wygląd zatwierdzony przez właściciela) i asfalt pod torem bez jezdni w BDOT. */
  setRoute(path, turns) {
    this.routeKey = path; this.turns = turns;
    for (const o of [this.rib, this.ribU, this.ribG, this.capM, this.fillM]) if (o) { this.scene.remove(o); o.geometry.dispose(); }
    this.rib = this.ribU = this.ribG = this.capM = this.fillM = null;
    if (!path) return;
    const org = path.pts[0]; const mesh = ribbonMesh(path, turns || [], { style: 'up' }); this.ribOrg = org; this.ribMesh = mesh;
    const mk = (data, index) => {
      const g = new THREE.BufferGeometry(); const ib = new THREE.InterleavedBuffer(data, 17);
      for (const [n, size, off] of [['a_c', 2, 0], ['a_n', 2, 2], ['a_off', 2, 4], ['a_nrm', 3, 6], ['a_l', 1, 9], ['a_u', 1, 10], ['a_top', 1, 11], ['a_off0', 2, 12], ['a_nrm0', 3, 14]]) g.setAttribute(n, new THREE.InterleavedBufferAttribute(ib, size, off));
      g.setIndex(new THREE.BufferAttribute(index, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); return g;
    };
    const u = this.ribUni || (this.ribUni = { u_from: { value: 0 }, u_heads: { value: new Float32Array(4) }, u_leads: { value: new Float32Array(4) }, u_t: { value: 0 }, u_night: { value: 0 }, u_jam: { value: new Float32Array(18) }, u_eye: { value: new THREE.Vector3() }, u_hw: { value: RIB.hw } });
    const pos = (m, order) => { m.position.set(org[0] - this.O[0], org[1] - this.O[1], 0); m.renderOrder = order; m.frustumCulled = false; this.scene.add(m); return m; };
    this.ribU = pos(new THREE.Mesh(mk(mesh.under.data, mesh.under.index), rawMat(VS_SOL, FS_UNDER, u, { transparent: true, depthWrite: false, apow: 1.7 })), 20);
    this.ribG = pos(new THREE.Mesh(mk(mesh.data, mesh.index), rawMat(VS_SOL, FS_SOL, { ...u, u_ghost: { value: 1 } }, { transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth })), 21);
    this.rib = pos(new THREE.Mesh(this.ribG.geometry, rawMat(VS_SOL, FS_SOL, { ...u, u_ghost: { value: 0 } }, { transparent: true, depthWrite: true })), 22);
    const fan = []; for (let j = 1; j < PN - 1; j++) fan.push(0, j + 1, j);
    this.capData = new Float32Array(PN * 17);
    this.capM = pos(new THREE.Mesh(mk(this.capData, new Uint32Array(fan)), this.rib.material), 23);
    this.fillM = this.fillMesh(path);
  }

  fillMesh(path) {
    const runs = path.fill || []; if (!runs.length) return null;
    const { pts, along, K } = path; const P = []; const UV = []; const C = [];
    const at = (s) => { let i = along.findIndex((x) => x >= s); if (i < 0) i = along.length - 1; return Math.max(1, Math.min(pts.length - 2, i)); };
    const vx = (q) => { P.push(q[0] - this.O[0], q[1] - this.O[1], 0); UV.push((q[0] % 4000) / 4, (q[1] % 4000) / 4); C.push(1, 1, 1); };
    for (const [a, b] of runs) {
      let prev = null;
      for (let i = at(a); i <= at(b); i++) {
        const p = pts[i]; const q0 = pts[i - 1]; const q1 = pts[i + 1]; const l = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1;
        const nx = (-(q1[1] - q0[1]) / l) * 3 * K; const ny = ((q1[0] - q0[0]) / l) * 3 * K;
        const L = [p[0] + nx, p[1] + ny]; const R = [p[0] - nx, p[1] - ny];
        if (prev) for (const q of [prev[0], prev[1], R, prev[0], R, L]) vx(q);
        prev = [L, R];
      }
    }
    if (!P.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals(); const m = new THREE.Mesh(g, this.mats.asphaltOld); m.receiveShadow = true; this.scene.add(m); return m;
  }

  puck() {
    if (this.puckBody) return;
    const d = puckMesh(); const n = d.length / 7;
    const mk = (from, count) => {
      const g = new THREE.BufferGeometry(); const ib = new THREE.InterleavedBuffer(d.slice(from * 7, (from + count) * 7), 7);
      g.setAttribute('a_p', new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute('a_nrm', new THREE.InterleavedBufferAttribute(ib, 3, 3)); g.setAttribute('a_k', new THREE.InterleavedBufferAttribute(ib, 1, 6));
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0)); return g;
    };
    this.puckUni = { u_rot: { value: 0 }, u_size: { value: 1 }, u_eye: { value: new THREE.Vector3() }, u_night: { value: 0 } };
    this.puckShadow = new THREE.Mesh(mk(n - 6, 6), rawMat(VS_PUCK, FS_PUCK, this.puckUni, { transparent: true, depthWrite: false }));
    this.puckBody = new THREE.Mesh(mk(0, n - 6), rawMat(VS_PUCK, FS_PUCK, this.puckUni, { transparent: true, depthTest: false, depthWrite: false }));
    for (const [m, o] of [[this.puckShadow, 30], [this.puckBody, 31]]) { m.renderOrder = o; m.frustumCulled = false; this.scene.add(m); }
  }

  /** Kamera Three.js z macierzy mapy: ta sama perspektywa (z przesunięciem środka przez marginesy), sztywny widok z położenia kamery. */
  syncCamera(M) {
    const s = 1 / W; const O = this.O;
    const VP = new THREE.Matrix4().fromArray(Array.from(M)).multiply(new THREE.Matrix4().fromArray([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, (O[0] + W / 2) * s, (W / 2 - O[1]) * s, 0, 1]));
    const e = VP.elements; const row = (r) => new THREE.Vector3(e[r], e[4 + r], e[8 + r]);
    const fwd = row(3).normalize();
    // środek kamery: punkt, w którym x, y i w obrazu są zerowe
    const A = new THREE.Matrix3().set(e[0], e[4], e[8], e[1], e[5], e[9], e[3], e[7], e[11]);
    const C = new THREE.Vector3(-e[12], -e[13], -e[15]).applyMatrix3(A.invert());
    const up = row(1); up.addScaledVector(fwd, -up.dot(fwd)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const back = fwd.clone().negate();
    const Vinv = new THREE.Matrix4().makeBasis(right, up, back).setPosition(C);
    const P = VP.clone().multiply(Vinv); const k = -1 / P.elements[11];
    for (let i = 0; i < 16; i++) P.elements[i] *= k;
    const cam = this.camera; cam.projectionMatrix.copy(P); cam.projectionMatrixInverse.copy(P).invert();
    const a = P.elements[10]; const b = P.elements[14]; cam.near = b / (a - 1); cam.far = b / (a + 1);
    cam.matrix.copy(Vinv); cam.updateMatrixWorld(true);
    return C;
  }

  /** Klatka: wywołuje ją warstwa mapy w trakcie rysowania, więc obie warstwy obrazu zawsze pokazują tę samą chwilę. */
  frame(args) {
    const city = this.getCity();
    const on = this.enabled && city && city.ready && city.drive;
    if (city) city.hidden = !!on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (!on) return;
    const M = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : (args.modelViewProjectionMatrix || args);
    const c = this.map.getCenter(); this.eye = [mercX(c.lng), mercY(c.lat)]; this.K = 1 / Math.cos((c.lat * Math.PI) / 180);
    if (!this.O) this.O = [Math.round(this.eye[0] / 1000) * 1000, Math.round(this.eye[1] / 1000) * 1000];
    this.night = !!city.night;
    const now = performance.now();
    if (now - this.t > 400) { this.t = now; this.update(city); }
    if (!this.groundLoading) this.loadGround(city);
    // trasa, znaki i stan jazdy czytane z city3d.js, który dalej liczy je dla aplikacji
    if (city.path !== this.routeKey) this.setRoute(city.path, city.turns);
    if (city.signList !== this.signList) { this.signList = city.signList; this.signsDirty = true; this.instDirty = true; }
    if (this.instDirty || !this.instEye || Math.hypot(this.eye[0] - this.instEye[0], this.eye[1] - this.instEye[1]) > 60) this.rebuildInstances();
    if (this.signsDirty && this.models) this.rebuildSignNumbers();
    // rozmiar i ostrość jak w mapie
    const w = this.canvas.clientWidth; const h = this.canvas.clientHeight; const pr = this.map.getPixelRatio();
    if (!this.size || this.size[0] !== w || this.size[1] !== h || this.size[2] !== pr) {
      this.size = [w, h, pr]; this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false); this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    }
    const C = this.syncCamera(M);
    const L = [this.eye[0] - this.O[0], this.eye[1] - this.O[1]];
    // słońce i jego cień jadą razem z autem; ziemia z cieniem pod nim
    this.sun.target.position.set(L[0], L[1], 0); // słońce z przodu z prawej, dość nisko: cienie budynków, latarni i drzew kładą się w stronę kamery i są widoczne.
    // Kierunek idzie za kursem kamery powoli, żeby światło nie skakało na zakrętach.
    const bt = (-this.map.getBearing() * Math.PI) / 180 + Math.PI / 2 - 0.45;
    const dt = Math.min(5, (now - (this.lastT || now)) / 1000); this.lastT = now;
    this.sunAz = this.sunAz == null ? bt : this.sunAz + Math.atan2(Math.sin(bt - this.sunAz), Math.cos(bt - this.sunAz)) * (1 - Math.exp(-dt / 3));
    const el = 0.6; const sd = this.sunDir || new THREE.Vector3(Math.cos(this.sunAz) * Math.cos(el), Math.sin(this.sunAz) * Math.cos(el), Math.sin(el));
    this.sky.rotation.z = Math.atan2(sd.y, sd.x) - 1.257; this.sun.position.set(L[0] + sd.x * 1200, L[1] + sd.y * 1200, sd.z * 1200);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(C); this.sky.scale.setScalar(300); this.sky.material.color.set(this.night ? 0x141c2c : 0xffffff);
    const day = !this.night;
    this.sun.intensity = day ? 2.6 : 0.05; this.hemi.intensity = day ? 1.15 : 0.25; this.scene.fog.color.set(day ? 0xa8c2d6 : 0x101e30);
    if (this.lampGlass) this.lampGlass.emissiveIntensity = day ? 0 : 2.2;
    // wycinanie budynków między kamerą a autem, jak w starym silniku
    this.cut.u_camp.value.set(C.x, C.y); this.cut.u_car.value.set(L[0], L[1]); this.cut.u_camz.value = C.z;
    if (this.rib) {
      const u = this.ribUni; const from = city.along || 0; u.u_from.value = from; u.u_t.value = now / 1000; u.u_night.value = this.night ? 1 : 0;
      const hs = u.u_heads.value; const ls = u.u_leads.value; hs.fill(0); ls.fill(0); let k = 0;
      this.ribMesh.heads.forEach((hh, j) => { if (hh + 12 > from && k < 4) { hs[k] = hh; ls[k] = this.ribMesh.leads[j]; k++; } });
      const jam = u.u_jam.value; jam.fill(0); (city.jams || []).filter((j) => j.to > from).slice(0, 6).forEach((j, i) => jam.set([j.from, j.to, j.sev], i * 3));
      u.u_eye.value.set(C.x - this.rib.position.x, C.y - this.rib.position.y, C.z);
      const vis = !city.ribbonOff; this.rib.visible = this.ribG.visible = this.ribU.visible = vis;
      const cd = this.ribMesh.capAt(from + 0.01);
      this.capM.visible = vis && !!cd; if (cd) { this.capData.set(cd); this.capM.geometry.attributes.a_c.data.needsUpdate = true; }
    }
    this.puck();
    const hd = city.carHd; this.puckBody.visible = this.puckShadow.visible = hd != null;
    if (hd != null) {
      this.puckUni.u_rot.value = (hd * Math.PI) / 180; this.puckUni.u_size.value = (city.puckPx || 58) * (W / (512 * 2 ** this.map.getZoom()));
      this.puckUni.u_night.value = this.night ? 1 : 0; this.puckUni.u_eye.value.set(C.x - L[0], C.y - L[1], C.z);
      for (const m of [this.puckBody, this.puckShadow]) m.position.set(L[0], L[1], 0);
    }
    if (this.bloom) this.bloom.strength = this.night ? 0.6 : 0.32;
    this.composer.render();
  }

  dispose() {
    this.disposed = true; const city = this.getCity(); if (city) city.hidden = false;
    this.renderer.dispose(); this.canvas.remove();
  }
}
