// Prowadzenie po trasie: pozycja na trasie, zjechanie z trasy, zapowiedzi skrętów.

import { project } from './geo.js';
import { distWords } from './speech-pl.js';

export class Guidance {
  constructor(route, opts = {}) {
    this.route = route;
    this.hint = 0;
    this.offCount = 0;
    this.announced = new Set();
    this.preFrom = new Map();
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
    let nextIdx = r.steps.findIndex((s, i) => i > 0 && s.at > along + 8 && !isSilent(s));
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
    const spoken = this._announce(nextIdx, next, distToNext, speed, along);

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

  /**
   * Dwie zapowiedzi na manewr (plus przypomnienie na długich odcinkach):
   *  1. zaraz po poprzednim manewrze: „Za dziewięćset metrów skręć w lewo w ulicę Krężnicką”,
   *  2. tuż przed manewrem: „Skręć w lewo”.
   * Dwa manewry blisko siebie łączymy w jedną wypowiedź.
   */
  _announce(idx, step, dist, speed, along = 0) {
    const out = [];
    const steps = this.route.steps;
    const isLast = step.type === 'arrive';
    const v = Math.max(speed, 4); // m/s; na postoju zakładamy ok. 14 km/h
    const remindDist = Math.min(1400, Math.max(350, v * 32));
    const nowDist = Math.min(130, Math.max(40, v * 4.5));
    const has = (n) => this.announced.has(`${idx}:${n}`);
    const mark = (...ns) => ns.forEach((n) => this.announced.add(`${idx}:${n}`));

    // kolejny prawdziwy manewr po tym (do łączenia zapowiedzi)
    let after = null;
    for (let j = idx + 1; j < steps.length; j++) { if (!isSilent(steps[j])) { after = steps[j]; break; } }
    const gap = after && after.type !== 'arrive' ? after.at - step.at : Infinity;
    const chain = (near) => (gap < (near ? 150 : 250) ? `${near ? ', a zaraz potem ' : ', a potem '}${lower(after.short || after.text)}` : '');

    if (dist <= nowDist && !has('now')) {
      mark('pre', 'rem', 'now');
      out.push(isLast ? 'Dojechałeś do celu' : `${step.short || step.text}${chain(true)}`);
      return out;
    }
    const prevAt = idx > 0 ? steps[idx - 1].at : 0;
    const passedPrev = idx <= 1 || along - prevAt >= 70; // nie nakładamy się na poprzedni komunikat
    const text = () => (isLast ? `Za ${distWords(dist)} cel podróży` : `Za ${distWords(dist)} ${lower(step.text)}${chain(false)}`);
    if (!has('pre') && passedPrev && dist > nowDist + 80) {
      mark('pre');
      this.preFrom.set(idx, dist);
      if (dist <= remindDist) mark('rem');
      out.push(text());
    } else if (has('pre') && !has('rem') && dist <= remindDist && dist > nowDist + 80 && (this.preFrom.get(idx) || 0) > remindDist * 1.5) {
      mark('rem');
      out.push(text());
    }
    return out;
  }

  reset(route) {
    this.route = route;
    this.hint = 0;
    this.offCount = 0;
    this.announced.clear();
    this.preFrom.clear();
    this.lastAlong = 0;
    this.arrived = false;
  }
}

function lower(t) {
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Kroki, o których nie mówimy (zmiana nazwy drogi, „jedź prosto”). */
export function isSilent(step) {
  if (!step) return true;
  if (step.type === 'arrive') return false;
  if (step.type === 'new name' || step.type === 'notification' || step.type === 'depart') return true;
  if (step.type === 'continue' && (!step.modifier || step.modifier === 'straight')) return true;
  if (step.type === 'turn' && (!step.modifier || step.modifier === 'straight')) return true;
  return false;
}
