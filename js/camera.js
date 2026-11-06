// Kamera pościgowa: płynny ruch między odczytami GPS.
// GPS daje punkt raz na sekundę, a ekran chce 30 klatek na sekundę. Dlatego kamera nie „goni” każdego odczytu,
// tylko sama jedzie wzdłuż trasy z bieżącą prędkością i łagodnie koryguje błąd. Kierunek bierze z geometrii trasy,
// nie z zaszumionego kursu GPS, a zoom i pochylenie zmienia bez skoków. Bez przechyłu: to samochód, nie helikopter.

import { pointAt, bearing } from './geo.js';

const M_PER_DEG = 111195;
const wrap = (d) => ((d + 540) % 360) - 180;
const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

export const CAM = {
  speedTau: 1.6,   // s: wygładzanie prędkości
  alongTau: 0.9,   // s: korekta błędu pozycji wzdłuż trasy
  centerTau: 0.22, // s: ostatni filtr środka kadru
  bearingTau: 0.8, // s: wygładzanie kierunku
  maxTurn: 38,     // °/s: najszybszy obrót kadru
  zoomTau: 2.2,    // s
  pitchTau: 1.2,   // s
  snapM: 150,      // m: większy skok (przeliczenie trasy, przeskok) = bez animacji
};

/** Kierunek kadru: odcinek trasy przed autem. Im szybciej, tym dalej patrzy, więc krótkie załamania trasy nie ruszają kamerą. */
export function pathBearing(line, along, kmh) {
  const ahead = Math.max(30, Math.min(110, (kmh / 3.6) * 3.2));
  const a = pointAt(line, Math.max(0, along - 6)).point;
  const b = pointAt(line, Math.min(line.total, along + ahead)).point;
  if (a[0] === b[0] && a[1] === b[1]) return null;
  return bearing(a, b);
}

export class ChaseCam {
  constructor() { this.t = null; }

  /** Ustaw stan bez animacji (start nawigacji albo koniec ruchu kamery wykonanego przez mapę). */
  place({ center, bearing: b, zoom, pitch }) {
    this.center = [...center];
    this.bearing = b;
    this.zoom = zoom;
    this.pitch = pitch;
    if (this.v == null) this.v = 0;
  }

  /** Nowy odczyt GPS. `age` = o ile sekund ten odczyt jest starszy niż chwila wywołania. */
  fix({ along, line, onRoute, lng, lat, speed, heading, zoom, pitch }) {
    this.t = { along, line, onRoute, lng, lat, speed: speed || 0, heading, zoom, pitch, age: 0 };
    if (this.s == null || !onRoute || Math.abs(along - this.s) > CAM.snapM) { this.s = along; this.jump = true; }
    if (this.line !== line) { this.line = line; this.s = along; }
  }

  /** Jedna klatka: dt w sekundach. Zwraca pozę kamery i kierunek pojazdu. */
  tick(dt) {
    const T = this.t;
    if (!T || !this.center) return null;
    dt = Math.min(dt, 0.25);
    T.age += dt;
    this.v += (T.speed - this.v) * ease(dt, CAM.speedTau);
    const kmh = this.v * 3.6;
    let want; let carHd = this.bearing;
    let tb = null;
    if (T.onRoute && T.line) {
      this.s += this.v * dt;
      const target = T.along + T.speed * T.age;
      this.s += (target - this.s) * ease(dt, CAM.alongTau);
      this.s = Math.max(0, Math.min(T.line.total, this.s));
      const p = pointAt(T.line, this.s);
      want = p.point;
      carHd = p.bearing;
      tb = pathBearing(T.line, this.s, kmh);
    } else {
      const hd = (T.heading != null && T.speed > 1.5) ? T.heading : this.bearing;
      const r = T.speed * T.age;
      want = [T.lng + (r * Math.sin(hd * Math.PI / 180)) / (M_PER_DEG * Math.cos(T.lat * Math.PI / 180)), T.lat + (r * Math.cos(hd * Math.PI / 180)) / M_PER_DEG];
      carHd = hd;
      tb = hd;
    }
    if (this.jump) { this.center = [...want]; this.jump = false; }
    const k = ease(dt, CAM.centerTau);
    this.center[0] += (want[0] - this.center[0]) * k;
    this.center[1] += (want[1] - this.center[1]) * k;
    this.lag = Math.hypot((want[0] - this.center[0]) * M_PER_DEG * Math.cos(want[1] * Math.PI / 180), (want[1] - this.center[1]) * M_PER_DEG); // o tyle ekranowe auto jest za punktem trasy
    if (tb != null && (this.v > 0.8 || !T.onRoute)) {
      const step = wrap(tb - this.bearing) * ease(dt, this.bearingTau || CAM.bearingTau);
      const lim = CAM.maxTurn * dt;
      this.bearing = (this.bearing + Math.max(-lim, Math.min(lim, step)) + 360) % 360;
    }
    this.zoom += (T.zoom - this.zoom) * ease(dt, CAM.zoomTau);
    this.pitch += (T.pitch - this.pitch) * ease(dt, CAM.pitchTau);
    return { center: this.center, bearing: this.bearing, zoom: this.zoom, pitch: this.pitch, carOffset: wrap(carHd - this.bearing) };
  }
}
