// Własny silnik miasta 3D: rysuje prawdziwe bryły budynków (GUGiK LoD2, tools/build-city.py) wewnątrz mapy.
// Ściany dostają elewacje z atlasu, dachy kolor wg kształtu. Kafle dociągane wokół punktu przed autem.

const VS_WALL = `#version 300 es
in vec3 a_pos; in vec2 a_uv; in float a_cell;
uniform mat4 u_m;
out vec2 v_uv; out vec3 v_pos; flat out float v_cell;
void main(){ v_uv=a_uv; v_cell=a_cell; v_pos=a_pos; gl_Position=u_m*vec4(a_pos,1.0); }`;
const FS_WALL = `#version 300 es
precision highp float;
in vec2 v_uv; in vec3 v_pos; flat in float v_cell;
uniform vec2 u_camp; uniform vec2 u_car; uniform float u_camz;
void cut(vec3 p){
  vec2 ab=u_car-u_camp; float l=dot(ab,ab); if(l<1.0) return;
  float t=clamp(dot(p.xy-u_camp,ab)/l,0.0,1.0); float d=length(p.xy-(u_camp+ab*t));
  if(p.z<mix(u_camz,2.0,t)-4.0) return;
  float f=smoothstep(16.0,30.0,d);
  if(f<1.0 && f<fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))) discard;
}
uniform sampler2D u_atlas; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night; uniform float u_soft;
out vec4 o;
void main(){
  cut(v_pos);
  float c=v_cell; vec2 cell=vec2(mod(c,3.0),floor(c/3.0));
  vec2 f=fract(v_uv); vec2 s=vec2(1.0/3.0,0.25);
  vec3 tex=textureGrad(u_atlas,(cell+0.01+f*0.98)*s,dFdx(v_uv)*s,dFdy(v_uv)*s).rgb;
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  float d=max(dot(n,u_sun),0.0);
  float ao=mix(0.62,1.0,smoothstep(0.0,5.0,v_pos.z));
  if(u_soft>0.5){ ao=mix(0.5,1.0,smoothstep(0.0,9.0,v_pos.z)); tex=mix(tex,vec3(dot(tex,vec3(.3,.55,.15))),0.22); }
  vec3 col=tex*(u_night>0.5?1.0:(u_soft>0.5?(0.7+0.38*d):(0.62+0.5*d)))*ao;
  float fog=smoothstep(800.0,2500.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog*0.72),1.0);
}`;
const VS_ROOF = `#version 300 es
in vec3 a_pos; in float a_kind;
uniform mat4 u_m;
out vec3 v_pos; flat out float v_kind;
void main(){ v_kind=a_kind; v_pos=a_pos; gl_Position=u_m*vec4(a_pos,1.0); }`;
const FS_ROOF = `#version 300 es
precision highp float;
in vec3 v_pos; flat in float v_kind;
uniform vec2 u_camp; uniform vec2 u_car; uniform float u_camz;
void cut(vec3 p){
  vec2 ab=u_car-u_camp; float l=dot(ab,ab); if(l<1.0) return;
  float t=clamp(dot(p.xy-u_camp,ab)/l,0.0,1.0); float d=length(p.xy-(u_camp+ab*t));
  if(p.z<mix(u_camz,2.0,t)-4.0) return;
  float f=smoothstep(16.0,30.0,d);
  if(f<1.0 && f<fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))) discard;
}
uniform sampler2D u_roofs; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night; uniform float u_soft;
out vec4 o;
void main(){
  cut(v_pos);
  int k=int(v_kind); bool p=k>=3;
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  if(n.z<0.0) n=-n;
  vec3 t=length(n.xy)>0.05?normalize(vec3(-n.y,n.x,0.0)):vec3(1.0,0.0,0.0);
  vec3 b=cross(n,t);
  vec2 uv=vec2(dot(v_pos,t),dot(v_pos,b))/(p?5.0:9.0);
  vec2 g=p?vec2(0.0,0.0):vec2(0.5,0.0);
  vec2 sc=vec2(0.5,1.0);
  vec3 tex=textureGrad(u_roofs,g+(0.01+fract(uv)*0.98)*sc,dFdx(uv)*sc,dFdy(uv)*sc).rgb;
  if(p){ if(k==4) tex=vec3(dot(tex,vec3(.3,.5,.2)))*vec3(.62,.66,.74); else if(k==5) tex*=vec3(.74,.62,.56); }
  else tex*=(k==1?1.15:k==2?0.9:1.0);
  float d=max(dot(n,u_sun),0.0);
  if(u_soft>0.5) tex=mix(tex,vec3(dot(tex,vec3(.3,.55,.15))),0.35)*0.92;
  vec3 col=tex*(0.62+0.55*d);
  if(u_night>0.5) col*=0.15;
  float fog=smoothstep(800.0,2500.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog*0.72),1.0);
}`;
const VS_TREE = `#version 300 es
in vec4 a_tree;
uniform mat4 u_m; uniform vec2 u_right; uniform float u_scale;
out vec2 v_uv; out float v_tint; out vec3 v_pos;
const vec2 C[6]=vec2[6](vec2(-.5,0.),vec2(.5,0.),vec2(.5,1.),vec2(-.5,0.),vec2(.5,1.),vec2(-.5,1.));
void main(){
  vec2 c=C[gl_VertexID];
  float kind=floor(a_tree.w); float f=fract(a_tree.w);
  float h=a_tree.z*u_scale; float w=h*(kind<0.5?0.62:0.92);
  float side=f>0.45?1.0:-1.0;
  vec3 p=vec3(a_tree.xy+u_right*c.x*w,c.y*h);
  v_uv=vec2((kind+0.5+c.x*side*0.98)*0.5,1.0-c.y*0.99-0.005);
  v_tint=f; v_pos=p;
  gl_Position=u_m*vec4(p,1.0);
}`;
const FS_TREE = `#version 300 es
precision highp float;
in vec2 v_uv; in float v_tint; in vec3 v_pos;
uniform sampler2D u_trees; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night;
out vec4 o;
void main(){
  vec4 t=texture(u_trees,v_uv);
  if(t.a<0.5) discard;
  vec3 col=t.rgb*mix(vec3(.82,.88,.8),vec3(1.05,1.02,.92),v_tint);
  col*=mix(0.72,1.0,smoothstep(0.0,6.0,v_pos.z));
  if(u_night>0.5) col*=0.2;
  float fog=smoothstep(800.0,2500.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog*0.72),1.0);
}`;

