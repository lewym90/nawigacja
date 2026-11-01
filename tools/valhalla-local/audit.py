import sys; WHICH = sys.argv[1] if len(sys.argv) > 1 else "auto"
import json, random, sys, statistics as st
from r import a
import math
def hav(a,b):
    R=6371000; p1,p2=math.radians(a[0]),math.radians(b[0]); dl=math.radians(b[1]-a[1]); dp=p2-p1
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))
def dec(s,p=6):
    f=10**p; out=[]; i=0; la=lo=0
    while i<len(s):
        for ax in (0,1):
            sh=r=0
            while True:
                b=ord(s[i])-63; i+=1; r|=(b&31)<<sh; sh+=5
                if b<32: break
            d=~(r>>1) if r&1 else r>>1
            if ax==0: la+=d
            else: lo+=d
        out.append((la/f,lo/f))
    return out
import snap
APP={'pedestrian':{'walkway_factor':1,'sidewalk_factor':1,'alley_factor':1,'driveway_factor':1,'use_living_streets':1,'use_tracks':0.6}}

random.seed(5)
LAT0,LNG0=51.2465,22.5684
SERV={'driveway','parking_aisle','alley','drive_through','emergency_access','service_road'}

CUR='auto'
def rp(rlat=0.07,rlng=0.11,c=(LAT0,LNG0)):
    # punkt NA drodze danego rodzaju + błąd GPS 3-8 m
    for _ in range(20):
        p=(c[0]+random.uniform(-rlat,rlat), c[1]+random.uniform(-rlng,rlng))
        try:
            loc=json.loads(a.locate(json.dumps({'locations':[{'lat':p[0],'lon':p[1],'radius':150}],'costing':CUR,'verbose':True})))
            es=[e for e in loc[0].get('edges',[]) if 'correlated_lat' in e]
            if not es: continue
            e=min(es,key=lambda e:e.get('distance',1e9))
            q=(e['correlated_lat'],e['correlated_lon'])
            ang=random.uniform(0,6.283); r=random.uniform(3,8)
            return (q[0]+r*math.cos(ang)/111195.0, q[1]+r*math.sin(ang)/(111195.0*0.626))
        except Exception:
            continue
    return p

def trace(shape, costing):
    try:
        ta=json.loads(a.trace_attributes(json.dumps({'shape':[{'lat':p[0],'lon':p[1]} for p in shape],'costing':costing,'shape_match':'edge_walk','filters':{'attributes':['edge.id','edge.way_id','edge.use','edge.length','edge.road_class','edge.names','edge.surface'],'action':'include'}})))
        return ta['edges']
    except Exception as e:
        return None

def get(costing,A,B,opts=None,pre=True):
    if costing in ('pedestrian','bicycle') and pre:
        bp=snap.best_pair(A,B,costing,opts)
        A2,B2=(bp[1],bp[2]) if bp else (A,B)
    else: A2,B2=A,B
    body={'locations':[{'lat':A2[0],'lon':A2[1]},{'lat':B2[0],'lon':B2[1]}],'costing':costing,'directions_options':{'language':'pl-PL'}}
    if opts: body['costing_options']=opts
    try:
        t=json.loads(a.route(json.dumps(body)))['trip']
    except Exception as e:
        return None
    return t, dec(t['legs'][0]['shape'])

def audit(costing,n,dmin,dmax,opts=None,center=(LAT0,LNG0),rl=0.07,rg=0.11):
    global CUR; CUR=costing
    flags={'ratio':[], 'loop':[], 'wrongstart':[], 'service_mid':[], 'norouts':0, 'steps_bike':[]}
    ratios=[]; done=0; tries=0
    while done<n and tries<n*20:
        tries+=1
        A=rp(rl,rg,center); B=rp(rl,rg,center); d=hav(A,B)
        if not (dmin<d<dmax): continue
        r=get(costing,A,B,opts)
        if r is None: flags['norouts']+=1; done+=1; continue
        t,sh=r; L=t['summary']['length']*1000; done+=1
        ratios.append(L/d)
        edges=trace(sh,costing) or []
        # pętla: powtórzona krawędź
        ids=[e.get('id') for e in edges if e.get('id') is not None]
        if len(ids)!=len(set(ids)): flags['loop'].append((round(L),round(d),A,B))
        # zła strona na starcie: odległość do celu po 150-450 m trasy wyraźnie większa niż na starcie
        cum=0; worst=0
        for p,q in zip(sh,sh[1:]):
            cum+=hav(p,q)
            if 150<=cum<=500: worst=max(worst,hav(q,B)-d)
            if cum>500: break
        if worst>120 and d>800: flags['wrongstart'].append((round(worst),round(L),round(d),A,B))
        # usługowe drogi w środku trasy
        tot=sum(e.get('length',0)*1000 for e in edges); acc=0; mid=0
        for e in edges:
            ln=e.get('length',0)*1000
            if acc>300 and acc<tot-300 and e.get('use') in SERV: mid+=ln
            acc+=ln
        if mid>120: flags['service_mid'].append((round(mid),round(L),A,B))
        if costing=='bicycle' and any(e.get('use')=='steps' for e in edges): flags['steps_bike'].append((A,B))
        if L/d>2.2 and d>600: flags['ratio'].append((round(L/d,2),round(L),round(d),A,B))
    ratios.sort()
    print(f"\n== {costing}: {done} tras ({dmin}-{dmax} m) | bez trasy: {flags['norouts']} | trasa/prosto: mediana {st.median(ratios):.2f}, p90 {ratios[int(len(ratios)*.9)]:.2f}, max {ratios[-1]:.2f}")
    print(f"   pętle (powtórzona droga): {len(flags['loop'])} | ruszanie w złą stronę (>120 m): {len(flags['wrongstart'])} | >120 m po drogach serwisowych w środku trasy: {len(flags['service_mid'])} | ratio>2.2: {len(flags['ratio'])} | rower po schodach: {len(flags['steps_bike'])}")
    return flags
if __name__=='__main__':
    which=WHICH
    if which=='auto':
        f=audit('auto',120,1500,9000)
        json.dump({k:v for k,v in f.items() if isinstance(v,list)},open('audit_auto.json','w'))
    if which=='ped':
        f=audit('pedestrian',100,400,2500,APP,rl=0.03,rg=0.05)
        json.dump({k:v for k,v in f.items() if isinstance(v,list)},open('audit_ped.json','w'))
    if which=='bike':
        f=audit('bicycle',80,800,6000,{'bicycle':{'service_penalty':5,'use_living_streets':1}},rl=0.05,rg=0.08)
        json.dump({k:v for k,v in f.items() if isinstance(v,list)},open('audit_bike.json','w'))
