import { destination, buildLine } from '../js/geo.js';
import { parseRoute } from '../js/routing.js';

/** Trasa testowa: 6 km na północ, skręt w prawo, 4 km na wschód. Odpowiedź w formacie OSRM. */
export function fakeOsrmRoute() {
  const start = [22.55, 51.2];
  const pts = [start];
  for (let i = 1; i <= 60; i++) pts.push(destination(start, 0, i * 100));
  const corner = pts[pts.length - 1];
  for (let i = 1; i <= 40; i++) pts.push(destination(corner, 90, i * 100));
  const line = buildLine(pts);
  return {
    code: 'Ok',
    routes: [
      {
        distance: line.total,
        duration: line.total / 16,
        geometry: { type: 'LineString', coordinates: pts },
        legs: [
          {
            summary: 'ul. Testowa',
            steps: [
              { name: 'ul. Testowa', distance: 6000, duration: 375, maneuver: { type: 'depart', location: pts[0] } },
              { name: 'Al. Próbna', distance: line.total - 6000, duration: 250, maneuver: { type: 'turn', modifier: 'right', location: corner } },
              { name: '', distance: 0, duration: 0, maneuver: { type: 'arrive', location: pts[pts.length - 1] } },
            ],
          },
        ],
      },
    ],
  };
}

export function fakeRoute() {
  return parseRoute(fakeOsrmRoute().routes[0]);
}
