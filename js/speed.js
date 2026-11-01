// Prędkość z GPS: korzystamy z prędkości Dopplera (dokładniejsza niż różnica pozycji), wygładzamy skoki
// i zerujemy szum na postoju. Dla iPhone'a coords.speed jest zwykle bardzo dobre.

import { haversine } from './geo.js';

export class SpeedFilter {
  constructor() {
    this.v = 0; // m/s po filtrze
    this.prev = null;
    this.lastGood = 0;
  }

  /** fix: { lng, lat, speed (m/s lub null), accuracy (m), t (ms) } -> prędkość w m/s. */
  update(fix) {
    let raw = fix.speed != null && isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    const acc = fix.accuracy ?? 10;
    if (raw == null && this.prev) {
      // brak prędkości Dopplera: z różnicy pozycji, ale tylko gdy przesunięcie wyraźnie większe niż błąd
      const dt = (fix.t - this.prev.t) / 1000;
      const d = haversine([this.prev.lng, this.prev.lat], [fix.lng, fix.lat]);
      if (dt >= 0.5 && dt <= 5 && acc < 40 && d > acc * 0.5) raw = d / dt;
    }
    this.prev = { lng: fix.lng, lat: fix.lat, t: fix.t };
    if (raw == null || acc > 80) return this.v; // zły odczyt: trzymamy poprzednią wartość
    // wygładzanie: szybciej reagujemy na hamowanie niż na przyspieszanie (bezpieczniej nie zaniżać)
    const a = raw < this.v ? 0.65 : 0.5;
    this.v = this.v + (raw - this.v) * a;
    if (raw < 0.4 && this.v < 0.9) this.v = 0; // postój
    this.lastGood = this.v;
    return this.v;
  }

  reset() { this.v = 0; this.prev = null; }
}
