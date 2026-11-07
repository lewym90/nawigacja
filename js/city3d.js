import { ribbonMesh, puckMesh, RIB } from './solid.js';
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
  float t=dot(p.xy-u_camp,ab)/l; if(t<0.0||t>1.0) return; // tylko to, co stoi między kamerą a autem: nic przed autem ani obok drogi
  float d=length(p.xy-(u_camp+ab*t)); float r=mix(14.0,5.0,t);
  if(p.z<mix(u_camz,1.5,t)-1.0) return;
  float f=smoothstep(r,r+3.0,d);
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
  float t=dot(p.xy-u_camp,ab)/l; if(t<0.0||t>1.0) return; // tylko to, co stoi między kamerą a autem: nic przed autem ani obok drogi
  float d=length(p.xy-(u_camp+ab*t)); float r=mix(14.0,5.0,t);
  if(p.z<mix(u_camz,1.5,t)-1.0) return;
  float f=smoothstep(r,r+3.0,d);
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
  if(k==2||k==5||k==6){ float big=texture(u_asphalt,m/37.0).r; c=texture(u_asphalt,m/6.0).rgb*(0.82+0.42*big); c=mix(c,vec3(dot(c,vec3(.33))),0.6);
    c=k==2?c*0.8:k==5?c*1.08+vec3(.035):mix(c*1.25,vec3(.42,.42,.41),.45); } // główne ciemne i wyraźne, małe uliczki jasne, żeby schodziły na drugi plan
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
in vec2 a_p; in vec2 a_n; in float a_s; in float a_l;
uniform mat4 u_m; uniform float u_wid;
out float v_s; out float v_l;
void main(){ v_s=a_s; v_l=a_l; gl_Position=u_m*vec4(a_p+a_n*a_s*u_wid,0.55,1.0); }`;
const FS_RIB = `#version 300 es
precision highp float;
in float v_s; in float v_l;
uniform float u_t; uniform float u_from; uniform float u_ghost; uniform float u_night; uniform vec3 u_jam[6];
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
  float arrow=smoothstep(0.03,0.0,abs(ch-0.22+w*0.45)-0.03)*(1.0-smoothstep(0.52,0.6,w));
  vec3 cy=vec3(0.0,0.82,1.0); vec3 hi=vec3(0.86,0.99,1.0);
  for(int i=0;i<6;i++){ vec3 j=u_jam[i]; if(j.z>0.0 && v_l>j.x && v_l<j.y){ cy=j.z>2.5?vec3(.72,.06,.14):j.z>1.5?vec3(1.,.2,.27):vec3(1.,.62,.13); hi=vec3(1.,.93,.86); } }
  vec3 c=mix(cy,hi,clamp(core+0.55*rim+0.6*flow*body+0.75*arrow*body,0.0,1.0));
  float a=max(glow*(u_night>0.5?0.34:0.26), body*0.66);
  a=max(a,rim*0.92); a=max(a,core*0.96); a=max(a,flow*body*0.72); a=max(a,arrow*body*0.8);
  a*=smoothstep(-1.0,3.0,l);
  if(u_ghost>0.5) a*=0.34*(0.75+0.25*sin(v_l*0.8));
  o=vec4(c,a);
}`;

// Wstęga i znacznik jako bryły: światło słońca, odblask, świecące krawędzie.
const VS_SOL = `#version 300 es
in vec2 a_c; in vec2 a_n; in vec2 a_off; in vec3 a_nrm; in float a_l; in float a_u; in float a_top; in vec2 a_off0; in vec3 a_nrm0;
uniform mat4 u_m; uniform float u_from; uniform float u_heads[4];
out vec3 v_nrm; out vec3 v_pos; out float v_l; out float v_u; out float v_top;
void main(){
  v_top=a_top;
  float sc=1.0;
  float g=1.0; // grot podnosi się między 120 a 80 m przed skrętem i kładzie tuż przed nim, bo od tyłu stojący grot to ściana przed autem
  for(int i=0;i<4;i++){ float h=u_heads[i]; if(h>0.0 && a_l>=h-0.01 && a_l<h+40.0){ float d=h-u_from; g=smoothstep(120.0,80.0,d)*smoothstep(2.0,16.0,d); } }
  vec2 off=mix(a_off0,a_off,g);
  vec3 p=vec3(a_c+a_n*off.x*sc,off.y*sc);
  v_nrm=normalize(mix(a_nrm0,a_nrm,g)); v_pos=p; v_l=a_l; v_u=a_u; gl_Position=u_m*vec4(p,1.0);
}`;
const LIGHT = `
vec3 shade(vec3 N, vec3 V, vec3 top, vec3 side, float night, float up){
  vec3 L=normalize(vec3(-0.35,-0.45,0.82));
  vec3 c=mix(side,top,up)*(0.58+0.5*max(dot(N,L),0.0));
  vec3 H=normalize(L+V); c+=vec3(1.0)*pow(max(dot(N,H),0.0),56.0)*0.55;
  c+=vec3(0.45,0.9,1.0)*pow(1.0-max(dot(N,V),0.0),3.0)*(night>0.5?0.55:0.3);
  return c;
}`;
const FS_SOL = `#version 300 es
precision highp float;
in vec3 v_nrm; in vec3 v_pos; in float v_l; in float v_u; in float v_top;
uniform vec3 u_eye; uniform float u_t; uniform float u_from; uniform float u_ghost; uniform float u_night; uniform vec3 u_jam[6];
out vec4 o;
${LIGHT}
void main(){
  if(v_l<u_from) discard; // równe cięcie pod autem, zakryte denkiem rysowanym w każdej klatce
  vec3 N=normalize(v_nrm); vec3 V=normalize(u_eye-v_pos);
  vec3 top=vec3(0.16,0.74,1.0); vec3 side=vec3(0.0,0.36,0.7);
  for(int i=0;i<6;i++){ vec3 j=u_jam[i]; if(j.z>0.0 && v_l>j.x && v_l<j.y){ top=j.z>2.5?vec3(.8,.1,.18):j.z>1.5?vec3(1.,.25,.3):vec3(1.,.66,.18); side=top*0.55; } }
  float up=smoothstep(0.55,0.9,v_top); vec3 c=shade(N,V,top,side,u_night,up); float u=abs(v_u);
  float flow=pow(0.5+0.5*sin((v_l-u_t*16.0)*0.2),10.0);
  float ch=fract((v_l-u_t*4.0)/26.0); float arrow=smoothstep(0.03,0.0,abs(ch-0.22+u*0.3)-0.025)*(1.0-smoothstep(0.55,0.65,u));
  c+=up*(vec3(0.85,0.98,1.0)*(exp(-u*u*10.0)*0.18+flow*0.35+arrow*0.3)+vec3(0.55,0.95,1.0)*smoothstep(0.8,0.97,u)*0.7);
  if(u_night>0.5) c*=1.15;
  o=vec4(c,u_ghost>0.5?0.3:1.0);
}`;
const FS_UNDER = `#version 300 es
precision highp float;
in vec3 v_nrm; in vec3 v_pos; in float v_l; in float v_u;
uniform float u_from; uniform float u_hw; uniform float u_night;
out vec4 o;
void main(){
  if(v_l<u_from) discard;
  float d=abs(v_u); float sh=(1.0-smoothstep(u_hw-0.3,u_hw+0.8,d))*0.38; float g=exp(-(d-u_hw)*(d-u_hw)*3.0)*(u_night>0.5?0.4:0.22)*step(u_hw,d);
  o=vec4(mix(vec3(0.0),vec3(0.0,0.8,1.0),step(sh,g)),max(sh,g));
}`;
const VS_PUCK = `#version 300 es
in vec3 a_p; in vec3 a_nrm; in float a_k;
uniform mat4 u_m; uniform float u_rot; uniform float u_size;
out vec3 v_nrm; out vec3 v_pos; out float v_k; out vec2 v_xy;
void main(){
  float c=cos(u_rot); float s=sin(u_rot); mat2 R=mat2(c,-s,s,c);
  vec3 p=vec3(R*a_p.xy,a_p.z)*u_size; v_nrm=vec3(R*a_nrm.xy,a_nrm.z); v_pos=p; v_k=a_k; v_xy=a_p.xy;
  gl_Position=u_m*vec4(p,1.0);
}`;
const FS_PUCK = `#version 300 es
precision highp float;
in vec3 v_nrm; in vec3 v_pos; in float v_k; in vec2 v_xy;
uniform vec3 u_eye; uniform float u_night;
out vec4 o;
${LIGHT}
void main(){
  if(v_k>1.5){ float r=length(v_xy*vec2(1.0,0.85)); o=vec4(0.0,0.08,0.15,(1.0-smoothstep(0.25,1.05,r))*0.45); return; }
  vec3 N=normalize(v_nrm); vec3 V=normalize(u_eye-v_pos);
  vec3 c=v_k<0.5?shade(N,V,vec3(0.94,0.98,1.0),vec3(0.94,0.98,1.0),u_night,1.0):shade(N,V,vec3(0.0,0.78,1.0),vec3(0.0,0.62,0.95),u_night,0.0);
  o=vec4(c,1.0);
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
export const toMerc = (lng, lat) => [mercX(lng), mercY(lat)];
export const fromMerc = (x, y) => [(x * 360) / W, (Math.atan(Math.exp((y * 2 * Math.PI) / W)) * 360) / Math.PI - 90];

export class City3D {
  constructor(map, { base, night, onCover, soft = false, quality = null }) {
    this.q = quality || { radius: 2000, drop: 3000, shadows: true }; this.soft = soft; this.map = map; this.base = base; this.night = night; this.onCover = onCover;
    this.id = 'city3d'; this.type = 'custom'; this.renderingMode = '3d';
    this.tiles = new Map(); this.loading = 0; this.ready = false; this.t = 0; this.cover = null;
  }

  onAdd(map, gl) {
    this.gl = gl;
    if (!(gl instanceof WebGL2RenderingContext)) return;
    this.headStyle = 'up'; this.sol = prog(gl, VS_SOL, FS_SOL); this.solU = prog(gl, VS_SOL, FS_UNDER); this.puckP = prog(gl, VS_PUCK, FS_PUCK); this.wall = prog(gl, VS_WALL, FS_WALL); this.roof = prog(gl, VS_ROOF, FS_ROOF); this.tree = prog(gl, VS_TREE, FS_TREE); if (this.soft) { this.road = prog(gl, VS_ROAD, FS_ROAD); this.mark = prog(gl, VS_MARK, FS_MARK); this.shq = prog(gl, VS_SHQ, FS_SHQ); this.rib = prog(gl, VS_RIB, FS_RIB); this.dummy = gl.createVertexArray(); } 
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

  /** Nowa jakość: kafle bez cieni trzeba wczytać jeszcze raz, resztę załatwia zwykła aktualizacja. */
  setQuality(q) {
    const reload = q.shadows && !this.q.shadows; this.q = q;
    if (reload) for (const k of [...this.tiles.keys()]) this.drop(k);
    this.update();
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
    this.tiles.set(key, { ...prev, wraw: nw ? new Float32Array(buf, 8, nw * 6) : null, occ: null, w: nw ? vao(this.wall, [['a_pos', 3], ['a_uv', 2], ['a_cell', 1]], wbytes, nw, 24) : null, r: nr ? vao(this.roof, [['a_pos', 3], ['a_kind', 1]], rbytes, nr, 16) : null, t: treeObj, k: key.split('_').map(Number) });
  }

  /** Wysokości zabudowy w kratkach 8 m, liczone przy pierwszym pytaniu o dany kafel. */
  occupancy(t) {
    if (t.occ || !t.wraw) return t.occ;
    const occ = new Map(); const a = t.wraw;
    const mark = (x1, y1, z1, x2, y2, z2) => {
      const z = Math.max(z1, z2); if (z < 3) return;
      const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4);
      for (let i = 0; i <= n; i++) {
        const u = n ? i / n : 0; const c = Math.floor((x1 + (x2 - x1) * u) / 8) * 4096 + Math.floor((y1 + (y2 - y1) * u) / 8);
        if (!(occ.get(c) >= z)) occ.set(c, z);
      }
    };
    for (let i = 0; i + 17 < a.length; i += 18) {
      const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = [a[i], a[i + 1], a[i + 2], a[i + 6], a[i + 7], a[i + 8], a[i + 12], a[i + 13], a[i + 14]];
      mark(x1, y1, z1, x2, y2, z2); mark(x2, y2, z2, x3, y3, z3); mark(x3, y3, z3, x1, y1, z1);
    }
    t.occ = occ; t.wraw = null; return occ;
  }

  /** Czy budynek przecina linię wzroku z kamery (lng, lat, wysokość) do punktu na drodze. Sama odległość od celu pomija ostatnie metry, bo tam stoi cel. */
  sightBlocked(from, z, to) {
    if (!this.grid) return false;
    const x1 = mercX(from[0]); const y1 = mercY(from[1]); const x2 = mercX(to[0]); const y2 = mercY(to[1]);
    const d = Math.hypot(x2 - x1, y2 - y1); const n = Math.floor(d / 6); const g = this.grid;
    for (let i = 1; i < n; i++) {
      const u = i / n; if (u > 0.96) break;
      const x = x1 + (x2 - x1) * u; const y = y1 + (y2 - y1) * u; const i0 = Math.floor(x / g); const j0 = Math.floor(y / g);
      const t = this.tiles.get(`${i0}_${j0}`); if (!t) continue;
      const occ = this.occupancy(t); if (!occ) continue;
      const h = occ.get(Math.floor((x - i0 * g) / 8) * 4096 + Math.floor((y - j0 * g) / 8));
      if (h != null && h > z * (1 - u) + 1) return true;
    }
    return false;
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
    const g = this.grid; const R = this.soft ? this.q.radius : 1300; const want = [];
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
          this.shIndex.has(k) && this.q.shadows ? fetch(`${this.base}${k}.s.webp`).then((x) => x.blob()).then((x) => createImageBitmap(x)).catch(() => null) : null]) : [null, null];
        if (this.removed) return;
        if (b || t) this.upload(k, b, t);
        if (rd || sh) this.uploadExtra(k, rd, sh);
        this.map.triggerRepaint();
      }).finally(() => { this.loading--; this.pending.delete(k); });
    }
    for (const [k, t] of this.tiles) if (Math.hypot((t.k[0] + 0.5) * g - x, (t.k[1] + 0.5) * g - y) > (this.soft ? this.q.drop : 2500)) this.drop(k);
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
    if (this.fill) {
      const f = this.fill; gl.uniformMatrix4fv(gl.getUniformLocation(this.road, 'u_m'), false, this.tileM(f.org[0], f.org[1]));
      const ue = gl.getUniformLocation(this.road, 'u_eye'); if (ue) gl.uniform3f(ue, this.eye[0] - f.org[0], this.eye[1] - f.org[1], 0);
      const uo = gl.getUniformLocation(this.road, 'u_org'); if (uo) gl.uniform2f(uo, f.org[0] % 4000, f.org[1] % 4000);
      gl.bindVertexArray(f.v); gl.drawArrays(gl.TRIANGLES, 0, f.n);
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.mark); gl.uniform1f(gl.getUniformLocation(this.mark, 'u_night'), this.night ? 1 : 0);
    each(this.mark, (t) => { if (t.markv) { gl.bindVertexArray(t.markv.v); gl.drawArrays(gl.TRIANGLES, 0, t.markv.n); } });
    if (!this.night) {
      gl.useProgram(this.shq); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gl.getUniformLocation(this.shq, 'u_s'), 0); gl.bindVertexArray(this.dummy);
      each(this.shq, (t) => { if (t.sh && this.q.shadows) { gl.bindTexture(gl.TEXTURE_2D, t.sh); gl.drawArrays(gl.TRIANGLES, 0, 6); } });
    }
    gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Tor z snap.js: { pts w metrach Merkatora, along, K }; turns: miejsca skrętów (metry trasy), każdy dostaje grot. */
  setRoute(path, turns = this.turns || []) {
    this.turns = turns; this.path = path;
    const gl = this.gl; if (!gl || !this.sol) { this.pendingRoute = path; return; }
    for (const m of [this.ribbon, this.under, this.cap]) if (m) { gl.deleteBuffer(m.b); gl.deleteBuffer(m.ib); gl.deleteVertexArray(m.v); }
    this.ribbon = null; this.under = null; this.cap = null;
    if (this.fill) { gl.deleteBuffer(this.fill.b); gl.deleteVertexArray(this.fill.v); this.fill = null; }
    if (!path) return;
    this.fill = this.fillMesh(path);
    const org = path.pts[0]; const mesh = ribbonMesh(path, turns, { style: this.headStyle || 'flat' });
    const up = (d, idx, p) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      for (const [name, size, off] of [['a_c', 2, 0], ['a_n', 2, 8], ['a_off', 2, 16], ['a_nrm', 3, 24], ['a_l', 1, 36], ['a_u', 1, 40], ['a_top', 1, 44], ['a_off0', 2, 48], ['a_nrm0', 3, 56]]) {
        const l = gl.getAttribLocation(p, name); if (l < 0) continue; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 68, off);
      }
      gl.bindVertexArray(null); return { v, b, ib, n: idx.length };
    };
    this.ribbon = { ...up(mesh.data, mesh.index, this.sol), org, heads: mesh.heads, capAt: mesh.capAt };
    const fan = []; for (let j = 1; j < 9; j++) fan.push(0, j + 1, j);
    this.cap = up(new Float32Array(170), new Uint32Array(fan), this.sol); this.under = { ...up(mesh.under.data, mesh.under.index, this.solU), org };
  }

  /** Asfalt pod torem tam, gdzie BDOT nie ma jezdni (path.fill: odcinki w metrach trasy). 3 m w każdą stronę od toru. */
  fillMesh(path) {
    const runs = path.fill || []; if (!runs.length) return null;
    const gl = this.gl; const { pts, along, K } = path; const org = pts[0]; const v = [];
    const at = (s) => { let i = along.findIndex((x) => x >= s); if (i < 0) i = along.length - 1; return Math.max(1, Math.min(pts.length - 2, i)); };
    for (const [a, b] of runs) {
      let prev = null;
      for (let i = at(a); i <= at(b); i++) {
        const p = pts[i]; const q0 = pts[i - 1]; const q1 = pts[i + 1]; const l = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1;
        const nx = (-(q1[1] - q0[1]) / l) * 3 * K; const ny = ((q1[0] - q0[0]) / l) * 3 * K;
        const L = [p[0] + nx - org[0], p[1] + ny - org[1]]; const R = [p[0] - nx - org[0], p[1] - ny - org[1]];
        if (prev) v.push(...prev[0], 6, ...prev[1], 6, ...R, 6, ...prev[0], 6, ...R, 6, ...L, 6);
        prev = [L, R];
      }
    }
    if (!v.length) return null;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0); gl.bindVertexArray(null);
    return { v: vao, b, n: v.length / 3, org };
  }

  setHeadStyle(style) { this.headStyle = style; if (this.path) this.setRoute(this.path, this.turns); }

  /** Znacznik auta w świecie: stała wielkość na ekranie, kierunek jazdy. */
  drawPuck(gl) {
    if (this.carHd == null || !this.puckP) return;
    if (!this.puckM) {
      const d = puckMesh(); const v = gl.createVertexArray(); gl.bindVertexArray(v); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
      for (const [name, size, off] of [['a_p', 3, 0], ['a_nrm', 3, 12], ['a_k', 1, 24]]) { const l = gl.getAttribLocation(this.puckP, name); if (l < 0) continue; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 28, off); }
      gl.bindVertexArray(null); this.puckM = { v, n: d.length / 7 };
    }
    const p = this.puckP; gl.useProgram(p);
    const size = (this.puckPx || 58) * (W / (512 * 2 ** this.map.getZoom())); // połowa długości grota w pikselach
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_m'), false, this.tileM(this.eye[0], this.eye[1]));
    gl.uniform1f(gl.getUniformLocation(p, 'u_rot'), (this.carHd * Math.PI) / 180); gl.uniform1f(gl.getUniformLocation(p, 'u_size'), size);
    gl.uniform3f(gl.getUniformLocation(p, 'u_eye'), this.cam[0] - this.eye[0], this.cam[1] - this.eye[1], this.camZ); gl.uniform1f(gl.getUniformLocation(p, 'u_night'), this.night ? 1 : 0);
    gl.bindVertexArray(this.puckM.v);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, this.puckM.n - 6, 6); // cień
    gl.disable(gl.BLEND); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, this.puckM.n - 6); // auto zawsze na wierzchu
    gl.bindVertexArray(null);
  }

  drawRibbon(gl) {
    if (this.ribbon && this.drive && !this.ribbonOff) {
      const r = this.ribbon; const M = this.tileM(r.org[0], r.org[1]); const from = this.along || 0;
      const jam = new Float32Array(18); (this.jams || []).filter((j) => j.to > from).slice(0, 6).forEach((j, i) => jam.set([j.from, j.to, j.sev], i * 3));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.useProgram(this.solU); // cień i poświata na asfalcie
      gl.uniformMatrix4fv(gl.getUniformLocation(this.solU, 'u_m'), false, M); gl.uniform1f(gl.getUniformLocation(this.solU, 'u_from'), from);
      gl.uniform1f(gl.getUniformLocation(this.solU, 'u_hw'), RIB.hw); gl.uniform1f(gl.getUniformLocation(this.solU, 'u_night'), this.night ? 1 : 0);
      gl.bindVertexArray(this.under.v); gl.depthFunc(gl.LEQUAL); gl.drawElements(gl.TRIANGLES, this.under.n, gl.UNSIGNED_INT, 0);
      const p = this.sol; gl.useProgram(p);
      gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_m'), false, M); gl.uniform1f(gl.getUniformLocation(p, 'u_from'), from);
      const hs = new Float32Array(4); r.heads.filter((h) => h + 12 > from).slice(0, 4).forEach((h, i) => { hs[i] = h; }); gl.uniform1fv(gl.getUniformLocation(p, 'u_heads[0]'), hs);
      gl.uniform1f(gl.getUniformLocation(p, 'u_t'), performance.now() / 1000); gl.uniform1f(gl.getUniformLocation(p, 'u_night'), this.night ? 1 : 0);
      gl.uniform3fv(gl.getUniformLocation(p, 'u_jam'), jam); gl.uniform3f(gl.getUniformLocation(p, 'u_eye'), this.cam[0] - r.org[0], this.cam[1] - r.org[1], this.camZ);
      gl.bindVertexArray(r.v);
      gl.uniform1f(gl.getUniformLocation(p, 'u_ghost'), 1); gl.depthFunc(gl.GREATER); gl.drawElements(gl.TRIANGLES, r.n, gl.UNSIGNED_INT, 0); // za budynkiem: przezroczysta
      gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
      gl.uniform1f(gl.getUniformLocation(p, 'u_ghost'), 0); gl.drawElements(gl.TRIANGLES, r.n, gl.UNSIGNED_INT, 0);
      const cd = r.capAt(from + 0.01);
      if (cd) { gl.bindVertexArray(this.cap.v); gl.bindBuffer(gl.ARRAY_BUFFER, this.cap.b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cd); gl.drawElements(gl.TRIANGLES, this.cap.n, gl.UNSIGNED_INT, 0); }
      gl.bindVertexArray(null);
    }
    if (this.drive && this.soft) this.drawPuck(gl);
    gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);
  }

}
