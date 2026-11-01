// Zapamiętane miejsca: ostatnie cele (5) oraz „moje adresy” (dom, praca, inne). Czysty moduł, pamięć podawana z zewnątrz.

const R = 'nav.recents';
const SV = 'nav.saved';
const MAX_RECENTS = 5;

function read(st, key) {
  try { const v = JSON.parse(st.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(st, key, v) { try { st.setItem(key, JSON.stringify(v)); } catch { /* tryb prywatny */ } }

const clean = (d) => ({ main: String(d.main || 'Miejsce'), sub: String(d.sub || ''), lng: +d.lng, lat: +d.lat });
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0009 && Math.abs(a.lng - b.lng) < 0.0014; // ok. 100 m

export class Places {
  constructor(storage) { this.st = storage; }

  recents() { return read(this.st, R).slice(0, MAX_RECENTS); }

  addRecent(d) {
    const p = clean(d);
    if (!isFinite(p.lng) || !isFinite(p.lat)) return;
    const list = read(this.st, R).filter((x) => !(near(x, p) || x.main.toLowerCase() === p.main.toLowerCase()));
    list.unshift(p);
    write(this.st, R, list.slice(0, MAX_RECENTS));
  }

  removeRecent(i) {
    const list = read(this.st, R);
    list.splice(i, 1);
    write(this.st, R, list);
  }

  saved() { return read(this.st, SV); }

  /** kind: 'home' | 'work' | 'other'. Dom i praca są po jednym; „inne” ma własną nazwę. */
  save(kind, d, label = '') {
    const p = clean(d);
    let list = read(this.st, SV);
    const name = kind === 'home' ? 'Dom' : kind === 'work' ? 'Praca' : (String(label).trim() || p.main);
    if (kind === 'home' || kind === 'work') list = list.filter((x) => x.kind !== kind);
    else list = list.filter((x) => !(x.kind === 'other' && x.label.toLowerCase() === name.toLowerCase()));
    list.push({ id: `${kind}:${Date.now()}`, kind, label: name, ...p });
    const order = { home: 0, work: 1, other: 2 };
    list.sort((a, b) => order[a.kind] - order[b.kind]);
    write(this.st, SV, list);
    return list;
  }

  removeSaved(id) { write(this.st, SV, read(this.st, SV).filter((x) => x.id !== id)); }
}
