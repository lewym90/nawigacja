import { ribbonMesh, puckMesh, RIB, PN, lampMesh, signalMesh } from './solid.js';
import { FACADE_M } from './facade-size.js';
// Własny silnik miasta 3D: rysuje prawdziwe bryły budynków (GUGiK LoD2, tools/build-city.py) wewnątrz mapy.
// Ściany dostają elewacje z atlasu, dachy kolor wg kształtu. Kafle dociągane wokół punktu przed autem.

// Wspólne oświetlenie nowego wyglądu: światło nieba z góry, ciepłe odbicie od ziemi, słońce i łagodna obróbka kolorów (ACES).
const ENV = `
vec3 tonemap(vec3 c){ c*=0.98; c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14); return clamp(c,0.0,1.0); }
vec3 envLight(vec3 base, vec3 N, float ao){
  vec3 L=normalize(vec3(-0.35,-0.45,0.82));
  vec3 hemi=mix(vec3(.50,.47,.42),vec3(.70,.78,.90),N.z*0.5+0.5);
  vec3 sun=vec3(1.0,.95,.86)*max(dot(N,L),0.0);
  return base*(hemi*0.78+sun*0.72)*ao;
}`;
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
${ENV}
uniform sampler2D u_atlas; uniform float u_fm[24]; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night; uniform float u_soft;
out vec4 o;
void main(){
  cut(v_pos);
  float c=v_cell; vec2 cell=vec2(mod(c,4.0),floor(c/4.0));
  vec2 uv=v_uv/u_fm[int(c+0.5)]; // współrzędne ścian są w metrach, a każda elewacja ma swoją wielkość
  vec2 f=fract(uv); vec2 s=vec2(0.25,1.0/6.0);
  vec3 tex=textureGrad(u_atlas,(cell+0.005+f*0.99)*s,dFdx(uv)*s,dFdy(uv)*s).rgb;
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  float d=max(dot(n,u_sun),0.0);
  float ao=mix(0.62,1.0,smoothstep(0.0,5.0,v_pos.z));
  if(u_soft>0.5){ ao=mix(0.5,1.0,smoothstep(0.0,9.0,v_pos.z)); tex=mix(tex,vec3(dot(tex,vec3(.3,.55,.15))),0.22); }
  vec3 col=u_soft>0.5&&u_night<0.5?tonemap(envLight(tex,n,mix(0.6,1.0,ao))):tex*(u_night>0.5?1.0:(u_soft>0.5?(0.7+0.38*d):(0.62+0.5*d)))*ao;
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
${ENV}
uniform sampler2D u_roofs; uniform vec3 u_sun; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night; uniform float u_soft;
out vec4 o;
void main(){
  cut(v_pos);
  int k=int(v_kind); bool p=k>=3;
  vec3 n=normalize(cross(dFdx(v_pos),dFdy(v_pos)));
  if(n.z<0.0) n=-n;
  vec3 t=length(n.xy)>0.05?normalize(vec3(-n.y,n.x,0.0)):vec3(1.0,0.0,0.0);
  vec3 b=cross(n,t);
  vec2 uv=vec2(dot(v_pos,t),dot(v_pos,b))/(p?(k==4?6.0:5.0):10.0);
  vec2 g=vec2(p?(k==4?1.0:0.0):2.0,0.0)/3.0; // dachówka, blacha na rąbek, papa
  vec2 sc=vec2(1.0/3.0,1.0);
  vec3 tex=textureGrad(u_roofs,g+(0.01+fract(uv)*0.98)*sc,dFdx(uv)*sc,dFdy(uv)*sc).rgb;
  if(p){ if(k==5) tex*=vec3(.82,.7,.64); }
  else tex*=(k==1?1.1:k==2?0.88:1.0);
  float d=max(dot(n,u_sun),0.0);
  if(u_soft>0.5) tex=mix(tex,vec3(dot(tex,vec3(.3,.55,.15))),0.35)*0.92;
  vec3 col=u_soft>0.5&&u_night<0.5?tonemap(envLight(tex*1.1,n,1.0)):tex*(0.62+0.55*d);
  if(u_night>0.5) col*=0.15;
  float fog=smoothstep(800.0,2500.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog*0.72),1.0);
}`;
const VS_TREE = `#version 300 es
in vec4 a_tree;
uniform mat4 u_m; uniform vec2 u_right; uniform float u_scale; uniform float u_cross; uniform vec3 u_eye; uniform float u_near;
out vec2 v_uv; out float v_tint; out vec3 v_pos; out float v_lit;
const vec2 C[6]=vec2[6](vec2(-.5,0.),vec2(.5,0.),vec2(.5,1.),vec2(-.5,0.),vec2(.5,1.),vec2(-.5,1.));
void main(){
  vec2 c=C[gl_VertexID%6];
  if(u_near>0.0 && distance(a_tree.xy,u_eye.xy)<u_near){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
  float kind=floor(a_tree.w); float f=fract(a_tree.w);
  float h=a_tree.z*u_scale;
  // gatunek: iglaste to sosna, liściaste losowo z pozycji (lipa, dąb, brzoza, klon, topola, młode), niskie to krzew
  float r=fract(sin(dot(a_tree.xy,vec2(12.9898,78.233)))*43758.5453);
  float sp=kind<0.5?5.0:(h<4.5?7.0:(r<0.24?0.0:r<0.4?1.0:r<0.56?2.0:r<0.76?3.0:r<0.84?4.0:6.0));
  if(sp>6.5) h*=0.5;
  float side=f>0.45?1.0:-1.0;
  // nowy wygląd: dwie skrzyżowane płaszczyzny pod stałym kątem, więc drzewo stoi w świecie i nie obraca się za kamerą
  float th=r*6.2832; vec2 ax=gl_VertexID<6?vec2(cos(th),sin(th)):vec2(-sin(th),cos(th));
  if(gl_VertexID>=6) side=-side;
  vec2 dir=u_cross>0.5?ax:u_right;
  v_lit=u_cross>0.5?0.78+0.3*abs(dot(vec2(-dir.y,dir.x),normalize(vec2(-0.35,-0.45)))):1.0;
  vec3 p=vec3(a_tree.xy+dir*c.x*h,c.y*h); // komórka atlasu jest kwadratowa
  v_uv=vec2((mod(sp,4.0)+0.5+c.x*side*0.98)*0.25,(floor(sp/4.0)+1.0-c.y*0.99-0.005)*0.5);
  v_tint=f; v_pos=p;
  gl_Position=u_m*vec4(p,1.0);
}`;
const FS_TREE = `#version 300 es
precision highp float;
in vec2 v_uv; in float v_tint; in vec3 v_pos; in float v_lit;
${ENV}
uniform sampler2D u_trees; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night;
out vec4 o;
void main(){
  vec4 t=texture(u_trees,v_uv);
  if(t.a<0.5) discard;
  vec3 col=t.rgb*mix(vec3(.82,.88,.8),vec3(1.05,1.02,.92),v_tint)*v_lit;
  col*=mix(0.72,1.0,smoothstep(0.0,6.0,v_pos.z));
  if(u_night<0.5) col=tonemap(col*1.05);
  if(u_night>0.5) col*=0.2;
  float fog=smoothstep(800.0,2500.0,distance(v_pos,u_eye));
  o=vec4(mix(col,u_fog,fog*0.72),1.0);
}`;

const VS_ROAD = `#version 300 es
in vec3 a_pos;
uniform mat4 u_m; uniform vec2 u_org;
out vec2 v_xy; out vec2 v_p; flat out float v_k;
void main(){ v_xy=a_pos.xy+u_org; v_p=a_pos.xy; v_k=a_pos.z; float k=floor(a_pos.z+0.5); gl_Position=u_m*vec4(a_pos.xy,(k==0.0||k==1.0)?0.4:0.0,1.0); }`; // chodnik i krawężnik 25 cm nad jezdnią: wyżej niż w rzeczywistości, żeby było widać z kamery
const FS_ROAD = `#version 300 es
precision highp float;
in vec2 v_xy; in vec2 v_p; flat in float v_k;
uniform sampler2D u_asphalt; uniform sampler2D u_pave; uniform vec3 u_fog; uniform vec3 u_eye; uniform float u_night;
${ENV}
out vec4 o;
void main(){
  int k=int(v_k+0.5); vec3 c;
  vec2 m=v_xy/1.6;
  if(k==2||k==5||k==6){ float big=texture(u_asphalt,m/37.0).r; c=texture(u_asphalt,m/6.0).rgb*(0.82+0.42*big); c=mix(c,vec3(dot(c,vec3(.33))),0.6);
    c=k==2?c*0.78:k==5?c*0.86:mix(c*1.15,vec3(.42,.42,.41),.35); } // główne najciemniejsze, zwykłe ulice ciemne, wąskie uliczki jaśniejsze
  else if(k==7){ c=texture(u_asphalt,m/6.0).rgb*0.95; } // parking
  else if(k==0){ c=texture(u_pave,m/5.0).rgb*0.92; }
  else if(k==3){ c=texture(u_pave,m/3.0).rgb*vec3(.72,.7,.68); }
  else if(k==1){ c=vec3(.9,.9,.87); } // górna płaszczyzna krawężnika: jasny beton
  else { c=vec3(.6,.57,.5); }
  if(u_night>0.5) c*=vec3(.3,.34,.44);
  float fog=smoothstep(900.0,2600.0,distance(vec3(v_p,0.0),u_eye));
  if(u_night<0.5) c=tonemap(c*0.92);
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
// Cień pod drzewem: miękka elipsa na ziemi, przesunięta od słońca.
const VS_TSH = `#version 300 es
in vec4 a_tree;
uniform mat4 u_m; uniform float u_scale;
out vec2 v_q; out vec3 v_pos;
const vec2 C[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(-1.,-1.),vec2(1.,1.),vec2(-1.,1.));
void main(){
  vec2 c=C[gl_VertexID]; float h=a_tree.z*u_scale; if(h<4.5*u_scale) h*=0.5;
  float rr=h*0.32; vec2 p=a_tree.xy+vec2(0.35,0.45)*h*0.22+c*rr;
  v_q=c; v_pos=vec3(p,0.0); gl_Position=u_m*vec4(p,0.0,1.0);
}`;
const FS_TSH = `#version 300 es
precision highp float;
in vec2 v_q; in vec3 v_pos; uniform vec3 u_eye;
out vec4 o;
void main(){ float d=length(v_q); o=vec4(0.0,0.03,0.0,(1.0-smoothstep(0.35,1.0,d))*0.42*(1.0-smoothstep(300.0,700.0,distance(v_pos,u_eye)))); }`;

// Bok krawężnika i cień przy nim na jezdni.
const VS_CURB = `#version 300 es
in vec4 a_pos; in vec2 a_n;
uniform mat4 u_m;
out vec3 v_p; out float v_s; out vec2 v_n;
void main(){ v_p=a_pos.xyz; v_s=a_pos.w; v_n=a_n; gl_Position=u_m*vec4(a_pos.xyz,1.0); }`;
const FS_CURB = `#version 300 es
precision highp float;
in vec3 v_p; in float v_s; in vec2 v_n;
uniform vec3 u_cam; uniform float u_night; uniform vec3 u_eye;
out vec4 o;
void main(){
  float fade=1.0-smoothstep(350.0,900.0,distance(vec3(v_p.xy,0.0),u_eye));
  if(v_s<0.0){ float a=-v_s; o=vec4(0.0,0.0,0.0,a*a*0.5*fade); return; } // cień: najciemniej przy krawężniku
  if(dot(v_n,u_cam.xy-v_p.xy)<0.0) discard; // bok zwrócony od kamery zasłania chodnik
  vec2 L=normalize(vec2(-0.35,-0.45)); float lit=0.7+0.35*max(dot(v_n,L),0.0);
  vec3 c=vec3(0.86,0.86,0.84)*lit*mix(0.62,1.08,v_s); // jasna górna krawędź, ciemniej przy jezdni
  if(u_night>0.5) c*=vec3(.3,.34,.44);
  o=vec4(c,fade);
}`;

// Modele 3D właściciela (tools/build-models.py): latarnie, sygnalizatory i drzewa blisko auta.
const VS_MODEL = `#version 300 es
in vec3 a_p; in vec3 a_n; in vec2 a_uv; in float a_layer; in vec3 a_col; in float a_kind; in vec4 a_inst;
uniform mat4 u_m; uniform float u_k; uniform float u_mode; uniform float u_mh; uniform float u_sx; uniform vec3 u_eye; uniform float u_near;
out vec3 v_n; out vec3 v_pos; out vec2 v_uv; flat out float v_layer; out vec3 v_col; flat out float v_kind;
void main(){
  float ang=a_inst.w; vec3 sc=vec3(u_k);
  if(u_mode>0.5){ // drzewo: [x, y, docelowa wysokość, obrót]; tylko blisko auta, dalej rysują je płaszczyzny
    if(distance(a_inst.xy,u_eye.xy)>u_near){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
    float s=a_inst.z/u_mh; sc=vec3(s*u_sx,s*u_sx,s);
  }
  float c=cos(ang); float sn=sin(ang); mat2 R=mat2(c,sn,-sn,c);
  vec3 p=vec3(a_inst.xy+R*(a_p.xy*sc.xy),a_p.z*sc.z);
  v_n=normalize(vec3(R*a_n.xy,a_n.z)); v_pos=p; v_uv=a_uv; v_layer=a_layer; v_col=a_col; v_kind=a_kind;
  gl_Position=u_m*vec4(p,1.0);
}`;
const FS_MODEL = `#version 300 es
precision highp float; precision highp sampler2DArray;
in vec3 v_n; in vec3 v_pos; in vec2 v_uv; flat in float v_layer; in vec3 v_col; flat in float v_kind;
uniform sampler2DArray u_tex; uniform vec3 u_eye; uniform vec3 u_fog; uniform float u_night;
${ENV}
out vec4 o;
void main(){
  int k=int(v_kind+0.5);
  // liście: ostrzejsza tekstura i niższy próg, bo przy oddaleniu drobne listki rozmywały się w przezroczystość i drzewo wyglądało na łyse
  vec4 t=v_layer>=0.0?(k==1?texture(u_tex,vec3(v_uv,v_layer),-1.5):texture(u_tex,vec3(v_uv,v_layer))):vec4(1.0);
  if(k==1 && t.a<0.28) discard;
  if(k==1) t.rgb/=max(t.a,0.35);
  vec3 N=normalize(v_n); vec3 L=normalize(vec3(-0.35,-0.45,0.82));
  float d=k==1?0.55+0.45*(dot(N,L)*0.5+0.5):0.55+0.55*max(dot(N,L),0.0); // liście: światło miękko przechodzi
  vec3 c=u_night<0.5?tonemap(envLight(t.rgb*v_col,k==1?normalize(N+vec3(0.,0.,0.6)):N,mix(0.7,1.0,smoothstep(0.0,5.0,v_pos.z)))):t.rgb*v_col*d*mix(0.75,1.0,smoothstep(0.0,5.0,v_pos.z));
  if(u_night>0.5) c*=0.22;
  if(k==2) c=u_night>0.5?vec3(1.,.93,.75)*1.6:vec3(.85,.86,.82);
  if(k==3) c=vec3(.98,.14,.1); if(k==4) c=vec3(.35,.25,.05); if(k==5) c=vec3(.05,.28,.12);
  float fog=smoothstep(800.0,2500.0,distance(v_pos,u_eye));
  o=vec4(mix(c,u_fog,fog*0.72),1.0);
}`;
// Cyfra na tarczy znaku: kwadrat przed białą tarczą modelu, komórka z atlasu cyfr rysowanego w przeglądarce.
const VS_NUM = `#version 300 es
in vec4 a_inst;
uniform mat4 u_m; uniform float u_k;
out vec2 v_uv; out vec3 v_pos;
const vec2 C[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(-1.,-1.),vec2(1.,1.),vec2(-1.,1.));
void main(){
  vec2 c=C[gl_VertexID]; float cs=cos(a_inst.z); float sn=sin(a_inst.z);
  // patrząc na tarczę od przodu prawa strona to +y modelu
  vec2 loc=vec2(0.075,c.x*0.21);
  vec2 xy=vec2(loc.x*cs-loc.y*sn,loc.x*sn+loc.y*cs)*u_k; // tarcza modelu: x=0,07 m, środek na 2,48 m
  vec3 p=vec3(a_inst.xy+xy,(2.48+c.y*0.21)*u_k);
  float cell=a_inst.w; v_uv=vec2((mod(cell,4.0)+(c.x*0.5+0.5))/4.0,(floor(cell/4.0)+(0.5-c.y*0.5))/4.0); v_pos=p;
  gl_Position=u_m*vec4(p,1.0);
}`;
const FS_NUM = `#version 300 es
precision highp float;
in vec2 v_uv; in vec3 v_pos; uniform sampler2D u_num; uniform float u_night;
out vec4 o;
void main(){ vec4 t=texture(u_num,v_uv); if(t.a<0.5) discard; o=vec4(vec3(0.05)*(u_night>0.5?0.5:1.0),1.0); }`;
const SIGN_KMH = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140];

const TREE_NEAR = 420; // m Merkatora (ok. 260 m): bliżej drzewa jako modele, dalej jako płaszczyzny

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
uniform mat4 u_m; uniform float u_from; uniform float u_heads[4]; uniform float u_leads[4];
out vec3 v_nrm; out vec3 v_pos; out float v_l; out float v_u; out float v_top;
void main(){
  v_top=a_top;
  float sc=1.0;
  float g=1.0; // grot podnosi się między 120 a 80 m przed skrętem i kładzie tuż przed nim, bo od tyłu stojący grot to ściana przed autem
  for(int i=0;i<4;i++){ float h=u_heads[i]; if(h>0.0 && a_l>=h-0.01 && a_l<h+40.0){ float d=h-u_from; g=smoothstep(120.0,80.0,d-u_leads[i])*smoothstep(2.0,16.0,d); } } // przy kilku skrętach grot wstaje już przed pierwszym
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
  // szkło: odbicie nieba zależne od kąta (Fresnel), miękki połysk wzdłuż grzbietu, spokojny przepływ światła
  vec3 R=reflect(-V,N); vec3 sky=mix(vec3(0.55,0.85,1.0),vec3(0.95,0.99,1.0),smoothstep(0.0,0.8,R.z));
  float fr=pow(1.0-max(dot(N,V),0.0),2.5);
  c=mix(c,sky,fr*0.55*(u_night>0.5?0.4:1.0));
  c+=vec3(0.9,0.98,1.0)*pow(max(dot(R,normalize(vec3(-0.35,-0.45,0.82))),0.0),24.0)*0.45;
  c+=up*(vec3(0.85,0.98,1.0)*(exp(-u*u*6.0)*0.12+flow*0.22+arrow*0.12)+vec3(0.6,0.95,1.0)*smoothstep(0.85,0.99,u)*0.35);
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
  float d=abs(v_u); float sh=(1.0-smoothstep(u_hw-0.4,u_hw+0.6,d))*0.32; float g=exp(-(d-u_hw)*(d-u_hw)*1.4)*(u_night>0.5?0.45:0.26)*step(u_hw,d);
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
    this.headStyle = 'up'; this.sol = prog(gl, VS_SOL, FS_SOL); this.solU = prog(gl, VS_SOL, FS_UNDER); this.puckP = prog(gl, VS_PUCK, FS_PUCK); this.wall = prog(gl, VS_WALL, FS_WALL); this.roof = prog(gl, VS_ROOF, FS_ROOF); this.tree = prog(gl, VS_TREE, FS_TREE); if (this.soft) { this.road = prog(gl, VS_ROAD, FS_ROAD); this.mark = prog(gl, VS_MARK, FS_MARK); this.shq = prog(gl, VS_SHQ, FS_SHQ); this.curb = prog(gl, VS_CURB, FS_CURB); this.tsh = prog(gl, VS_TSH, FS_TSH);
      gl.bindAttribLocation(this.tsh, gl.getAttribLocation(this.tree, 'a_tree'), 'a_tree'); gl.linkProgram(this.tsh);
      this.modelP = prog(gl, VS_MODEL, FS_MODEL); this.loadModels(); this.rib = prog(gl, VS_RIB, FS_RIB); this.dummy = gl.createVertexArray(); } 
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
        if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT))); // ostre tekstury drogi i ścian oglądanych pod kątem
        this.texReady = (this.texReady || 0) + 1; map.triggerRepaint();
      };
      im.src = url;
    };
    const v = this.soft ? 'city2' : 'city'; // nowy wygląd: grafiki właściciela (tools/build-owner.py)
    tex(`./icons/${v}-atlas-${this.night ? 'night' : 'day'}.webp`, 'tex');
    tex(`./icons/${v}-roofs.webp`, 'roofTex');
    tex(`./icons/${v}-trees.webp`, 'treeTex');
    if (this.soft) { tex('./icons/tx2-asphalt.webp', 'asphalt'); tex('./icons/tx2-pave.webp', 'pave'); }
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
      const co = 8 + n * 12 + m * 16; let c = 0;
      if (r.byteLength >= co + 4) { c = new Uint32Array(r.slice(co, co + 4))[0]; if (c) tile.curbv = { ...mk(new Uint8Array(r, co + 4, c * 24), 24, [[gl.getAttribLocation(this.curb, 'a_pos'), 4], [gl.getAttribLocation(this.curb, 'a_n'), 2]]), n: c }; }
      const po = co + 4 + c * 24;
      if (r.byteLength >= po + 4) { const np = new Uint32Array(r.slice(po, po + 4))[0]; tile.pinst = new Float32Array(r.slice(po + 4, po + 4 + np * 16)); tile.props = this.propsFrom(tile.pinst); }
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
    const gl = this.gl; const h = buf ? new Uint32Array(buf, 0, 2) : [0, 0]; let treeObj = null; let treeInst = null;
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
      treeInst = new Float32Array(t instanceof ArrayBuffer ? t.slice(0) : t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength));
    }
    const wbytes = buf && new Uint8Array(buf, 8, nw * 24); const rbytes = buf && new Uint8Array(buf, 8 + nw * 24, nr * 16);
    const prev = this.tiles.get(key) || {};
    this.tiles.set(key, { ...prev, wraw: nw ? new Float32Array(buf, 8, nw * 6) : null, occ: null, w: nw ? vao(this.wall, [['a_pos', 3], ['a_uv', 2], ['a_cell', 1]], wbytes, nw, 24) : null, r: nr ? vao(this.roof, [['a_pos', 3], ['a_kind', 1]], rbytes, nr, 16) : null, t: treeObj, k: key.split('_').map(Number) , tinst: treeInst, treeM: treeInst && this.models ? this.treeModels(treeInst) : null });
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
    for (const o of [t.w, t.r, t.t, t.road, t.markv, t.curbv, ...(t.props || []), ...(t.treeM || [])]) if (o) { gl.deleteBuffer(o.b); gl.deleteVertexArray(o.v); if (o.s) gl.deleteVertexArray(o.s); }
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
    // silnik Three.js (nav3d.js) rysuje wtedy wszystko sam: tu zostaje tylko wczytywanie kafli dla kamery i przeszkód
    if (this.hidden) return;
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
      if (p === this.wall) gl.uniform1fv(gl.getUniformLocation(p, 'u_fm[0]'), FACADE_M);
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
          gl.uniform2fv(gl.getUniformLocation(p, 'u_right'), right); gl.uniform1f(gl.getUniformLocation(p, 'u_cross'), this.soft ? 1 : 0); gl.uniform1f(gl.getUniformLocation(p, 'u_near'), this.models ? TREE_NEAR : 0);
          gl.bindVertexArray(o.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.soft ? 12 : 6, o.n);
          continue;
        }
        gl.bindVertexArray(o.v); gl.drawArrays(gl.TRIANGLES, 0, o.n);
      }
    }
    gl.bindVertexArray(null);
    if (this.soft) this.drawModels(gl);
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
    if (this.hidden) return;
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
    gl.useProgram(this.curb); gl.uniform1f(gl.getUniformLocation(this.curb, 'u_night'), this.night ? 1 : 0);
    const ucam = gl.getUniformLocation(this.curb, 'u_cam');
    each(this.curb, (t) => { if (t.curbv) { gl.uniform3f(ucam, this.cam[0] - t.k[0] * g, this.cam[1] - t.k[1] * g, this.camZ); gl.bindVertexArray(t.curbv.v); gl.drawArrays(gl.TRIANGLES, 0, t.curbv.n); } });
    gl.useProgram(this.tsh); gl.uniform1f(gl.getUniformLocation(this.tsh, 'u_scale'), 1.25);
    each(this.tsh, (t) => { if (t.t && Math.hypot(t.k[0] * g + g / 2 - this.eye[0], t.k[1] * g + g / 2 - this.eye[1]) < 900) { gl.bindVertexArray(t.t.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, t.t.n); } });
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
    this.ribbon = { ...up(mesh.data, mesh.index, this.sol), org, heads: mesh.heads, leads: mesh.leads, capAt: mesh.capAt };
    const fan = []; for (let j = 1; j < PN - 1; j++) fan.push(0, j + 1, j);
    this.cap = up(new Float32Array(PN * 17), new Uint32Array(fan), this.sol); this.under = { ...up(mesh.under.data, mesh.under.index, this.solU), org };
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

  /** Modele właściciela: bufory wierzchołków i tekstura tablicowa. Bez nich zostają proste bryły i płaskie drzewa. */
  async loadModels() {
    try {
      const gl = this.gl; const base = './city/models/'; const names = ['lipa', 'dab', 'brzoza', 'sosna', 'krzew', 'latarnia', 'sygnalizator', 'znak'];
      const bufs = await Promise.all(names.map((n) => fetch(`${base}${n}.bin`).then((r) => { if (!r.ok) throw new Error(n); return r.arrayBuffer(); })));
      const img = await fetch(`${base}tex.webp`).then((r) => r.blob()).then((b) => createImageBitmap(b));
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 512, 512, img.height / 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      { const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D_ARRAY, an.TEXTURE_MAX_ANISOTROPY_EXT, 8); }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      const m = { tex };
      names.forEach((n, i) => { const d = new Float32Array(bufs[i]); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); let h = 0; for (let k = 2; k < d.length; k += 13) h = Math.max(h, d[k]); m[n] = { b, n: d.length / 13, h }; });
      this.models = m;
      if (this.signList) this.setSigns(this.signList);
      // kafle wczytane przed modelami
      for (const t of this.tiles.values()) { if (t.tinst) t.treeM = this.treeModels(t.tinst); if (t.pinst) t.props = this.propsFrom(t.pinst); }
      this.map.triggerRepaint();
    } catch (e) { this.models = null; }
  }

  /** Znaki ograniczeń przy trasie: [{ x, y, ang, kmh }] w metrach Merkatora. */
  setSigns(list) {
    this.signList = list; const gl = this.gl;
    if (!gl || !this.models || !this.models.znak) return;
    for (const o of [this.signs, this.signNums]) if (o) { gl.deleteBuffer(o.b); gl.deleteVertexArray(o.v); }
    this.signs = null; this.signNums = null;
    if (!list || !list.length) return;
    const org = [list[0].x, list[0].y];
    this.signs = { ...this.modelVao(this.models.znak, new Float32Array(list.flatMap((s) => [s.x - org[0], s.y - org[1], 0, s.ang]))), org };
    if (!this.numP) {
      this.numP = prog(gl, VS_NUM, FS_NUM);
      const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
      g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
      SIGN_KMH.forEach((k, i) => { const s = String(k); g.font = `bold ${s.length > 2 ? 62 : 84}px Arial, sans-serif`; g.fillText(s, (i % 4) * 128 + 64, Math.floor(i / 4) * 128 + 68); });
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); this.numTex = t;
    }
    const v = gl.createVertexArray(); gl.bindVertexArray(v); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list.flatMap((s) => [s.x - org[0], s.y - org[1], s.ang, Math.max(0, SIGN_KMH.indexOf(s.kmh))])), gl.STATIC_DRAW);
    const l = gl.getAttribLocation(this.numP, 'a_inst'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null); this.signNums = { v, b, n: list.length, org };
  }

  /** VAO modelu z buforem instancji [x, y, z lub wysokość, obrót]. */
  modelVao(model, inst) {
    const gl = this.gl; const p = this.modelP; const v = gl.createVertexArray(); gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, model.b);
    for (const [name, size, off] of [['a_p', 3, 0], ['a_n', 3, 12], ['a_uv', 2, 24], ['a_layer', 1, 32], ['a_col', 3, 36], ['a_kind', 1, 48]]) { const l = gl.getAttribLocation(p, name); if (l < 0) continue; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 52, off); }
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(p, 'a_inst'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null); return { v, b, n: inst.length / 4, verts: model.n, h: model.h };
  }

  /** Drzewa kafla rozdzielone na gatunki tak samo, jak robi to shader płaszczyzn (VS_TREE). */
  treeModels(t) {
    const M = this.models; const buckets = new Map(); const fr = (x) => x - Math.floor(x);
    for (let i = 0; i < t.length; i += 4) {
      const x = t[i]; const y = t[i + 1]; let h = t[i + 2] * 1.25; const kind = Math.floor(t[i + 3]);
      const r = fr(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
      const sp = kind < 0.5 ? 5 : h < 4.5 ? 7 : r < 0.24 ? 0 : r < 0.4 ? 1 : r < 0.56 ? 2 : r < 0.76 ? 3 : r < 0.84 ? 4 : 6;
      if (sp === 7) h *= 0.5;
      // klon i młode drzewo jako lipa, topola jako zwężona lipa
      const [name, sx] = [['lipa', 1], ['dab', 1], ['brzoza', 1], ['lipa', 1], ['lipa', 0.55], ['sosna', 1], ['lipa', 0.8], ['krzew', 1]][sp];
      const key = `${name}:${sx}`; if (!buckets.has(key)) buckets.set(key, { name, sx, a: [] });
      buckets.get(key).a.push(x, y, h, r * 6.2832);
    }
    return [...buckets.values()].map((b) => ({ ...this.modelVao(M[b.name], new Float32Array(b.a)), sx: b.sx }));
  }

  /** Latarnie i sygnalizatory kafla [x, y, rodzaj, kierunek]: modele właściciela, a bez nich proste bryły. */
  propsFrom(all) {
    const np = all.length / 4;
    return [0, 1].map((kind) => {
      const sel = []; for (let i = 0; i < np; i++) if (all[i * 4 + 2] === kind) sel.push(all[i * 4], all[i * 4 + 1], 0, all[i * 4 + 3]);
      if (!sel.length) return null;
      return this.models ? this.modelVao(this.models[kind ? 'sygnalizator' : 'latarnia'], new Float32Array(sel)) : this.simpleVao(kind, new Float32Array(sel));
    });
  }

  /** Zapasowe proste bryły (solid.js) w tym samym układzie wierzchołków co modele: bez tekstury, kolor z materiału. */
  simpleVao(kind, inst) {
    this.simple = this.simple || [];
    if (!this.simple[kind]) {
      const src = kind ? signalMesh() : lampMesh(); const d = new Float32Array((src.length / 7) * 13);
      const COL = { 0: [0.62, 0.64, 0.66], 1: [0.1, 0.11, 0.12], 2: [1, 1, 1], 6: [0.92, 0.92, 0.9] };
      for (let i = 0, j = 0; i < src.length; i += 7, j += 13) { const m = src[i + 6]; d.set([src[i], src[i + 1], src[i + 2], src[i + 3], src[i + 4], src[i + 5], 0, 0, -1, ...(COL[m] || [1, 1, 1]), m === 2 ? 2 : m >= 3 && m <= 5 ? m : 0], j); }
      const b = this.gl.createBuffer(); this.gl.bindBuffer(this.gl.ARRAY_BUFFER, b); this.gl.bufferData(this.gl.ARRAY_BUFFER, d, this.gl.STATIC_DRAW); this.simple[kind] = { b, n: d.length / 13, h: 1 };
    }
    return this.modelVao(this.simple[kind], inst);
  }

  /** Latarnie i sygnalizatory do 600 m od auta, drzewa jako modele do TREE_NEAR. */
  drawModels(gl) {
    if (!this.modelP) return;
    const p = this.modelP; const g = this.grid; gl.useProgram(p);
    gl.uniform1f(gl.getUniformLocation(p, 'u_k'), 1 / Math.cos((this.map.getCenter().lat * Math.PI) / 180));
    gl.uniform1f(gl.getUniformLocation(p, 'u_night'), this.night ? 1 : 0); gl.uniform1f(gl.getUniformLocation(p, 'u_near'), TREE_NEAR);
    gl.uniform3fv(gl.getUniformLocation(p, 'u_fog'), this.night ? [0.063, 0.133, 0.243] : [0.66, 0.76, 0.84]);
    if (this.models) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.models.tex); gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0); }
    const um = gl.getUniformLocation(p, 'u_m'); const ue = gl.getUniformLocation(p, 'u_eye'); const umode = gl.getUniformLocation(p, 'u_mode'); const umh = gl.getUniformLocation(p, 'u_mh'); const usx = gl.getUniformLocation(p, 'u_sx');
    for (const t of this.tiles.values()) {
      const ox = t.k[0] * g; const oy = t.k[1] * g; const dist = Math.hypot(ox + g / 2 - this.eye[0], oy + g / 2 - this.eye[1]);
      if (dist > 600 + g) continue;
      gl.uniformMatrix4fv(um, false, this.tileM(ox, oy)); gl.uniform3f(ue, this.eye[0] - ox, this.eye[1] - oy, 0);
      gl.uniform1f(umode, 0);
      for (const o of t.props || []) if (o) { gl.bindVertexArray(o.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, o.verts, o.n); }
      if (t.treeM && dist < TREE_NEAR + g) {
        gl.uniform1f(umode, 1);
        for (const o of t.treeM) { gl.uniform1f(umh, o.h); gl.uniform1f(usx, o.sx); gl.bindVertexArray(o.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, o.verts, o.n); }
      }
    }
    gl.disable(gl.CULL_FACE);
    if (this.signs && this.drive) {
      const k = 1 / Math.cos((this.map.getCenter().lat * Math.PI) / 180); const M = this.tileM(this.signs.org[0], this.signs.org[1]);
      gl.uniformMatrix4fv(um, false, M); gl.uniform3f(ue, this.eye[0] - this.signs.org[0], this.eye[1] - this.signs.org[1], 0); gl.uniform1f(umode, 0);
      gl.bindVertexArray(this.signs.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.signs.verts, this.signs.n);
      gl.disable(gl.CULL_FACE); const q = this.numP; gl.useProgram(q); gl.uniformMatrix4fv(gl.getUniformLocation(q, 'u_m'), false, M); gl.uniform1f(gl.getUniformLocation(q, 'u_k'), k); gl.uniform1f(gl.getUniformLocation(q, 'u_night'), this.night ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.numTex); gl.uniform1i(gl.getUniformLocation(q, 'u_num'), 0);
      gl.bindVertexArray(this.signNums.v); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.signNums.n);
    }
    gl.bindVertexArray(null); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

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
      const hs = new Float32Array(4); const ls = new Float32Array(4); let k = 0; r.heads.forEach((h, j) => { if (h + 12 > from && k < 4) { hs[k] = h; ls[k] = r.leads[j]; k++; } }); gl.uniform1fv(gl.getUniformLocation(p, 'u_heads[0]'), hs); gl.uniform1fv(gl.getUniformLocation(p, 'u_leads[0]'), ls);
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

export { VS_SOL, FS_SOL, FS_UNDER, VS_PUCK, FS_PUCK, SIGN_KMH, TREE_NEAR, W };
