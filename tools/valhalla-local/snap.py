import json, math
from r import a
from an import hav

WALK = 1.3  # m/s dojście do punktu na drodze
def candidates(p, costing, radius=30, maxn=4):
    loc=json.loads(a.locate(json.dumps({'locations':[{'lat':p[0],'lon':p[1],'radius':radius}],'costing':costing,'verbose':True})))
    best={}
    for e in loc[0].get('edges',[]):
        w=e['edge_info'].get('way_id'); pt=(e['correlated_lat'],e['correlated_lon'])
        d=hav(p,pt)
        if w not in best or d<best[w][0]: best[w]=(d,pt)
    c=sorted(best.values())[:maxn]
    return c or [(0.0,p)]
def best_pair(A,B,costing,opts=None):
    ca=candidates(A,costing); cb=candidates(B,costing)
    body={'sources':[{'lat':x[1][0],'lon':x[1][1]} for x in ca],'targets':[{'lat':x[1][0],'lon':x[1][1]} for x in cb],'costing':costing}
    if opts: body['costing_options']=opts
    m=json.loads(a.matrix(json.dumps(body)))['sources_to_targets']
    best=None
    for i,row in enumerate(m):
        for j,cell in enumerate(row):
            if cell.get('time') is None: continue
            total=cell['time']+(ca[i][0]+cb[j][0])/WALK
            if best is None or total<best[0]: best=(total,ca[i][1],cb[j][1])
    return best
def route(A,B,costing,opts=None,snap=True):
    if snap:
        bp=best_pair(A,B,costing,opts)
        if bp: A2,B2=bp[1],bp[2]
        else: A2,B2=A,B
    else: A2,B2=A,B
    body={'locations':[{'lat':A2[0],'lon':A2[1]},{'lat':B2[0],'lon':B2[1]}],'costing':costing,'directions_options':{'language':'pl-PL'}}
    if opts: body['costing_options']=opts
    t=json.loads(a.route(json.dumps(body)))['trip']
    return t['summary']['length']*1000
