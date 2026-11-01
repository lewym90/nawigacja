// Symulator jazdy po wyznaczonej trasie. Pozwala przetestować prowadzenie, ostrzeżenia
// i odcinkowy pomiar w domu, bez GPS. Samochód rusza z zera, przyspiesza do prędkości jazdy
// (domyślnie limit na drodze), przed skrętami i rondami zwalnia, a przed celem staje.
// Czas może płynąć szybciej (speedup).

import { pointAt } from './geo.js';
import { limitAt } from './routing.js';
import { isSilent } from './guidance.js';

const ACCEL = 1.8; // m/s², łagodne ruszanie osobówką
const BRAKE = 2.0; // m/s², maksymalne hamowanie
const PLAN = 1.5; // m/s², z takim zapasem planujemy hamowanie przed manewrem

/** Prędkość (m/s), z jaką pokonuje się dany manewr. */
export function maneuverSpeed(step) {
  if (!step) return 14;
  if (step.type === 'arrive') return 0;
  const mod = step.modifier || '';
  if (step.type === 'roundabout' || step.type === 'rotary' || step.type === 'roundabout turn') return 22 / 3.6;
  if (/uturn/.test(mod)) return 10 / 3.6;
  if (/sharp/.test(mod)) return 15 / 3.6;
  if (/slight/.test(mod)) return 45 / 3.6;
  if (/ramp|merge|fork/.test(step.type || '')) return 55 / 3.6;
  return 24 / 3.6;
}

export class Simulator {
  constructor(route, { speedKmh = null, speedup = 1, onFix, tickMs = 1000 } = {}) {
    this.route = route;
    this.fixed = speedKmh != null ? speedKmh / 3.6 : null; // null = jedzie zgodnie z limitem
    this.v = 0;
    this.speedup = speedup;
    this.onFix = onFix;
    this.tickMs = tickMs;
    this.along = 0;
    this.t = Date.now();
    this.timer = null;
  }

  /** Prędkość docelowa na tym odcinku (m/s), jeszcze bez hamowania przed manewrami. */
  get target() {
    if (this.fixed != null) return this.fixed;
    const lim = limitAt(this.route, this.along);
    return (lim || 50) / 3.6;
  }

  setSpeed(kmh) { this.fixed = kmh / 3.6; }

  /** Największa prędkość, z jaką można jeszcze zdążyć wyhamować przed najbliższymi manewrami. */
  _brakingCap() {
    let cap = Infinity;
    for (const s of this.route.steps || []) {
      if (s.at <= this.along - 1 || s.type === 'depart') continue;
      if (isSilent(s) && s.type !== 'arrive') continue;
      const d = Math.max(0, s.at - this.along);
      if (d > 600) break;
      const vt = maneuverSpeed(s);
      cap = Math.min(cap, Math.sqrt(vt * vt + 2 * PLAN * d));
    }
    return cap;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.step(), this.tickMs / this.speedup);
    this.step();
  }

  step() {
    const dt = this.tickMs / 1000;
    const want = Math.min(this.target, this._brakingCap());
    if (this.v < want) this.v = Math.min(want, this.v + ACCEL * dt);
    else this.v = Math.max(want, this.v - BRAKE * dt);
    const left = this.route.line.total - this.along;
    const arriving = left <= this.v * dt + 0.5;
    this.along = Math.min(this.route.line.total, this.along + this.v * dt);
    if (arriving) this.v = 0; // dojechał: staje
    this.t += this.tickMs;
    const p = pointAt(this.route.line, this.along);
    this.onFix({ lng: p.point[0], lat: p.point[1], speed: this.v, accuracy: 5, heading: p.bearing, t: this.t, sim: true });
    if (left <= 1 || this.along >= this.route.line.total - 0.5) this.stop();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
