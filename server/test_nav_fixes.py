"""Testy usługi nav-fixes. Uruchom: python3 -m unittest server/test_nav_fixes.py"""
import importlib.util, json, os, sys, tempfile, threading, time, unittest, urllib.request, urllib.error

here = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
os.environ['NAV_FIXES_DB'] = os.path.join(tmp, 'f.db')
os.environ['NAV_FIXES_TOKEN'] = 'sekret'
spec = importlib.util.spec_from_file_location('navfixes', os.path.join(here, 'nav-fixes.py'))
nf = importlib.util.module_from_spec(spec); spec.loader.exec_module(nf)

LAT, LNG = 51.2465, 22.5684

def rep(**k):
    d = {'kind': 'avoid', 'mode': 'auto', 'lat': LAT, 'lng': LNG, 'client': 'aaaaaaaa1111'}
    d.update(k); return d

class Logic(unittest.TestCase):
    def setUp(self):
        self.c = nf.db(); self.c.execute('DELETE FROM fixes'); self.c.commit()
    def tearDown(self): self.c.close()

    def test_walidacja(self):
        self.assertIsNone(nf.valid_report(rep())[1])
        for bad in (rep(kind='x'), rep(mode='czolg'), rep(lat=10), rep(lng=100), rep(client='a'), rep(client='zły klient!!!'), rep(lat='abc'), 5, rep(lat=float('nan'))):
            self.assertIsNotNone(nf.valid_report(bad)[1], bad)
        self.assertEqual(len(nf.valid_report(rep(note='x' * 500))[0]['note']), 140)

    def test_dodawanie_i_odswiezanie_wlasnego(self):
        a, _ = nf.add_fix(self.c, nf.valid_report(rep())[0], '1.1.1.1', now=1000)
        b, _ = nf.add_fix(self.c, nf.valid_report(rep(lat=LAT + 0.0001))[0], '1.1.1.1', now=2000)  # ~11 m: to samo
        self.assertEqual(a, b)
        c, _ = nf.add_fix(self.c, nf.valid_report(rep(lat=LAT + 0.001))[0], '1.1.1.1', now=2000)   # ~110 m: nowe
        self.assertNotEqual(a, c)
        self.assertEqual(self.c.execute('SELECT COUNT(*) FROM fixes').fetchone()[0], 2)

    def test_skupiska_licza_roznych_kierowcow(self):
        now = int(time.time())
        nf.add_fix(self.c, nf.valid_report(rep(client='klient-aaaa1'))[0], '1.1.1.1', now)
        nf.add_fix(self.c, nf.valid_report(rep(client='klient-bbbb2', lat=LAT + 0.0001))[0], '2.2.2.2', now)
        nf.add_fix(self.c, nf.valid_report(rep(client='klient-bbbb2', lat=LAT + 0.0001))[0], '2.2.2.2', now)  # ten sam kierowca: bez zwiększenia n
        nf.add_fix(self.c, nf.valid_report(rep(kind='ok', client='klient-cccc3'))[0], '3.3.3.3', now)       # inny rodzaj: osobne skupisko
        out = nf.list_fixes(self.c, [LNG - 0.01, LAT - 0.01, LNG + 0.01, LAT + 0.01], now=now)
        by = {o['kind']: o for o in out}
        self.assertEqual(len(out), 2)
        self.assertEqual(by['avoid']['n'], 2); self.assertEqual(by['ok']['n'], 1)
        self.assertEqual(nf.list_fixes(self.c, [LNG + 1, LAT + 1, LNG + 1.1, LAT + 1.1], now=now), [])
        self.assertEqual(len(nf.list_fixes(self.c, [LNG - 0.01, LAT - 0.01, LNG + 0.01, LAT + 0.01], mode='bicycle', now=now)), 0)

    def test_wygasanie(self):
        now = int(time.time())
        nf.add_fix(self.c, nf.valid_report(rep())[0], '1.1.1.1', now - 200 * 86400)
        self.assertEqual(nf.list_fixes(self.c, [LNG - 0.01, LAT - 0.01, LNG + 0.01, LAT + 0.01], now=now), [])

    def test_limity(self):
        now = int(time.time())
        for i in range(nf.PER_CLIENT_DAY):
            self.assertIsNone(nf.add_fix(self.c, nf.valid_report(rep(lat=LAT + i * 0.001))[0], '9.9.9.9', now)[1])
        self.assertIsNotNone(nf.add_fix(self.c, nf.valid_report(rep(lat=LAT + 0.5))[0], '9.9.9.9', now)[1])

    def test_usuwanie_tylko_wlasnych(self):
        fid, _ = nf.add_fix(self.c, nf.valid_report(rep())[0], '1.1.1.1', 1000)
        self.assertFalse(nf.delete_fix(self.c, fid, 'obcy-klient-1'))
        self.assertTrue(nf.delete_fix(self.c, fid, 'aaaaaaaa1111'))

class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = nf.ThreadingHTTPServer(('127.0.0.1', 0), nf.H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def call(self, method, path, body=None):
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', method=method,
                                     data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

    def test_pelny_obieg(self):
        code, out = self.call('POST', '/fixes', rep(client='http-klient-1', lat=LAT + 0.02))
        self.assertEqual(code, 200); fid = out['id']
        code, out = self.call('GET', f'/fixes?bbox={LNG-0.1},{LAT-0.1},{LNG+0.1},{LAT+0.1}')
        self.assertEqual(code, 200); self.assertTrue(any(o['id'] == fid for o in out))
        self.assertEqual(self.call('DELETE', f'/fixes/{fid}?client=obcy-klient-9')[0], 404)
        self.assertEqual(self.call('DELETE', f'/fixes/{fid}?client=http-klient-1')[1], {'ok': True})
        self.assertEqual(self.call('POST', '/fixes', rep(kind='zly'))[0], 400)
        self.assertEqual(self.call('GET', '/fixes?bbox=1,2,3')[0], 400)
        self.assertEqual(self.call('GET', '/fixes?bbox=10,40,20,50')[0], 400)   # za duża obwiednia
        self.assertEqual(self.call('GET', '/fixes/health')[1], {'ok': True})

    def test_eksport_chroniony_tokenem(self):
        self.assertEqual(self.call('GET', '/fixes/export')[0], 403)
        self.assertEqual(self.call('GET', '/fixes/export?token=zly')[0], 403)
        code, out = self.call('GET', '/fixes/export?token=sekret')
        self.assertEqual(code, 200); self.assertIsInstance(out, list)

if __name__ == '__main__':
    unittest.main()
