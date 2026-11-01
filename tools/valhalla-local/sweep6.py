import random, statistics as st
import snap
from snap import *
from sweep import APP
random.seed(11)
B=(51.19835,22.54430); C=(51.19897,22.55267)
pts=[(C[0]+random.uniform(-0.0006,0.0006), C[1]+random.uniform(-0.0010,0.0010)) for _ in range(60)]
d=[hav(A,B) for A in pts]
orig=snap.candidates
for radius,maxn,walk in ((25,8,1.3),(30,8,1.3),(40,8,1.3),(40,8,0.65),(40,8,0.4)):
    snap.candidates=lambda p,c,radius=radius,maxn=maxn: orig(p,c,radius,maxn)
    snap.WALK=walk
    rs=[snap.route(A,B,'pedestrian',APP,True) for A in pts]
    # średnie dojście z GPS do punktu startowego trasy
    offs=[]
    for A in pts:
        bp=snap.best_pair(A,B,'pedestrian',APP); offs.append(hav(A,bp[1]))
    print(f'radius {radius} maxn {maxn} walk {walk}: trasa {st.mean(rs):.0f} m, objazd>1.3x: {sum(1 for r,x in zip(rs,d) if r/x>1.3)}, dojście do drogi: średnio {st.mean(offs):.0f} m, max {max(offs):.0f} m')
