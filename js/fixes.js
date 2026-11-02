// Poprawki tras od kierowców: „unikaj tej drogi” i „tu można jechać”.
// Własne zgłoszenia działają od razu (zapis lokalny), a po synchronizacji trafiają do wspólnej bazy na serwerze.
// Cudze „unikaj” stosujemy dopiero, gdy potwierdziło je co najmniej FIXES.confirmN różnych kierowców.
// Wykluczenia trafiają do Valhalli jako exclude_locations (krawędź najbliższa punktowi jest omijana).

export const FIXES = { confirmN: 2, maxExclude: 30, corridorM: 8000, ttlMs: 10 * 60 * 1000, ownMax: 300 };

const KEY_OWN = 'nav.fixes.own';
const KEY_CLIENT = 'nav.fixes.client';

export function newClientId(cryptoObj = globalThis.crypto) {
  const b = new Uint8Array(12);
  if (cryptoObj && cryptoObj.getRandomValues) cryptoObj.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return 'k' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const M_LAT = 111195;
/** Odległość punktu od odcinka a-b w metrach (płaskie przybliżenie, wystarcza na kilkadziesiąt km). */
export function distToSegM(p, a, b) {
  const k = M_LAT * Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k; const ay = (a[1] - p[1]) * M_LAT;
  const bx = (b[0] - p[0]) * k; const by = (b[1] - p[1]) * M_LAT;
  const dx = bx - ax; const dy = by - ay; const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/**
 * Wybiera punkty do wykluczenia z listy poprawek: tylko „avoid” dla danego trybu, leżące w korytarzu
 * wokół prostej from-to, najbliższe prostej najpierw (limit Valhalli to 50 punktów na zapytanie).
 * Zwraca [[lng, lat], ...].
 */
export function pickExclusions(fixes, from, to, { corridorM = FIXES.corridorM, max = FIXES.maxExclude } = {}) {
  const out = [];
  for (const f of fixes) {
    const d = distToSegM([f.lng, f.lat], from, to);
    if (d <= corridorM) out.push({ d, p: [f.lng, f.lat] });
  }
  out.sort((a, b) => a.d - b.d);
  // dwa punkty bliżej niż 15 m to ta sama krawędź: jeden wystarczy
  const picked = [];
  for (const o of out) {
    if (picked.length >= max) break;
    if (picked.some((q) => distToSegM(o.p, q, q) < 15)) continue;
    picked.push(o.p);
  }
  return picked;
}

export class FixStore {
  /**
   * url – adres usługi (np. https://…/fixes); storage – obiekt jak localStorage; fetchFn – jak fetch;
   * now – zegar (ms) do testów.
   */
  constructor({ url, storage, fetchFn, now } = {}) {
    this.url = (url || '').replace(/\/$/, '');
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.fetch = fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.now = now || (() => Date.now());
    this.cache = new Map(); // klucz obwiedni -> { t, list }
    this._own = null;
  }

  _read(key, fallback) { try { const v = this.storage && this.storage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
  _write(key, v) { try { this.storage && this.storage.setItem(key, JSON.stringify(v)); } catch { /* brak miejsca / tryb prywatny */ } }

  get clientId() {
    let id = this._read(KEY_CLIENT, null);
    if (!id) { id = newClientId(); this._write(KEY_CLIENT, id); }
    return id;
  }

  own() {
    if (!this._own) this._own = this._read(KEY_OWN, []);
    return this._own;
  }
  _saveOwn() { this._write(KEY_OWN, this.own().slice(-FIXES.ownMax)); }

  /** Dodaje własną poprawkę (działa od razu) i próbuje wysłać ją na serwer. Zwraca zapisany wpis. */
  add(kind, mode, lat, lng) {
    const near = this.own().find((f) => f.kind === kind && f.mode === mode && Math.hypot((f.lat - lat) * M_LAT, (f.lng - lng) * M_LAT * Math.cos((lat * Math.PI) / 180)) < 20);
    if (near) { near.t = this.now(); this._saveOwn(); this.sync(); return near; }
    const f = { lid: `${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, mode, lat: +lat.toFixed(6), lng: +lng.toFixed(6), t: this.now(), sid: null };
    this.own().push(f);
    this._saveOwn();
    this.sync();
    return f;
  }

  remove(lid) {
    const i = this.own().findIndex((f) => f.lid === lid);
    if (i < 0) return false;
    const [f] = this.own().splice(i, 1);
    this._saveOwn();
    if (f.sid && this.url && this.fetch) this.fetch(`${this.url}/${f.sid}?client=${encodeURIComponent(this.clientId)}`, { method: 'DELETE' }).catch(() => {});
    return true;
  }

  /** Wysyła na serwer wpisy, których jeszcze tam nie ma. Błędy sieci nie przeszkadzają (ponowimy później). */
  async sync() {
    if (!this.url || !this.fetch) return 0;
    let sent = 0;
    for (const f of this.own().filter((x) => !x.sid && !x.failed)) {
      try {
        const res = await this.fetch(`${this.url}/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: f.kind, mode: f.mode, lat: f.lat, lng: f.lng, client: this.clientId }),
        });
        if (res.ok) { f.sid = (await res.json()).id; sent++; } else if (res.status >= 400 && res.status < 500 && res.status !== 429) f.failed = true; // odrzucone na stałe
      } catch { /* offline: spróbujemy przy następnej okazji */ }
    }
    if (sent) this._saveOwn();
    return sent;
  }

  /** Zgłoszenia innych w obwiedni [minLng,minLat,maxLng,maxLat] (z pamięci podręcznej do 10 minut). */
  async remote(bbox, mode) {
    if (!this.url || !this.fetch) return [];
    const key = `${mode}:${bbox.map((v) => v.toFixed(2)).join(',')}`;
    const c = this.cache.get(key);
    if (c && this.now() - c.t < FIXES.ttlMs) return c.list;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
      const res = await this.fetch(`${this.url}/?bbox=${bbox.map((v) => v.toFixed(5)).join(',')}&mode=${mode}`, ctrl ? { signal: ctrl.signal } : {});
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      this.cache.set(key, { t: this.now(), list });
      return list;
    } catch { return c ? c.list : []; }
  }

  /** Punkty do wykluczenia dla trasy from -> to (obie [lng, lat]) w danym trybie. */
  async exclusionsFor(from, to, mode = 'auto') {
    const pad = FIXES.corridorM / M_LAT;
    const bbox = [Math.min(from[0], to[0]) - pad * 1.6, Math.min(from[1], to[1]) - pad, Math.max(from[0], to[0]) + pad * 1.6, Math.max(from[1], to[1]) + pad];
    const mine = this.own().filter((f) => f.kind === 'avoid' && f.mode === mode);
    const remote = (await this.remote(this.clampBbox(bbox), mode)).filter((f) => f.kind === 'avoid' && f.n >= FIXES.confirmN);
    return pickExclusions([...mine, ...remote], from, to);
  }

  // serwer przyjmuje obwiednie do 3 stopni; dłuższe trasy sprawdzamy przy punkcie startu i celu osobno
  clampBbox(b) {
    const w = 2.9;
    const cx = (b[0] + b[2]) / 2; const cy = (b[1] + b[3]) / 2;
    return [Math.max(b[0], cx - w / 2), Math.max(b[1], cy - w / 2), Math.min(b[2], cx + w / 2), Math.min(b[3], cy + w / 2)];
  }

  /** Punkty do narysowania na mapie w obwiedni: własne oraz potwierdzone cudze. */
  async markersIn(bbox, mode = 'auto') {
    const remote = (await this.remote(bbox, mode)).filter((f) => f.kind === 'ok' ? f.n >= FIXES.confirmN : f.n >= FIXES.confirmN);
    const mine = this.own().filter((f) => f.mode === mode && f.lng >= bbox[0] && f.lng <= bbox[2] && f.lat >= bbox[1] && f.lat <= bbox[3]).map((f) => ({ ...f, own: true }));
    return [...mine, ...remote.map((f) => ({ ...f, own: false }))];
  }
}

export const FIX_LABEL = { avoid: 'Unikaj tej drogi', ok: 'Tu można jechać' };
