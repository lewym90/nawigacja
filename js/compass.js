// Kompas telefonu: kierunek, w którym patrzysz, gdy stoisz lub idziesz wolno (GPS wtedy nie zna kierunku).
// iPhone wymaga zgody, o którą wolno prosić tylko po dotknięciu przez użytkownika (przycisk Start).

export class Compass {
  constructor() {
    this.heading = null; // stopnie 0..360 względem północy, null = brak
    this.t = 0;
    this._on = null;
    this.active = false;
  }

  /** Wołać z obsługi dotknięcia. Zwraca true, gdy kompas działa. */
  async start(win = globalThis) {
    if (this.active) return true;
    const DOE = win.DeviceOrientationEvent;
    if (!DOE) return false;
    try {
      if (typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch { return false; }
    this._on = (e) => this.feed(e);
    // Android podaje absolutny kierunek w „deviceorientationabsolute”, iOS w webkitCompassHeading.
    win.addEventListener('deviceorientationabsolute', this._on, true);
    win.addEventListener('deviceorientation', this._on, true);
    this._win = win;
    this.active = true;
    return true;
  }

  stop() {
    if (!this.active) return;
    this._win.removeEventListener('deviceorientationabsolute', this._on, true);
    this._win.removeEventListener('deviceorientation', this._on, true);
    this.active = false;
    this.heading = null;
  }

  /** Zdarzenie orientacji -> kierunek. Wygładzamy drobne drgania. */
  feed(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h == null) return;
    if (this.heading == null) this.heading = h;
    else {
      const d = ((h - this.heading + 540) % 360) - 180;
      this.heading = (this.heading + d * 0.25 + 360) % 360;
    }
    this.t = Date.now();
  }

  /** Aktualny kierunek lub null, gdy odczyt jest nieświeży. */
  get() {
    return this.heading != null && Date.now() - this.t < 2000 ? this.heading : null;
  }
}
