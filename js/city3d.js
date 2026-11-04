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
uniform sampler2D u_atlas; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night;
out vec4 o;
void main(){
  float c=v_cell; vec2 cell=vec2(mod(c,3.0),floor(c/3.0));
  vec2 f=fract(v_uv); vec2 s=vec2(1.0/3.0,0.25);
  vec3 tex=textureGrad(u_atlas,(cell+0.01+f*0.98)*s,dFdx(v_uv)*s,dFdy(v_uv)*s).rgb;
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  float d=max(dot(n,u_sun),0.0);
  float ao=mix(0.62,1.0,smoothstep(0.0,5.0,v_pos.z));
  vec3 col=tex*(u_night>0.5?1.0:(0.62+0.5*d))*ao;
  float fog=smoothstep(600.0,1700.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog),1.0);
}`;
const VS_ROOF = `#version 300 es
in vec3 a_pos; in float a_kind;
uniform mat4 u_m;
out vec3 v_pos; flat out float v_kind;
void main(){ v_kind=a_kind; v_pos=a_pos; gl_Position=u_m*vec4(a_pos,1.0); }`;
const FS_ROOF = `#version 300 es
precision highp float;
in vec3 v_pos; flat in float v_kind;
uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night;
out vec4 o;
const vec3 FLAT[3]=vec3[3](vec3(.46,.47,.48),vec3(.53,.53,.52),vec3(.40,.41,.43));
const vec3 PITCH[3]=vec3[3](vec3(.62,.27,.18),vec3(.30,.31,.34),vec3(.50,.25,.20));
void main(){
  int k=int(v_kind); bool p=k>=3; vec3 base=p?PITCH[k-3]:FLAT[k];
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  float line=p?0.9+0.1*step(0.5,fract(v_pos.z*3.0)):1.0;
  float d=max(dot(n,u_sun),0.0);
  vec3 col=base*(0.55+0.65*d)*line;
  if(u_night>0.5) col*=0.16;
  float fog=smoothstep(600.0,1700.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog),1.0);
}`;

const W = 40075016.68;
function prog(gl, vs, fs) {
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; };
const mercX = (lng) => (lng * W) / 360;
const mercY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * W) / (2 * Math.PI);

export class City3D {
  constructor(map, { base, night, onCover }) {
    this.map = map; this.base = base; this.night = night; this.onCover = onCover;
    this.id = 'city3d'; this.type = 'custom'; this.renderingMode = '3d';
    this.tiles = new Map(); this.loading = 0; this.ready = false; this.t = 0; this.cover = null;
  }

  onAdd(map, gl) {
    this.gl = gl;
    if (!(gl instanceof WebGL2RenderingContext)) return;
    this.wall = prog(gl, VS_WALL, FS_WALL); this.roof = prog(gl, VS_ROOF, FS_ROOF);
    fetch(`${this.base}index.json`).then((r) => r.json()).then((d) => {
      this.grid = d.grid; this.index = new Set(d.tiles.map((t) => `${t[0]}_${t[1]}`));
      const xs = d.tiles.map((t) => t[0] * d.grid); const ys = d.tiles.map((t) => t[1] * d.grid);
      this.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) + d.grid, Math.max(...ys) + d.grid];
      this.ready = true; map.triggerRepaint();
    }).catch(() => {});
    const tex = gl.createTexture(); this.tex = tex;
    const im = new Image();
    im.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const an = gl.getExtension('EXT_texture_filter_anisotropic');
      if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      this.atlas = true; map.triggerRepaint();
    };
    im.src = `./icons/city-atlas-${this.night ? 'night' : 'day'}.webp`;
  }

  upload(key, buf) {
    const gl = this.gl; const h = new Uint32Array(buf, 0, 2);
    const vao = (prg, attrs, bytes, n, stride) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      let off = 0;
      for (const [name, size] of attrs) { const l = gl.getAttribLocation(prg, name); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); } off += size * 4; }
      gl.bindVertexArray(null);
      return { v, b, n };
    };
    const nw = h[0]; const nr = h[1];
    const wbytes = new Uint8Array(buf, 8, nw * 24); const rbytes = new Uint8Array(buf, 8 + nw * 24, nr * 16);
    this.tiles.set(key, { w: nw ? vao(this.wall, [['a_pos', 3], ['a_uv', 2], ['a_cell', 1]], wbytes, nw, 24) : null, r: nr ? vao(this.roof, [['a_pos', 3], ['a_kind', 1]], rbytes, nr, 16) : null, k: key.split('_').map(Number) });
  }

  drop(key) {
    const t = this.tiles.get(key); const gl = this.gl;
    for (const o of [t.w, t.r]) if (o) { gl.deleteBuffer(o.b); gl.deleteVertexArray(o.v); }
    this.tiles.delete(key);
  }

  /** Wczytuje kafle wokół punktu przed autem, najbliższe pierwsze. */
  update() {
    const c = this.map.getCenter(); const br = (this.map.getBearing() * Math.PI) / 180;
    const x = mercX(c.lng); const y = mercY(c.lat);
    const inside = x > this.box[0] && x < this.box[2] && y > this.box[1] && y < this.box[3];
    if (inside !== this.cover) { this.cover = inside; this.onCover?.(inside); }
    this.eye = [x, y];
    const ax = x + Math.sin(br) * 420; const ay = y + Math.cos(br) * 420;
    const g = this.grid; const R = 1500; const want = [];
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
      fetch(`${this.base}${k}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => { if (b) this.upload(k, b); this.map.triggerRepaint(); }).catch(() => {}).finally(() => { this.loading--; this.pending.delete(k); });
    }
    for (const [k, t] of this.tiles) if (Math.hypot((t.k[0] + 0.5) * g - x, (t.k[1] + 0.5) * g - y) > 2500) this.drop(k);
  }

  render(gl, args) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.t > 400) { this.t = now; this.update(); }
    if (!this.atlas) return;
    const M = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : (args.modelViewProjectionMatrix || args);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const az = 2.4; const sun = [Math.sin(az) * 0.75, Math.cos(az) * 0.75, 0.66];
    const fog = this.night ? [0.063, 0.133, 0.243] : [0.84, 0.9, 0.945];
    const s = 1 / W; const g = this.grid;
    const use = (p, atlas) => {
      gl.useProgram(p);
      gl.uniform3fv(gl.getUniformLocation(p, 'u_sun'), sun);
      gl.uniform3fv(gl.getUniformLocation(p, 'u_fog'), fog);
      gl.uniform1f(gl.getUniformLocation(p, 'u_night'), this.night ? 1 : 0);
      if (atlas) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(gl.getUniformLocation(p, 'u_atlas'), 0); }
    };
    for (const [p, key, atlas] of [[this.wall, 'w', true], [this.roof, 'r', false]]) {
      use(p, atlas);
      const um = gl.getUniformLocation(p, 'u_m'); const ue = gl.getUniformLocation(p, 'u_eye');
      for (const t of this.tiles.values()) {
        const o = t[key]; if (!o) continue;
        const ox = t.k[0] * g; const oy = t.k[1] * g;
        const T = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, (ox + W / 2) * s, (W / 2 - oy) * s, 0, 1];
        gl.uniformMatrix4fv(um, false, new Float32Array(mul(M, T)));
        gl.uniform3f(ue, this.eye[0] - ox, this.eye[1] - oy, 0);
        gl.bindVertexArray(o.v); gl.drawArrays(gl.TRIANGLES, 0, o.n);
      }
    }
    gl.bindVertexArray(null);
  }
}
