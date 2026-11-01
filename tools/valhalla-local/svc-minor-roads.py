import sys,json,math
sys.argv=['x','none']
import audit, svc
from audit import a, dec
BADN={'track'}
SERVU={'service_road','driveway','parking_aisle','alley','drive_through','emergency_access'}
def edges_of(shape):
    ta=json.loads(a.trace_attributes(json.dumps({'shape':[{'lat':p[0],'lon':p[1]} for p in shape],'costing':'auto','shape_match':'edge_walk','filters':{'attributes':['edge.use','edge.length','edge.begin_shape_index','edge.end_shape_index','edge.names','shape'],'action':'include'}})))
    return ta['edges'], [(p[0],p[1]) if isinstance(p,(list,tuple)) else (p['lat'],p['lon']) for p in ta.get('shape',[])] if isinstance(ta.get('shape'),list) else dec(ta['shape'])
def bad_runs(edges,shp,total_m,end_keep,svc_min,use_svc=True):
    runs=[];acc=0;cur=None
    for e in edges:
        ln=e['length']*1000;u=e.get('use')
        bad=(u in BADN) or (use_svc and u in SERVU)
        mid=acc>end_keep and acc+ln<total_m-end_keep
        if bad and mid:
            pass
            if cur and cur['use_group']==('t' if u in BADN else 's'): cur['b']=e['end_shape_index']; cur['m']+=ln; cur['es'].append((e['begin_shape_index'],e['end_shape_index']))
            else:
                if cur: runs.append(cur)
                cur={'a':e['begin_shape_index'],'b':e['end_shape_index'],'m':ln,'use_group':'t' if u in BADN else 's','es':[(e['begin_shape_index'],e['end_shape_index'])]}
        else:
            if cur: runs.append(cur); cur=None
        acc+=ln
    if cur: runs.append(cur)
    return [r for r in runs if (r['m']>=60 if r['use_group']=='t' else r['m']>=svc_min)]
def squares(shp,i0,i1,h=5):
    pts=shp[i0:i1+1]
    L=[audit.hav(p,q) for p,q in zip(pts,pts[1:])]; tot=sum(L)
    if tot<15 or len(pts)<2: return []
    half=tot/2;c=0
    for (p,q),l in zip(zip(pts,pts[1:]),L):
        if c+l>=half:
            f=(half-c)/l if l else 0; m=(p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f);break
        c+=l
    dl=h/111195.0; dg=h/(111195.0*0.626)
    return [[[m[1]-dg,m[0]-dl],[m[1]+dg,m[0]-dl],[m[1]+dg,m[0]+dl],[m[1]-dg,m[0]+dl],[m[1]-dg,m[0]-dl]]]
def poly(shp,i0,i1,w=6):
    pts=shp[i0:i1+1]; n=len(pts)
    lo=int(n*0.15); hi=max(lo+1,int(n*0.85)) 
    pts=pts[lo:hi+1] if hi-lo>=1 else pts
    # bufor jako prostokąt wokół odcinka (uproszczony: ramka punktów ±w m)
    dl=w/111195.0; dg=w/(111195.0*0.626)
    left=[(p[1]-dg,p[0]+dl) for p in pts]; right=[(p[1]+dg,p[0]-dl) for p in reversed(pts)]
    ring=left+right+[left[0]]
    return [[x,y] for x,y in ring]
def mid(shp,i0,i1):
    pts=shp[i0:i1+1]
    L=[audit.hav(p,q) for p,q in zip(pts,pts[1:])]; tot=sum(L)
    if tot<12 or len(pts)<2: return None
    half=tot/2;c=0
    for (p,q),l in zip(zip(pts,pts[1:]),L):
        if c+l>=half:
            f=(half-c)/l if l else 0; return {'lat':p[0]+(q[0]-p[0])*f,'lon':p[1]+(q[1]-p[1])*f}
        c+=l
def route_ex(A,B,polys):
    body={'locations':[{'lat':A[0],'lon':A[1]},{'lat':B[0],'lon':B[1]}],'costing':'auto','costing_options':{'auto':{'use_distance':0.6}},'directions_options':{'language':'pl-PL'}}
    if polys: body['exclude_locations']=polys[:40]
    t=json.loads(a.route(json.dumps(body)))['trip']; return t,dec(t['legs'][0]['shape'])
def improve(A,B,end_keep,svc_min,use_svc=True):
    t,sh=route_ex(A,B,[]); base=(t['summary']['length'],t['summary']['time']/60); polys=[]
    for it in range(3):
        ed,shp=edges_of(sh); tot=sum(e['length']*1000 for e in ed)
        runs=bad_runs(ed,shp,tot,end_keep,svc_min,use_svc)
        if not runs: break
        polys+= [m for r in runs for (i0,i1) in r['es'] for m in [mid(shp,i0,i1)] if m]
        try: t,sh=route_ex(A,B,polys)
        except Exception: return base,None,len(polys),True
    ed,shp=edges_of(sh);tot=sum(e['length']*1000 for e in ed)
    left=sum(r['m'] for r in bad_runs(ed,shp,tot,end_keep,svc_min,use_svc))
    return base,(t['summary']['length'],t['summary']['time']/60),len(polys),left
if __name__=='__main__':
    rows=[]
    for A,B,k in svc.pairs:
        ek=600; sm=150 if k=="far" else 250
        base,new,n,left=improve(tuple(A),tuple(B),ek,sm)
        if n==0: continue
        rows.append((k,base,new,n,left,A,B))
        print(k,'bazowa %.1f km %.0f min'%base,'| po: '+('brak' if new is None else '%.1f km %.0f min'%new),'| wycięć',n,'| zostało',left if left is not True else 'błąd')
    json.dump(rows,open('svc5.json','w'))
    ok=[r for r in rows if r[2]]
    print('tras poprawianych:',len(rows),'z 100; nadmiar km:',round(sum(r[2][0]-r[1][0] for r in ok),1),'min:',round(sum(r[2][1]-r[1][1] for r in ok),1),'| z pozostałością:',sum(1 for r in ok if r[4] and r[4] is not True and r[4]>0))