const VS_ROAD = `#version 300 es
in vec3 a_pos;
uniform mat4 u_m; uniform vec2 u_org;
out vec2 v_xy; out vec2 v_p; flat out float v_k;
void main(){ v_xy=a_pos.xy+u_org; v_p=a_pos.xy; v_k=a_pos.z; gl_Position=u_m*vec4(a_pos.xy,0.0,1.0); }`;
const FS_ROAD = `#version 300 es
precision highp float;
in vec2 v_xy; in vec2 v_p; flat in float v_k;
uniform sampler2D u_asphalt; uniform sampler2D u_pave; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night;
out vec4 o;
void main(){
  int k=int(v_k+0.5); vec3 c;
  vec2 m=v_xy/1.6;
  if(k==2){ float big=texture(u_asphalt,m/37.0).r; c=texture(u_asphalt,m/6.0).rgb*(0.82+0.42*big); c=mix(c,vec3(dot(c,vec3(.33))),0.6)*0.86; }
  else if(k==0){ c=texture(u_pave,m/5.0).rgb*0.92; }
  else if(k==3){ c=texture(u_pave,m/3.0).rgb*vec3(.72,.7,.68); }
  else if(k==1){ c=vec3(.76,.76,.72); }
  else { c=vec3(.6,.57,.5); }
  if(u_night>0.5) c*=vec3(.3,.34,.44);
  float fog=smoothstep(900.0,2600.0,distance(vec3(v_p,0.0),u_eye));
  o=vec4(mix(c,u_fog,fog*0.8),1.0);
}`;
const VS_MARK = `#version 300 es
in vec3 a_pos; in float a_k;
uniform mat4 u_m;
out float v_u; flat out float v_k; out vec2 v_p;
void main(){ v_u=a_pos.z; v_k=a_k; v_p=a_pos.xy; gl_Position=u_m*vec4(a_pos.xy,0.0,1.0); }`;
const FS_MARK = `#version 300 es
precision highp float;
in float v_u; flat in float v_k; in vec2 v_p;
uniform vec3 u_eye; uniform float u_night;
out vec4 o;
void main(){
  if(v_k>0.5 && fract(v_u/9.0)>0.42) discard;
  float a=(1.0-smoothstep(350.0,1100.0,distance(vec3(v_p,0.0),u_eye)))*0.82;
  o=vec4(vec3(u_night>0.5?0.72:0.93),a);
}`;
const VS_SHQ = `#version 300 es
uniform mat4 u_m;
out vec2 v;
const vec2 C[6]=vec2[6](vec2(0.,0.),vec2(1.,0.),vec2(1.,1.),vec2(0.,0.),vec2(1.,1.),vec2(0.,1.));
void main(){ vec2 c=C[gl_VertexID]; v=vec2(c.x,1.0-c.y); gl_Position=u_m*vec4(c*400.0,0.0,1.0); }`;
const FS_SHQ = `#version 300 es
precision highp float;
in vec2 v; uniform sampler2D u_s; out vec4 o;
void main(){ o=vec4(0.07,0.09,0.16,texture(u_s,v).r); }`;
const VS_RIB = `#version 300 es
in vec2 a_p; in float a_s; in float a_l;
uniform mat4 u_m;
out float v_s; out float v_l;
void main(){ v_s=a_s; v_l=a_l; gl_Position=u_m*vec4(a_p,0.55,1.0); }`;
const FS_RIB = `#version 300 es
precision highp float;
in float v_s; in float v_l;
uniform float u_t; uniform float u_from; uniform float u_ghost; uniform float u_night;
out vec4 o;
const float R=4.2;
void main(){
  float l=v_l-u_from; if(l<-1.0) discard;
  float d=abs(v_s)*R;
  float aa=fwidth(d);
  float core=1.0-smoothstep(0.16,0.16+aa+0.1,d);
  float body=1.0-smoothstep(1.55,1.55+aa+0.12,d);
  float rim=smoothstep(1.28,1.45,d)*body;
  float glow=exp(-d*d*0.42);
  float flow=pow(0.5+0.5*sin((v_l-u_t*16.0)*0.2),10.0);
  float ch=fract((v_l-u_t*4.0)/26.0); float w=abs(v_s)*R*0.5;
  float arrow=smoothstep(0.03,0.0,abs(ch-0.22-w*0.45)-0.022)*(1.0-smoothstep(0.42,0.5,w));
  vec3 cy=vec3(0.0,0.82,1.0); vec3 hi=vec3(0.86,0.99,1.0);
  vec3 c=mix(cy,hi,clamp(core+0.55*rim+0.6*flow*body+0.75*arrow*body,0.0,1.0));
  float a=max(glow*(u_night>0.5?0.34:0.26), body*0.66);
  a=max(a,rim*0.92); a=max(a,core*0.96); a=max(a,flow*body*0.72); a=max(a,arrow*body*0.8);
  a*=smoothstep(-1.0,3.0,l);
  if(u_ghost>0.5) a*=0.34*(0.75+0.25*sin(v_l*0.8));
  o=vec4(c,a);
}`;

