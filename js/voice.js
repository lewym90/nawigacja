import { forSpeech } from './speech-pl.js';

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

export function voiceQuality(v) {
  const n = v.name || '';
  if (/premium|siri|natural|neural/i.test(n)) return 3;
  if (/enhanced|rozszerz|google|online|microsoft/i.test(n)) return 2;
  return 1;
}
export function qualityLabel(v) { const q = voiceQuality(v); return q >= 3 ? 'Premium' : q === 2 ? 'Rozszerzony' : 'Podstawowy'; }

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
    this.engine = 'robot'; // 'robot' = wbudowany syntezator (gra jak zwykły dźwięk), 'system' = głos telefonu
    this.player = null;
    this.cache = new Map();
    this.cloudCache = new Map();
    this.cloudUrl = '';
    this.robot = null;
    this.events = [];
    this.prefName = '';
    if (this.ok) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        const pl = vs.filter((v) => /^pl/i.test(v.lang));
        const pref = this.prefName && pl.find((v) => v.voiceURI === this.prefName || v.name === this.prefName);
        this.voice = pref || pl.slice().sort((a, b) => voiceQuality(b) - voiceQuality(a))[0] || vs.find((v) => v.default) || vs[0] || null;
      };
      pick();
      speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pick);
    }
  }

  log(msg) {
    this.events.push(`${new Date().toTimeString().slice(3, 8)}:${String(Date.now() % 60000).padStart(5, '0').slice(0, 2)} ${msg}`);
    if (this.events.length > 30) this.events.shift();
  }

  polishVoices() {
    try { return speechSynthesis.getVoices().filter((v) => /^pl/i.test(v.lang)); } catch { return []; }
  }

  /** Następny polski głos z listy (przycisk w menu). */
  cycleVoice() {
    const pl = this.polishVoices();
    if (!pl.length) return null;
    const i = pl.findIndex((v) => v === this.voice);
    this.voice = pl[(i + 1) % pl.length];
    this.prefName = this.voice.voiceURI || this.voice.name;
    return this.voice;
  }

  unlock() {
    // Silnik systemowy: nic poza samą mową. Dźwięk <audio> tuż przed nią wyciszał ją na iPhonie.
    if (this.engine !== 'robot' && this.engine !== 'cloud') return;
    if (!this.player) this.player = new Audio();
    try { this.player.src = toneWavUri(440, 30); this.player.volume = 0.01; this.player.play().catch(() => {}); } catch { /* ignoruj */ }
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

  /**
   * prio: 4 = ostrzeżenie tuż przed zagrożeniem (przerywa), 3 = komenda skrętu „teraz” (przerywa tylko mniej ważne),
   * 2 = ostrzeżenia, 1 = zapowiedzi, 0 = informacje. Zaległe komunikaty tracą ważność po ttl ms:
   * przeterminowana zapowiedź jest gorsza niż cisza.
   */
  say(text, { urgent = false, prio = urgent ? 4 : 1, ttl = 9000 } = {}) {
    this.log(`say p${prio}: ${String(text).slice(0, 40)}`);
    if (!this.enabled || !text) return;
    if (this.engine !== 'robot' && this.engine !== 'cloud' && !this.ok) return;
    const item = { text: String(text), prio, t: Date.now(), ttl };
    if (this.queue.some((q) => q.text === item.text)) return; // bez dubli w kolejce
    const curPrio = this.speaking && this.curItem ? this.curItem.prio : -1;
    if (prio >= 3 && prio > curPrio && this.speaking) {
      // ważniejszy komunikat przerywa mniej ważny
      this.queue = this.queue.filter((q) => q.prio >= prio);
      this.gen = (this.gen || 0) + 1;
      try { if (this.player) this.player.pause(); } catch { /* ignoruj */ }
      try { if (this.ok) speechSynthesis.cancel(); } catch { /* ignoruj */ }
      this._finish();
    }
    this.queue.push(item);
    this.queue.sort((x, y) => y.prio - x.prio || x.t - y.t);
    if (this.queue.length > 3) this.queue.length = 3;
    this._next();
  }

  _finish() {
    clearTimeout(this.timer);
    this.timer = null;
    this.speaking = false;
    this.cur = null;
    this.curItem = null;
  }

  _next() {
    if (this.speaking) return;
    const now = Date.now();
    this.queue = this.queue.filter((q) => now - q.t <= q.ttl);
    if (!this.queue.length) return;
    const item = this.queue.shift();
    this.curItem = item;
    const text = forSpeech(item.text);
    if (this.engine === 'robot') { this._robot(text); return; }
    if (this.engine === 'cloud' && this.cloudUrl && Date.now() > (this.cloudBlockedUntil || 0)) { this._cloud(text); return; }
    this._system(text);
  }

  _system(text) {
    if (!this.ok) { this._finish(); this._next(); return; }
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
    let started = false;
    u.onstart = () => { started = true; this.log('start'); };
    u.onend = () => { this.log('end'); done(); };
    u.onerror = (e) => {
      this.lastError = (e && e.error) || 'error';
      this.log(`błąd: ${this.lastError}`);
      if (this.onError) this.onError(this.lastError);
      done();
    };
    // Zabezpieczenie: gdy przeglądarka nie zgłosi końca, kolejka nie może zostać zablokowana.
    this.timer = setTimeout(done, this.maxUtteranceMs);
    try {
      // Kolejka jest pusta (nic nie mówimy), więc czyszczenie jest bezpieczne; iOS bywa „zawieszony” po poprzedniej wypowiedzi.
      this.log(`speak ${this.voice ? this.voice.name : 'brak głosu'}: ${text.slice(0, 30)}`);
      speechSynthesis.cancel();
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(u);
      // Jeśli po chwili nic się nie zaczęło, spróbuj jeszcze raz.
      setTimeout(() => {
        if (this.cur !== u || started || speechSynthesis.speaking) return;
        this.log('ponawiam: nic się nie zaczęło');
        try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* ignoruj */ }
      }, 1200);
    } catch (err) {
      this.lastError = String(err);
      done();
    }
  }

  /** Adres nagrania z serwera (to samo zdanie = ten sam plik, serwer i telefon go pamiętają). */
  _cloudKey(text) { return text.replace(/\s+/g, ' ').trim(); }

  /** Pobiera nagranie z serwera; zwraca adres blob: albo rzuca błąd po limicie czasu. */
  _fetchCloud(text, timeoutMs = 6000) {
    const key = this._cloudKey(text);
    if (this.cloudCache.has(key)) return this.cloudCache.get(key);
    const p = (async () => {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const to = setTimeout(() => ctl && ctl.abort(), timeoutMs);
      try {
        const r = await fetch(`${this.cloudUrl}?t=${encodeURIComponent(key)}`, ctl ? { signal: ctl.signal } : {});
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (!blob.size) throw new Error('pusty');
        return URL.createObjectURL(blob);
      } finally { clearTimeout(to); }
    })();
    this.cloudCache.set(key, p);
    p.catch(() => this.cloudCache.delete(key));
    if (this.cloudCache.size > 120) this.cloudCache.delete(this.cloudCache.keys().next().value);
    return p;
  }

  /** Z wyprzedzeniem prosi serwer o nagrania, żeby w czasie jazdy były gotowe. */
  prefetch(texts) {
    if (this.engine !== 'cloud' || !this.cloudUrl || Date.now() < (this.cloudBlockedUntil || 0)) return;
    for (const t of texts) { const f = forSpeech(t); if (f) this._fetchCloud(f, 15000).catch(() => {}); }
  }

  async _cloud(text) {
    const gen = this.gen || 0;
    this.speaking = true;
    const stamp = {};
    this.cur = stamp;
    const done = () => {
      if (this.cur !== stamp) return;
      this._finish();
      this._next();
    };
    this.timer = setTimeout(done, this.maxUtteranceMs + 6000);
    try {
      const url = await this._fetchCloud(text, 4500);
      this.cloudFails = 0;
      if (this.cur !== stamp || gen !== (this.gen || 0)) return;
      if (!this.player) this.player = new Audio();
      const a = this.player;
      a.onended = done;
      a.onerror = () => { this.log('chmura: błąd odtwarzania'); done(); };
      a.src = url;
      a.volume = 1;
      this.log(`chmura: ${text.slice(0, 30)}`);
      await a.play();
    } catch (err) {
      this.cloudFails = (this.cloudFails || 0) + 1;
      this.log(`chmura niedostępna (${(err && err.message) || err}), mówi telefon`);
      if (this.cloudFails >= 2) this.cloudBlockedUntil = Date.now() + 60000;
      if (this.cur !== stamp) return;
      // cichy powrót do głosu telefonu
      clearTimeout(this.timer);
      this.cur = null;
      this._system(text);
    }
  }

  /** Wbudowany syntezator (eSpeak, wczytywany dopiero przy pierwszej wypowiedzi), odtwarzany przez element <audio>. */
  async _robot(text) {
    const gen = this.gen || 0;
    this.speaking = true;
    const stamp = {};
    this.cur = stamp;
    const done = () => {
      if (this.cur !== stamp) return;
      this._finish();
      this._next();
    };
    this.timer = setTimeout(done, this.maxUtteranceMs);
    try {
      if (!this.robot) this.robot = await import('../vendor/robot-tts.js');
      let url = this.cache.get(text);
      if (!url) {
        url = this.robot.render(text);
        if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(text, url);
      }
      if (this.cur !== stamp || gen !== (this.gen || 0)) return; // w międzyczasie przerwano
      if (!this.player) this.player = new Audio();
      const a = this.player;
      a.onended = done;
      a.onerror = () => { this.lastError = 'audio'; if (this.onError) this.onError('audio'); done(); };
      a.src = url;
      a.volume = 1;
      await a.play();
    } catch (err) {
      this.lastError = (err && err.name) || String(err);
      if (this.onError) this.onError(this.lastError);
      done();
    }
  }

  /** Krótki sygnał dźwiękowy przez element <audio> (kanał multimediów). */
  beep(freq = 880, ms = 140) {
    if (this.engine !== 'robot' && this.enabled) return; // przy głosie systemowym sygnał wyciszałby mowę; zapowiedź niesie ostrzeżenie
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
    if (this.engine === 'robot') return { supported: true, voices: 1, pl: 'wbudowany', robot: true };
    if (!this.ok) return { supported: false, voices: 0, pl: null };
    const vs = speechSynthesis.getVoices();
    return { supported: true, voices: vs.length, pl: this.voice ? this.voice.name : null };
  }

  test() {
    const was = this.enabled;
    this.enabled = true;
    if (this.engine === 'robot') this.beep(880, 160);
    this.say('Test głosu. Za trzysta metrów skręć w prawo w ulicę Krężnicką.', { urgent: true });
    this.enabled = was;
    return this.info();
  }
}
