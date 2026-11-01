// Głos: przeglądarkowy syntezator mowy. Na iPhonie pierwsza wypowiedź musi
// pochodzić z dotknięcia ekranu, dlatego unlock() wołamy z przycisku „Start” lub „Symulacja”.

/** Ton jako plik WAV w adresie data: (element <audio> gra na iOS mimo wyciszenia przełącznikiem). */
export function toneWavUri(freq = 880, ms = 160, rate = 22050, amp = 0.6) {
  const n = Math.floor((rate * ms) / 1000);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400); // łagodny początek i koniec bez trzasku
    dv.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * amp * env * 32767), true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

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
        this.voice = vs.find((v) => /^pl/i.test(v.lang)) || vs.find((v) => v.default) || vs[0] || null;
      };
      pick();
      speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pick);
    }
  }

  unlock() {
    try { const a = new Audio(toneWavUri(440, 30)); a.volume = 0.01; a.play().catch(() => {}); } catch { /* ignoruj */ }
    this.hold(true);
    if (!this.ok) return;
    // Pierwsza wypowiedź musi paść z dotknięcia: krótka, ale prawdziwa (cicha potrafiła zawisnąć i zablokować kolejkę).
    try {
      const u = new SpeechSynthesisUtterance('Nawigacja gotowa');
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'pl-PL';
      speechSynthesis.speak(u);
    } catch { /* ignoruj */ }
  }

  /** Pętla prawie niesłyszalnego dźwięku: utrzymuje sesję audio „odtwarzanie”, dzięki czemu mowa jest słyszalna mimo wyciszenia przełącznikiem. */
  hold(on) {
    try {
      if (on) {
        if (!this.keep) { this.keep = new Audio(toneWavUri(40, 1000, 8000, 0.004)); this.keep.loop = true; }
        const p = this.keep.play();
        if (p && p.catch) p.catch(() => {});
      } else if (this.keep) {
        this.keep.pause();
      }
    } catch { /* brak audio */ }
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
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'pl-PL';
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
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(u);
    } catch (err) {
      this.lastError = String(err);
      done();
    }
  }

  /** Krótki sygnał dźwiękowy przez element <audio> (kanał multimediów). */
  beep(freq = 880, ms = 140) {
    try {
      this.tones = this.tones || new Map();
      const key = `${freq}:${ms}`;
      if (!this.tones.has(key)) this.tones.set(key, toneWavUri(freq, ms));
      const a = new Audio(this.tones.get(key));
      a.volume = 1;
      const p = a.play();
      if (p && p.catch) p.catch((e) => { this.lastError = (e && e.name) || 'audio'; if (this.onError) this.onError(this.lastError); });
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
