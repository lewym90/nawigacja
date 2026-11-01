import json, math, sys
sys.argv=['x']
from r import route
import importlib
def dec(s, p=6):
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
        out.append((la/f, lo/f))
    return out
def hav(a,b):
    R=6371000; p1,p2=math.radians(a[0]),math.radians(b[0]); dl=math.radians(b[1]-a[1]); dp=p2-p1
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))
def show(body, label):
    r=route(body); t=r['trip']; leg=t['legs'][0]; sh=dec(leg['shape'])
    print(f"{label}: {t['summary']['length']*1000:.0f} m {t['summary']['time']/60:.1f} min, {len(leg['maneuvers'])} manewrów, prosto {hav(sh[0],sh[-1]):.0f} m")
    return r, sh
if __name__=='__main__':
    A=(51.19897,22.55267); B=(51.19835,22.54430)
    body={'locations':[{'lat':A[0],'lon':A[1]},{'lat':B[0],'lon':B[1]}],'costing':'pedestrian','directions_options':{'language':'pl-PL'}}
    r,sh=show(body,'domyślne')
    for m in r['trip']['legs'][0]['maneuvers']: print(' ',m['type'],round(m['length']*1000),m['instruction'])
    print('start shape:', sh[0], 'koniec', sh[-1])
    # pierwsze 12 punktów
    for p in sh[:14]: print('  ',round(p[0],6),round(p[1],6))
