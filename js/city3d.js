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
uniform sampler2D u_atlas; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night; uniform float u_soft;
out vec4 o;
void main(){
  float c=v_cell; vec2 cell=vec2(mod(c,3.0),floor(c/3.0));
  vec2 f=fract(v_uv); vec2 s=vec2(1.0/3.0,0.25);
  vec3 tex=textureGrad(u_atlas,(cell+0.01+f*0.98)*s,dFdx(v_uv)*s,dFdy(v_uv)*s).rgb;
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  float d=max(dot(n,u_sun),0.0);
  float ao=mix(0.62,1.0,smoothstep(0.0,5.0,v_pos.z));
  if(u_soft>0.5){ ao=mix(0.5,1.0,smoothstep(0.0,9.0,v_pos.z)); tex=mix(tex,vec3(dot(tex,vec3(.3,.55,.15))),0.22); }
  vec3 col=tex*(u_night>0.5?1.0:(u_soft>0.5?(0.7+0.38*d):(0.62+0.5*d)))*ao;
  float fog=smoothstep(600.0,1700.0,distance(v_pos,u_eye));
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
uniform sampler2D u_roofs; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night; uniform float u_soft;
out vec4 o;
void main(){
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
  float fog=smoothstep(600.0,1700.0,distance(v_pos,u_eye));
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
  float fog=smoothstep(600.0,1700.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog*0.72),1.0);
}`;

const VS_SHADOW = `#version 300 es
in vec3 a_pos;
uniform mat4 u_m; uniform vec2 u_dir;
void main(){ gl_Position=u_m*vec4(a_pos.xy+u_dir*a_pos.z,0.3,1.0); }`;
const FS_SHADOW = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o=vec4(0.05,0.07,0.13,0.3); }`;
const VS_TSHADOW = `#version 300 es
in vec4 a_tree;
uniform mat4 u_m; uniform vec2 u_dir;
out vec2 v;
const vec2 C[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(-1.,-1.),vec2(1.,1.),vec2(-1.,1.));
void main(){ vec2 c=C[gl_VertexID]; v=c; float r=a_tree.z*0.42; gl_Position=u_m*vec4(a_tree.xy+u_dir*a_tree.z*0.55+c*r,0.3,1.0); }`;
const FS_TSHADOW = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
void main(){ float d=length(v); if(d>1.0) discard; o=vec4(0.05,0.08,0.1,0.34*smoothstep(1.0,0.35,d)); }`;

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
    this.wall = prog(gl, VS_WALL, FS_WALL); this.roof = prog(gl, VS_ROOF, FS_ROOF); this.tree = prog(gl, VS_TREE, FS_TREE); this.shadow = prog(gl, VS_SHADOW, FS_SHADOW); this.tshadow = prog(gl, VS_TSHADOW, FS_TSHADOW); 
    fetch(`${this.base}index.json`).then((r) => r.json()).then((d) => {
      this.grid = d.grid; this.bld = new Set(d.tiles.map((t) => `${t[0]}_${t[1]}`)); this.index = new Set(this.bld); this.treeIndex = new Set((d.trees || []).map((t) => `${t[0]}_${t[1]}`));
      for (const k of this.treeIndex) this.index.add(k);
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
  }

  /** Mapa zdejmuje warstwę przy zmianie motywu: zwalniamy pamięć grafiki. */
  onRemove() {
    this.removed = true;
    const gl = this.gl;
    for (const k of [...this.tiles.keys()]) this.drop(k);
    for (const t of [this.tex, this.roofTex, this.treeTex]) if (t) gl.deleteTexture(t);
    for (const p of [this.wall, this.roof, this.tree, this.shadow, this.tshadow]) if (p) gl.deleteProgram(p);
  }

  /** Kafle leżą spakowane gzipem: rozpakowuje przeglądarka. */
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
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
      const sv = gl.createVertexArray(); gl.bindVertexArray(sv); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      const l2 = gl.getAttribLocation(this.tshadow, 'a_tree'); gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(l2, 1);
      gl.bindVertexArray(null);
      treeObj = { v, b, s: sv, n: t.byteLength / 16 };
    }
    const wbytes = buf && new Uint8Array(buf, 8, nw * 24); const rbytes = buf && new Uint8Array(buf, 8 + nw * 24, nr * 16);
    this.tiles.set(key, { w: nw ? vao(this.wall, [['a_pos', 3], ['a_uv', 2], ['a_cell', 1]], wbytes, nw, 24) : null, r: nr ? vao(this.roof, [['a_pos', 3], ['a_kind', 1]], rbytes, nr, 16) : null, t: treeObj, k: key.split('_').map(Number) });
  }

  drop(key) {
    const t = this.tiles.get(key); const gl = this.gl;
    for (const o of [t.w, t.r, t.t]) if (o) { gl.deleteBuffer(o.b); gl.deleteVertexArray(o.v); if (o.s) gl.deleteVertexArray(o.s); }
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
    const g = this.grid; const R = 1300; const want = [];
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
      Promise.all([this.bld.has(k) ? this.get(`${this.base}${k}.bin`).catch(() => null) : null, this.treeIndex.has(k) ? this.get(`${this.base}${k}.t.bin`).catch(() => null) : null]).then(([b, t]) => { if ((b || t) && !this.removed) this.upload(k, b, t); this.map.triggerRepaint(); }).finally(() => { this.loading--; this.pending.delete(k); });
    }
    for (const [k, t] of this.tiles) if (Math.hypot((t.k[0] + 0.5) * g - x, (t.k[1] + 0.5) * g - y) > 2500) this.drop(k);
  }

  render(gl, args) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.t > 400) { this.t = now; this.update(); }
    if ((this.texReady || 0) < 3) return;
    const M = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : (args.modelViewProjectionMatrix || args);
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
    if (this.soft && !this.night) { // cienie na ziemi: bryły spłaszczone wzdłuż słońca, każdy piksel przyciemniony tylko raz
      const dir = [(-sun[0] / sun[2]) * 0.85, (-sun[1] / sun[2]) * 0.85];
      const each = (p, fn) => {
        gl.useProgram(p); const um = gl.getUniformLocation(p, 'u_m'); gl.uniform2fv(gl.getUniformLocation(p, 'u_dir'), dir);
        for (const t of this.tiles.values()) {
          const ox = t.k[0] * g; const oy = t.k[1] * g;
          if (Math.hypot(ox + g / 2 - this.eye[0], oy + g / 2 - this.eye[1]) > 1500) continue;
          gl.uniformMatrix4fv(um, false, new Float32Array(mul(M, [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, (ox + W / 2) * s, (W / 2 - oy) * s, 0, 1])));
          fn(t);
        }
      };
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthFunc(gl.LESS);
      each(this.shadow, (t) => { for (const o of [t.w, t.r]) if (o) { gl.bindVertexArray(o.v); gl.drawArrays(gl.TRIANGLES, 0, o.n); } });
      gl.bindVertexArray(null); gl.clear(gl.DEPTH_BUFFER_BIT); gl.disable(gl.DEPTH_TEST);
      each(this.tshadow, (t) => { if (t.t) { gl.bindVertexArray(t.t.s); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, t.t.n); } });
      gl.bindVertexArray(null); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    }
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
  }
}
