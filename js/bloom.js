// Lekka poświata (bloom) tylko na jakości Ultra: z gotowej klatki mapy bierze najjaśniejsze miejsca (wstęga, lampy, klosze),
// rozmywa je w małej rozdzielczości i kładzie na mapę w trybie „screen”. Jeden mały obraz na klatkę, bez przebudowy rysowania mapy.

const VS = `#version 300 es
const vec2 P[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
out vec2 v; void main(){ vec2 p=P[gl_VertexID]; v=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;
const PICK = `#version 300 es
precision mediump float; in vec2 v; uniform sampler2D s; out vec4 o;
void main(){ vec3 c=texture(s,vec2(v.x,1.0-v.y)).rgb; float l=max(c.r,max(c.g,c.b)); float sat=l-min(c.r,min(c.g,c.b));
  float k=smoothstep(0.62,0.95,l)*smoothstep(0.18,0.5,sat+0.15*step(0.93,l)); o=vec4(c*k,1.0); }`;
const BLUR = `#version 300 es
precision mediump float; in vec2 v; uniform sampler2D s; uniform vec2 d; out vec4 o;
void main(){ vec3 c=texture(s,v).rgb*0.227; for(int i=1;i<5;i++){ float w=i==1?0.195:i==2?0.122:i==3?0.054:0.016; c+=(texture(s,v+d*float(i)).rgb+texture(s,v-d*float(i)).rgb)*w; } o=vec4(c,1.0); }`;
const OUT = `#version 300 es
precision mediump float; in vec2 v; uniform sampler2D s; uniform float k; out vec4 o;
void main(){ vec3 c=texture(s,v).rgb*k; o=vec4(c,clamp(max(c.r,max(c.g,c.b)),0.0,1.0)); }` // przezroczysta tam, gdzie nic nie świeci: niebo pod spodem zostaje;

export class Bloom {
  constructor(map) {
    this.map = map; this.on = false;
    const c = (this.canvas = document.createElement('canvas'));
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', display: 'none' });
    map.getCanvasContainer().appendChild(c);
    this.small = document.createElement('canvas'); this.sctx = this.small.getContext('2d', { willReadFrequently: false });
    const gl = (this.gl = c.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false }));
    if (!gl) return;
    const prog = (fs) => { const p = gl.createProgram(); for (const [t, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); gl.attachShader(p, sh); } gl.linkProgram(p); return p; };
    this.pick = prog(PICK); this.blur = prog(BLUR); this.out = prog(OUT);
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
    this.src = tex(); this.t = [tex(), tex()]; this.f = [gl.createFramebuffer(), gl.createFramebuffer()];
    this.onRender = () => this.frame();
    map.on('render', this.onRender);
  }

  enable(v) { this.on = !!v && !!this.gl; this.canvas.style.display = this.on ? 'block' : 'none'; }

  frame() {
    if (!this.on) return;
    const src = this.map.getCanvas(); const gl = this.gl;
    const w = Math.max(64, Math.round(src.clientWidth / 3)); const h = Math.max(64, Math.round(src.clientHeight / 3)); // jedna trzecia ekranu wystarcza do rozmycia
    if (this.small.width !== w || this.small.height !== h) {
      this.small.width = w; this.small.height = h; this.canvas.width = w; this.canvas.height = h;
      for (let i = 0; i < 2; i++) { gl.bindTexture(gl.TEXTURE_2D, this.t[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindFramebuffer(gl.FRAMEBUFFER, this.f[i]); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.t[i], 0); }
    }
    this.sctx.drawImage(src, 0, 0, w, h); // klatka mapy jest jeszcze w buforze: zdarzenie render przychodzi zaraz po rysowaniu
    gl.viewport(0, 0, w, h); gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.small);
    const pass = (p, fbo, t, setup) => { gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(gl.getUniformLocation(p, 's'), 0); if (setup) setup(p); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    pass(this.pick, this.f[0], this.src);
    for (let i = 0; i < 2; i++) {
      pass(this.blur, this.f[1], this.t[0], (p) => gl.uniform2f(gl.getUniformLocation(p, 'd'), 1.6 / w, 0));
      pass(this.blur, this.f[0], this.t[1], (p) => gl.uniform2f(gl.getUniformLocation(p, 'd'), 0, 1.6 / h));
    }
    gl.clearColor(0, 0, 0, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT);
    pass(this.out, null, this.t[0], (p) => gl.uniform1f(gl.getUniformLocation(p, 'k'), document.body.classList.contains('day') ? 0.7 : 1.35)); // w dzień delikatniej
  }
}
