// Głos: przeglądarkowy syntezator mowy. Na iPhonie pierwsza wypowiedź musi
// pochodzić z dotknięcia ekranu, dlatego unlock() wołamy z przycisku „Start” lub „Symulacja”.

export class Voice {
  constructor({ maxUtteranceMs = 20000 } = {}) {
    this.enabled = true;
    this.ok = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.voice = null;
    this.queue = [];
    this.speaking = false;
    this.cur = null; // trzymamy odwołanie: Safari i Chrome potrafią „zgubić” wypowiedź, a z nią zdarzenie końca
    this.timer = null;
    this.maxUtteranceMs = maxUtteranceMs;
    this.lastError = null;
    this.onError = null;
    if (this.ok) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => /^pl/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pick);
    }
  }

  unlock() {
    if (!this.ok) return;
    const u = new SpeechSynthesisUtterance('.');
    u.volume = 0;
    this.cur = u;
    speechSynthesis.speak(u);
  }

  /** urgent: przerywa i czyści kolejkę (np. ostrzeżenie tuż przed fotoradarem). */
  say(text, { urgent = false } = {}) {
    if (!this.ok || !this.enabled || !text) return;
    if (urgent) {
      this.queue = [];
      try { speechSynthesis.cancel(); } catch { /* ignoruj */ }
      this._finish();
    }
    this.queue.push(text);
    // Nie gromadzimy zaległych komunikatów: przeterminowane zapowiedzi są gorsze niż cisza.
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    this._next();
  }

  _finish() {
    clearTimeout(this.timer);
    this.timer = null;
    this.speaking = false;
    this.cur = null;
  }

  _next() {
    if (this.speaking || !this.queue.length) return;
    const text = this.queue.shift();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.02;
    this.speaking = true;
    this.cur = u;
    const done = () => {
      if (this.cur !== u) return; // spóźnione zdarzenie po przerwaniu
      this._finish();
      this._next();
    };
    u.onend = done;
    u.onerror = (e) => {
      this.lastError = (e && e.error) || 'error';
      if (this.onError) this.onError(this.lastError);
      done();
    };
    // Zabezpieczenie: gdy przeglądarka nie zgłosi końca, kolejka nie może zostać zablokowana.
    this.timer = setTimeout(done, this.maxUtteranceMs);
    try {
      speechSynthesis.speak(u);
    } catch (err) {
      this.lastError = String(err);
      done();
    }
  }

  /** Krótki sygnał dźwiękowy (Web Audio). */
  beep(freq = 880, ms = 140) {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + ms / 1000);
    } catch { /* brak audio */ }
  }

  /** Diagnostyka dla użytkownika: co jest dostępne w tej przeglądarce. */
  info() {
    if (!this.ok) return { supported: false, voices: 0, pl: null };
    const vs = speechSynthesis.getVoices();
    return { supported: true, voices: vs.length, pl: this.voice ? this.voice.name : null };
  }

  test() {
    const was = this.enabled;
    this.enabled = true;
    this.beep(880, 160);
    this.say('Test głosu. Za trzysta metrów skręć w prawo.', { urgent: true });
    this.enabled = was;
    return this.info();
  }
}
