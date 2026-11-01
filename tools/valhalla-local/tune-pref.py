import json,sys
sys.argv=['x','none']
import audit
cases=json.load(open('cases_auto.json'))
L={'Lublin-Warszawa':((51.2465,22.5684),(52.2297,21.0122)),'Lublin-Rzeszow':((51.2465,22.5684),(50.0412,22.0047)),'Lublin-Krakow':((51.2465,22.5684),(50.0647,19.9450))}
sets={'najszybsza (0)':{'auto':{'use_distance':0.0}},'zrównoważona (0.6)':{'auto':{'use_distance':0.6}},'najkrótsza (1.0)':{'auto':{'use_distance':1.0}},'shortest':{'auto':{'shortest':True}}}
for k,o in sets.items():
    v=[audit.get('auto',tuple(A),tuple(B),o)[0]['summary'] for (A,B,_,_) in cases]
    print(f"{k:20s} miasto 10 tras: {sum(s['length'] for s in v):5.1f} km, {sum(s['time'] for s in v)/60:4.0f} min")
    for n,(A,B) in L.items():
        s=audit.get('auto',A,B,o)[0]['summary']; print(f"   {n:16s}{s['length']:6.1f} km {s['time']/60:5.0f} min")
