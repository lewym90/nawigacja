// Symulator jazdy po wyznaczonej trasie. Pozwala przetestować prowadzenie, ostrzeżenia
// i odcinkowy pomiar w domu, bez GPS. Czas może płynąć szybciej (speedup).

import { pointAt } from './geo.js';

export class Simulator {
  constructor(route, { speedKmh = 50, speedup = 1, onFix, tickMs = 1000 } = {}) {
    this.route = route;
    this.v = speedKmh / 3.6;
    this.speedup = speedup;
    this.onFix = onFix;
    this.tickMs = tickMs;
    this.along = 0;
    this.t = Date.now();
    this.timer = null;
  }
  setSpeed(kmh) { this.v = kmh / 3.6; }
  start() {
    this.stop();
    this.timer = setInterval(() => this.step(), this.tickMs / this.speedup);
    this.step();
  }
  step() {
    const dt = this.tickMs / 1000;
    this.along = Math.min(this.route.line.total, this.along + this.v * dt);
    this.t += this.tickMs;
    const p = pointAt(this.route.line, this.along);
    this.onFix({ lng: p.point[0], lat: p.point[1], speed: this.v, accuracy: 5, heading: p.bearing, t: this.t, sim: true });
    if (this.along >= this.route.line.total) this.stop();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