export class CityGround {
  constructor(city) { this.city = city; this.id = 'city-ground'; this.type = 'custom'; this.renderingMode = '3d'; }
  render(gl, args) { this.city.renderGround(gl, args); }
}

const W = 40075016.68;
function prog(gl, vs, fs) {
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; };
const mercX = (lng) => (lng * W) / 360;
const mercY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * W) / (2 * Math.PI);

export class City3D {
  constructor(map, { base, night, onCover, soft = false }) {
    this.soft = soft; this.map = map; this.base = base; this.night = night; this.onCover = onCover;
    this.id = 'city3d'; this.type = 'custom'; this.renderingMode = '3d';
    this.tiles = new Map(); this.loading = 0; this.ready = false; this.t = 0; this.cover = null;
  }

  onAdd(map, gl) {
    this.gl = gl;
    if (!(gl instanceof WebGL2RenderingContext)) return;
    this.wall = prog(gl, VS_WALL, FS_WALL); this.roof = prog(gl, VS_ROOF, FS_ROOF); this.tree = prog(gl, VS_TREE, FS_TREE); if (this.soft) { this.road = prog(gl, VS_ROAD, FS_ROAD); this.mark = prog(gl, VS_MARK, FS_MARK); this.shq = prog(gl, VS_SHQ, FS_SHQ); this.rib = prog(gl, VS_RIB, FS_RIB); this.dummy = gl.createVertexArray(); } 
    fetch(`${this.base}index.json`).then((r) => r.json()).then((d) => {
      this.grid = d.grid; this.bld = new Set(d.tiles.map((t) => `${t[0]}_${t[1]}`)); this.index = new Set(this.bld); this.treeIndex = new Set((d.trees || []).map((t) => `${t[0]}_${t[1]}`)); this.roadIndex = new Set((d.roads || []).map((t) => `${t[0]}_${t[1]}`)); this.shIndex = new Set((d.shadows || []).map((t) => `${t[0]}_${t[1]}`));
      for (const k of [...this.treeIndex, ...this.roadIndex, ...this.shIndex]) this.index.add(k);
      const xs = d.tiles.map((t) => t[0] * d.grid); const ys = d.tiles.map((t) => t[1] * d.grid);
      this.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) + d.grid, Math.max(...ys) + d.grid];
      this.ready = true; map.triggerRepaint();
    }).catch(() => {});
    const tex = (url, slot) => {
      const t = gl.createTexture(); this[slot] = t;
      const im = new Image();
      im.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const an = gl.getExtension('EXT_texture_filter_anisotropic');
        if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
        this.texReady = (this.texReady || 0) + 1; map.triggerRepaint();
      };
      im.src = url;
    };
    tex(`./icons/city-atlas-${this.night ? 'night' : 'day'}.webp`, 'tex');
    tex('./icons/city-roofs.webp', 'roofTex');
    tex('./icons/city-trees.webp', 'treeTex');
    if (this.soft) { tex('./icons/tx-asphalt.webp', 'asphalt'); tex('./icons/tx-pave.webp', 'pave'); }
  }

  /** Mapa zdejmuje warstwę przy zmianie motywu: zwalniamy pamięć grafiki. */
  onRemove() {
    this.removed = true;
    const gl = this.gl;
    for (const k of [...this.tiles.keys()]) this.drop(k);
    for (const t of [this.tex, this.roofTex, this.treeTex]) if (t) gl.deleteTexture(t);
    for (const p of [this.wall, this.roof, this.tree, this.road, this.mark, this.shq, this.rib]) if (p) gl.deleteProgram(p);
  }

  /** Kafle leżą spakowane gzipem: rozpakowuje przeglądarka. */
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  uploadExtra(key, r, sh) {
    const gl = this.gl; const tile = this.tiles.get(key) || { k: key.split('_').map(Number) }; this.tiles.set(key, tile);
    if (r) {
      const h = new Uint32Array(r, 0, 2); const n = h[0]; const m = h[1];
      const mk = (bytes, stride, attrs) => {
        const v = gl.createVertexArray(); gl.bindVertexArray(v); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
        let off = 0; for (const [l, size] of attrs) { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); } off += size * 4; }
        gl.bindVertexArray(null); return { v, b };
      };
      if (n) tile.road = { ...mk(new Uint8Array(r, 8, n * 12), 12, [[0, 3]]), n };
      if (m) tile.markv = { ...mk(new Uint8Array(r, 8 + n * 12, m * 16), 16, [[0, 3], [gl.getAttribLocation(this.mark, 'a_k'), 1]]), n: m };
    }
    if (sh) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tile.sh = t;
    }
  }

  upload(key, buf, t) {
    const gl = this.gl; const h = buf ? new Uint32Array(buf, 0, 2) : [0, 0]; let treeObj = null;
    const vao = (prg, attrs, bytes, n, stride) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      let off = 0;
      for (const [name, size] of attrs) { const l = gl.getAttribLocation(prg, name); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); } off += size * 4; }
      gl.bindVertexArray(null);
      return { v, b, n };
    };
    const nw = h[0]; const nr = h[1];
    if (t) {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, t, gl.STATIC_DRAW);
      const l = gl.getAttribLocation(this.tree, 'a_tree'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(l, 1);
      gl.bindVertexArray(null);
      treeObj = { v, b, n: t.byteLength / 16 };
    }
    const wbytes = buf && new Uint8Array(buf, 8, nw * 24); const rbytes = buf && new Uint8Array(buf, 8 + nw * 24, nr * 16);
    const prev = this.tiles.get(key) || {};
    this.tiles.set(key, { ...prev, w: nw ? vao(this.wall, [['a_pos', 3], ['a_uv', 2], ['a_cell', 1]], wbytes, nw, 24) : null, r: nr ? vao(this.roof, [['a_pos', 3], ['a_kind', 1]], rbytes, nr, 16) : null, t: treeObj, k: key.split('_').map(Number) });
  }

  drop(key) {
    const t = this.tiles.get(key); const gl = this.gl;
    if (t.sh) gl.deleteTexture(t.sh);
    for (const o of [t.w, t.r, t.t, t.road, t.markv]) if (o) { gl.deleteBuffer(o.b); gl.deleteVertexArray(o.v); if (o.s) gl.deleteVertexArray(o.s); }
    this.tiles.delete(key);
  }

  /** Wczytuje kafle wokół punktu przed autem, najbliższe pierwsze. */
  update() {
    const c = this.map.getCenter(); const br = (this.map.getBearing() * Math.PI) / 180;
    const x = mercX(c.lng); const y = mercY(c.lat);
    const inside = x > this.box[0] && x < this.box[2] && y > this.box[1] && y < this.box[3];
    if (inside !== this.cover) { this.cover = inside; this.onCover?.(inside); }
    this.eye = [x, y];
    const ax = x + Math.sin(br) * 500; const ay = y + Math.cos(br) * 420;
    const g = this.grid; const R = this.soft ? 2000 : 1300; const want = [];
    for (let i = Math.floor((ax - R) / g); i <= Math.floor((ax + R) / g); i++) {
      for (let j = Math.floor((ay - R) / g); j <= Math.floor((ay + R) / g); j++) {
        const k = `${i}_${j}`;
        if (!this.index.has(k) || this.tiles.has(k)) continue;
        want.push([Math.hypot((i + 0.5) * g - x, (j + 0.5) * g - y), k]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    this.pending = this.pending || new Set();
    for (const [, k] of want) {
      if (this.loading >= 6) break;
      if (this.pending.has(k)) continue;
      this.pending.add(k); this.loading++;
      Promise.all([this.bld.has(k) ? this.get(`${this.base}${k}.bin`).catch(() => null) : null, this.treeIndex.has(k) ? this.get(`${this.base}${k}.t.bin`).catch(() => null) : null]).then(async ([b, t]) => {
        const [rd, sh] = this.soft ? await Promise.all([this.roadIndex.has(k) ? this.get(`${this.base}${k}.r.bin`).catch(() => null) : null,
          this.shIndex.has(k) ? fetch(`${this.base}${k}.s.webp`).then((x) => x.blob()).then((x) => createImageBitmap(x)).catch(() => null) : null]) : [null, null];
        if (this.removed) return;
        if (b || t) this.upload(k, b, t);
        if (rd || sh) this.uploadExtra(k, rd, sh);
        this.map.triggerRepaint();
      }).finally(() => { this.loading--; this.pending.delete(k); });
    }
    for (const [k, t] of this.tiles) if (Math.hypot((t.k[0] + 0.5) * g - x, (t.k[1] + 0.5) * g - y) > (this.soft ? 3000 : 2500)) this.drop(k);
  }

  render(gl, args) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.t > 400) { this.t = now; this.update(); }
    if ((this.texReady || 0) < (this.soft ? 5 : 3)) return;
    this.frame(args);
    const M = this.M;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const az = 2.4; const sun = [Math.sin(az) * 0.75, Math.cos(az) * 0.75, 0.66];
    const fog = this.night ? [0.063, 0.133, 0.243] : [0.66, 0.76, 0.84]; // dal ma się rozpływać w błękicie, a nie bieleć
    const s = 1 / W; const g = this.grid;
    const use = (p, atlas) => {
      gl.useProgram(p);
      gl.uniform3fv(gl.getUniformLocation(p, 'u_sun'), sun);
      gl.uniform3fv(gl.getUniformLocation(p, 'u_fog'), fog);
      gl.uniform1f(gl.getUniformLocation(p, 'u_night'), this.night ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(p, 'u_soft'), this.soft ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(p, 'u_scale'), this.soft ? 1.25 : 1.6);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(gl.getUniformLocation(p, p === this.wall ? 'u_atlas' : p === this.roof ? 'u_roofs' : 'u_trees'), 0);
    };
    const br = (this.map.getBearing() * Math.PI) / 180; const right = [Math.cos(br), -Math.sin(br)];
    for (const [p, key, atlas] of [[this.wall, 'w', this.tex], [this.roof, 'r', this.roofTex], [this.tree, 't', this.treeTex]]) {
      use(p, atlas);
      const um = gl.getUniformLocation(p, 'u_m'); const ue = gl.getUniformLocation(p, 'u_eye');
      for (const t of this.tiles.values()) {
        const o = t[key]; if (!o) continue;
        const ox = t.k[0] * g; const oy = t.k[1] * g;
        const T = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, (ox + W / 2) * s, (W / 2 - oy) * s, 0, 1];
        gl.uniformMatrix4fv(um, false, new Float32Array(mul(M, T)));
        gl.uniform3f(ue, this.eye[0] - ox, this.eye[1] - oy, 0);
        if (key !== 't') {
          const near = this.drive && this.soft;
          gl.uniform2f(gl.getUniformLocation(p, 'u_camp'), this.cam[0] - ox, this.cam[1] - oy);
          gl.uniform2f(gl.getUniformLocation(p, 'u_car'), near ? this.eye[0] - ox : this.cam[0] - ox, near ? this.eye[1] - oy : this.cam[1] - oy);
          gl.uniform1f(gl.getUniformLocation(p, 'u_camz'), this.camZ);
        }
        if (key === 't') {
          if (Math.hypot(ox + g / 2 - this.eye[0], oy + g / 2 - this.eye[1]) > 1100) continue;
          gl.uniform2fv(gl.getUniformLocation(p, 'u_right'), right);
          gl.bindVertexArray(o.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, o.n);
          continue;
        }
        gl.bindVertexArray(o.v); gl.drawArrays(gl.TRIANGLES, 0, o.n);
      }
    }
    gl.bindVertexArray(null);
    this.drawRibbon(gl);
  }

  /** Macierz i położenie kamery na tę klatkę. */
  frame(args) {
    this.M = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : (args.modelViewProjectionMatrix || args);
    const c = this.map.getCenter(); this.eye = [mercX(c.lng), mercY(c.lat)];
    const t = this.map.transform; const K = 1 / Math.cos((c.lat * Math.PI) / 180);
    let ll = null; let alt = 0;
    try { ll = t.getCameraLngLat && t.getCameraLngLat(); alt = t.getCameraAltitude ? t.getCameraAltitude() : 0; } catch { ll = null; }
    this.cam = ll ? [mercX(ll.lng), mercY(ll.lat)] : this.eye; this.camZ = alt * K;
  }

  tileM(ox, oy) {
    const s = 1 / W;
    return new Float32Array(mul(this.M, [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, (ox + W / 2) * s, (W / 2 - oy) * s, 0, 1]));
  }

  /** Jezdnie, chodniki, linie i cienie: pod trasą i budynkami, bez bufora głębi, więc nic nie migocze. */
  renderGround(gl, args) {
    if (!this.ready || !this.drive || (this.texReady || 0) < 5) return;
    this.frame(args);
    if (performance.now() - this.t > 400) { this.t = performance.now(); this.update(); }
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND);
    const g = this.grid; const fog = this.night ? [0.063, 0.133, 0.243] : [0.66, 0.76, 0.84];
    gl.useProgram(this.road);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.asphalt); gl.uniform1i(gl.getUniformLocation(this.road, 'u_asphalt'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.pave); gl.uniform1i(gl.getUniformLocation(this.road, 'u_pave'), 1);
    gl.uniform3fv(gl.getUniformLocation(this.road, 'u_fog'), fog); gl.uniform1f(gl.getUniformLocation(this.road, 'u_night'), this.night ? 1 : 0);
    const each = (p, fn) => {
      const um = gl.getUniformLocation(p, 'u_m'); const ue = gl.getUniformLocation(p, 'u_eye'); const uo = gl.getUniformLocation(p, 'u_org');
      for (const t of this.tiles.values()) {
        const ox = t.k[0] * g; const oy = t.k[1] * g;
        gl.uniformMatrix4fv(um, false, this.tileM(ox, oy));
        if (ue) gl.uniform3f(ue, this.eye[0] - ox, this.eye[1] - oy, 0);
        if (uo) gl.uniform2f(uo, ox % 4000, oy % 4000);
        fn(t);
      }
    };
    each(this.road, (t) => { if (t.road) { gl.bindVertexArray(t.road.v); gl.drawArrays(gl.TRIANGLES, 0, t.road.n); } });
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.mark); gl.uniform1f(gl.getUniformLocation(this.mark, 'u_night'), this.night ? 1 : 0);
    each(this.mark, (t) => { if (t.markv) { gl.bindVertexArray(t.markv.v); gl.drawArrays(gl.TRIANGLES, 0, t.markv.n); } });
    if (!this.night) {
      gl.useProgram(this.shq); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gl.getUniformLocation(this.shq, 'u_s'), 0); gl.bindVertexArray(this.dummy);
      each(this.shq, (t) => { if (t.sh) { gl.bindTexture(gl.TEXTURE_2D, t.sh); gl.drawArrays(gl.TRIANGLES, 0, 6); } });
    }
    gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Trasa jako własna siatka: stała szerokość w metrach, gładkie łuki, widoczna też za budynkami. */
  setRoute(coords) {
    const gl = this.gl; if (!gl || !this.rib) { this.pendingRoute = coords; return; }
    if (this.ribbon) { gl.deleteBuffer(this.ribbon.b); gl.deleteVertexArray(this.ribbon.v); this.ribbon = null; }
    if (!coords || coords.length < 2) return;
    const pts = coords.map(([x, y]) => [mercX(x), mercY(y)]); const org = pts[0];
    const K = 1 / Math.cos((coords[0][1] * Math.PI) / 180); const H = 4.2 * K;
    const out = new Float32Array(pts.length * 8); let L = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b[1] - a[1]); let ny = b[0] - a[0]; const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
      if (i) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / K;
      const x = pts[i][0] - org[0]; const y = pts[i][1] - org[1];
      out.set([x + nx * H, y + ny * H, 1, L, x - nx * H, y - ny * H, -1, L], i * 8);
    }
    const v = gl.createVertexArray(); gl.bindVertexArray(v); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    const attr = (name, size, off) => { const l = gl.getAttribLocation(this.rib, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 16, off); };
    attr('a_p', 2, 0); attr('a_s', 1, 8); attr('a_l', 1, 12);
    gl.bindVertexArray(null);
    this.ribbon = { v, b, n: pts.length * 2, org };
  }

  drawRibbon(gl) {
    if (!this.ribbon || !this.drive) return;
    const r = this.ribbon; gl.useProgram(this.rib);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.rib, 'u_m'), false, this.tileM(r.org[0], r.org[1]));
    gl.uniform1f(gl.getUniformLocation(this.rib, 'u_t'), performance.now() / 1000);
    gl.uniform1f(gl.getUniformLocation(this.rib, 'u_from'), this.along || 0);
    gl.uniform1f(gl.getUniformLocation(this.rib, 'u_night'), this.night ? 1 : 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.bindVertexArray(r.v);
    gl.uniform1f(gl.getUniformLocation(this.rib, 'u_ghost'), 0); gl.depthFunc(gl.LEQUAL); gl.drawArrays(gl.TRIANGLE_STRIP, 0, r.n);
    gl.uniform1f(gl.getUniformLocation(this.rib, 'u_ghost'), 1); gl.depthFunc(gl.GREATER); gl.drawArrays(gl.TRIANGLE_STRIP, 0, r.n);
    gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }
}
