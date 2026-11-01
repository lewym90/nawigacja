// Prowadzenie po trasie: pozycja na trasie, zjechanie z trasy, zapowiedzi skrętów.

import { project } from './geo.js';
import { fmtDist } from './routing.js';

export class Guidance {
  constructor(route, opts = {}) {
    this.route = route;
    this.hint = 0;
    this.offCount = 0;
    this.announced = new Set();
    this.maxOffM = opts.maxOffM ?? 35;
    this.offFixes = opts.offFixes ?? 3;
    this.lastAlong = 0;
    this.arrived = false;
  }

  /**
   * Jeden odczyt GPS: { lng, lat, speed (m/s), accuracy (m), t (ms) }.
   * Zwraca stan prowadzenia oraz listę zapowiedzi do wypowiedzenia.
   */
  update(fix) {
    const r = this.route;
    const p = project(r.line, [fix.lng, fix.lat], this.hint);
    this.hint = p.idx;

    // Odczyt z fatalną dokładnością nie może wywołać fałszywego „zjechałeś z trasy”.
    const acc = fix.accuracy ?? 10;
    const tol = Math.max(this.maxOffM, acc * 1.5);
    if (p.dist > tol) this.offCount++;
    else this.offCount = 0;
    const offRoute = this.offCount >= this.offFixes && acc < 80;

    // Nie cofamy się o więcej niż drobny dryf GPS.
    const along = p.dist <= tol ? Math.max(p.along, this.lastAlong - 15) : this.lastAlong;
    if (p.dist <= tol) this.lastAlong = along;

    const remaining = Math.max(0, r.distance - along);
    this.arrived = remaining < 25;

    // Następny manewr: pierwszy krok, którego miejsce jest przed nami.
    let nextIdx = r.steps.findIndex((s, i) => i > 0 && s.at > along + 8);
    if (nextIdx === -1) nextIdx = r.steps.length - 1;
    const next = r.steps[nextIdx];
    const distToNext = Math.max(0, next.at - along);

    // Pozostały czas: proporcjonalnie do długości kroków.
    let remTime = 0;
    for (const s of r.steps) {
      const end = s.at + s.distance;
      if (end <= along) continue;
      const frac = s.distance > 0 ? Math.min(1, (end - Math.max(along, s.at)) / s.distance) : 1;
      remTime += s.duration * frac;
    }

    const speed = Math.max(0, fix.speed ?? 0);
    const spoken = this._announce(nextIdx, next, distToNext, speed);

    return {
      along,
      offDist: p.dist,
      offRoute,
      arrived: this.arrived,
      point: p.point,
      nextIdx,
      next,
      distToNext,
      remaining,
      remTime,
      spoken,
    };
  }

  // Progi zapowiedzi zależą od prędkości (więcej czasu na autostradzie).
  _announce(idx, step, dist, speed) {
    const out = [];
    const isLast = step.type === 'arrive';
    const kmh = speed * 3.6;
    const far = kmh > 90 ? 1500 : kmh > 60 ? 800 : 0;
    const marks = [];
    if (far) marks.push(['far', far]);
    marks.push(['mid', kmh > 60 ? 400 : 300], ['near', 120], ['now', 35]);
    for (const [name, d] of marks) {
      const key = `${idx}:${name}`;
      if (dist <= d && !this.announced.has(key)) {
        // Oznacz jako wypowiedziane również wcześniejsze progi, żeby nie mówić trzech naraz.
        for (const [n2, d2] of marks) if (d2 >= d) this.announced.add(`${idx}:${n2}`);
        if (name === 'now') {
          out.push(isLast ? 'Dojechałeś do celu' : step.text);
        } else if (isLast) {
          out.push(`Za ${fmtDist(dist)} cel podróży`);
        } else {
          out.push(`Za ${fmtDist(dist)} ${lower(step.text)}`);
        }
        break;
      }
    }
    return out;
  }

  reset(route) {
    this.route = route;
    this.hint = 0;
    this.offCount = 0;
    this.announced.clear();
    this.lastAlong = 0;
    this.arrived = false;
  }
}

function lower(t) {
  return t.charAt(0).toLowerCase() + t.slice(1);
}
