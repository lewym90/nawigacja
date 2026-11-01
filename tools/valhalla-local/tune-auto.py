import json,sys
sys.argv=['x','none']
import audit
cases=json.load(open('cases_auto.json'))
OSRM=[(11588,1117),(8068,839),(10954,1044),(6297,968),(12895,1300),(4999,489),(10787,995),(3968,417),(6739,818),(10715,1021)]
sets={'domyślne':None,'dist .6':{'auto':{'use_distance':0.6}},'dist .8':{'auto':{'use_distance':0.8}},
'dist .6 hw0':{'auto':{'use_distance':0.6,'use_highways':0.0}},'dist .5 hw .2':{'auto':{'use_distance':0.5,'use_highways':0.2}}}
res={}
for k,o in sets.items():
    res[k]=[audit.get('auto',tuple(A),tuple(B),o)[0]['summary'] for (A,B,_,_) in cases]
print('OSRM km   ',[round(d/1000,1) for d,_ in OSRM])
for k,v in res.items():
    print(f"{k:14s}",[round(s['length'],1) for s in v], 'czas min',round(sum(s['time'] for s in v)/60))
