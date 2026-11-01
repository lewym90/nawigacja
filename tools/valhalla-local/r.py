import json, sys
from valhalla import Actor, get_config
a = Actor('/tmp/vh/local.json')
def route(body):
    return json.loads(a.route(json.dumps(body)))
if __name__ == '__main__':
    r = route({'locations':[{'lat':51.19897,'lon':22.55267},{'lat':51.19835,'lon':22.54430}],'costing':'pedestrian','directions_options':{'language':'pl-PL'}})
    print(r['trip']['summary'])
