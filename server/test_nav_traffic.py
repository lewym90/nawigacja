import importlib.util, json, os, tempfile, unittest
spec = importlib.util.spec_from_file_location('nt', os.path.join(os.path.dirname(__file__), 'nav-traffic.py'))
nt = importlib.util.module_from_spec(spec); spec.loader.exec_module(nt)
SAMPLE = {'routes': [{'summary': {'lengthInMeters': 2000, 'travelTimeInSeconds': 400, 'noTrafficTravelTimeInSeconds': 180, 'historicTrafficTravelTimeInSeconds': 240, 'trafficDelayInSeconds': 220},
  'legs': [{'points': [{'latitude': 51.2, 'longitude': 22.5 + i * 0.002} for i in range(10)]}],
  'sections': [{'sectionType': 'TRAFFIC', 'startPointIndex': 2, 'endPointIndex': 5, 'simpleCategory': 'JAM', 'magnitudeOfDelay': 3, 'effectiveSpeedInKmh': 12, 'delayInSeconds': 200}, {'sectionType': 'CAR', 'startPointIndex': 0, 'endPointIndex': 9}]}]}
class T(unittest.TestCase):
    def test_parse(self):
        r = nt.parse(SAMPLE)
        self.assertEqual((r['time'], r['free'], r['delay']), (400, 180, 220))
        self.assertEqual(len(r['jams']), 1)
        j = r['jams'][0]
        self.assertEqual((j['kind'], j['mag'], j['kmh']), ('JAM', 3, 12))
        self.assertTrue(250 < j['from'] < 300 and 650 < j['to'] < 750, j)
    def test_thin_keeps_ends(self):
        p = [[i, i] for i in range(1000)]; t = nt.thin(p)
        self.assertEqual(len(t), 200); self.assertEqual(t[0], p[0]); self.assertEqual(t[-1], p[-1])
    def test_limit(self):
        with tempfile.TemporaryDirectory() as d:
            nt.STATE = d + '/u.json'; nt.MONTH_MAX = 2
            self.assertTrue(nt.usage('a')[0]); self.assertTrue(nt.usage('b')[0]); self.assertFalse(nt.usage('c')[0])
if __name__ == '__main__':
    unittest.main()
