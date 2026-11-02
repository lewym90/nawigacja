import json,sys,urllib.parse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
sys.argv=['x','none']
import audit
a=audit.a
import threading
LOCK=threading.Lock()
class H(BaseHTTPRequestHandler):
    def log_message(self,*x): pass
    def _send(self,code,body):
        b=body.encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b)
    def _do(self,path,js):
        try:
            act=path.strip('/').split('/')[-1]; act={'sources_to_targets':'matrix'}.get(act,act)
            with LOCK:
                out=getattr(a,act)(js)
            self._send(200,out)
        except Exception as e:
            self._send(400,json.dumps({'error':str(e)}))
    def do_GET(self):
        u=urllib.parse.urlparse(self.path); q=urllib.parse.parse_qs(u.query)
        self._do(u.path,q['json'][0])
    def do_POST(self):
        n=int(self.headers.get('Content-Length',0)); self._do(self.path,self.rfile.read(n).decode())
    def do_OPTIONS(self): self._send(204,'')
ThreadingHTTPServer(('127.0.0.1',8765),H).serve_forever()
