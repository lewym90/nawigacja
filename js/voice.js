// Głos: przeglądarkowy syntezator mowy. Na iPhonie pierwsza wypowiedź musi
// pochodzić z dotknięcia ekranu, dlatego unlock() wołamy z przycisku „Start”.

export class Voice {
  constructor() {
    this.enabled = true;
    this.ok = typeof speechSynthesis !== 'undefined';
    this.voice = null;
    this.queue = [];
    this.speaking = false;
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
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  /** priority: wysoki priorytet przerywa i czyści kolejkę (np. ostrzeżenie tuż przed fotoradarem). */
  say(text, { urgent = false } = {}) {
    if (!this.ok || !this.enabled || !text) return;
    if (urgent) {
      this.queue = [];
      try { speechSynthesis.cancel(); } catch { /* ignoruj */ }
      this.speaking = false;
    }
    this.queue.push(text);
    // Nie gromadzimy zaległych komunikatów: przeterminowane zapowiedzi są gorsze niż cisza.
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    this._next();
  }

  _next() {
    if (this.speaking || !this.queue.length) return;
    const text = this.queue.shift();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.02;
    this.speaking = true;
    const done = () => {
      this.speaking = false;
      this._next();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  /** Krótki sygnał dźwiękowy (Web Audio), gdy głos jest wyłączony lub jako dodatek. */
  beep(freq = 880, ms = 140) {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + ms / 1000);
    } catch { /* brak audio */ }
  }
}
