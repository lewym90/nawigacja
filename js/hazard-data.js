// Dane o zagrożeniach (fotoradary, odcinkowe pomiary): ładowanie ze źródeł i dopasowanie do trasy.
// Nie dotyka mapy ani interfejsu; stan trzyma w jednym obiekcie, który app.js tylko odczytuje.
import { parseOverpass, overpassQuery, mergeSources, onRoute, sectionsOnRoute } from './hazards.js';
import { corridorBoxesRange } from './geo.js';

export const WINDOW_M = 60000;

export function createHazardData(CONFIG, reports) {
  const ovCache = new Map();
  const hd = {
    osm: { cameras: [], sections: [] },
    local: { cameras: [], sections: [], suppress: [] },
    static: null,
    status: {}, // do ekranu diagnostycznego: osmFile, gitd, live, limits
    localLoaded: false,
    staticLoaded: false,
    resetLive() { hd.osm = { cameras: [], sections: [] }; },
  };

  


  async function loadLocal() {
    if (hd.localLoaded) return;
    hd.localLoaded = true;
    try {
      const r = await fetch(CONFIG.localHazardsUrl, { cache: 'no-cache' });
      if (r.ok) hd.local = await r.json();
    } catch { /* brak pliku: pracujemy na samym OSM */ }
  }

  async function loadStatic() {
    if (hd.staticLoaded) return;
    hd.staticLoaded = true;
    const get = async (u) => {
      try { const r = await fetch(u, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
    };
    const [osm, gitd] = await Promise.all([get(CONFIG.staticOsmUrl), get(CONFIG.staticGitdUrl)]);
    hd.static = { osm, gitd };
    const n = (x) => (x ? (x.cameras || []).length + (x.sections || []).length : 0);
    hd.status = { ...hd.status, osmFile: n(osm), gitd: n(gitd) };
  }

  // Publiczny Overpass odrzuca zbyt wiele zapytań naraz: dwa równoległe, z ponowieniami.
  async function fetchBoxes(boxes) {
    const parts = [];
    let failed = 0;
    const queue = [...boxes];
    const worker = async () => {
      while (queue.length) {
        const b = queue.shift();
        const key = b.map((v) => v.toFixed(3)).join();
        if (ovCache.has(key)) { parts.push(ovCache.get(key)); continue; }
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 30000);
            const res = await fetch(CONFIG.overpassUrl, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(b) }), signal: ctrl.signal });
            clearTimeout(t);
            if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
            if (!res.ok) break;
            const parsed = parseOverpass(await res.json());
            ovCache.set(key, parsed);
            parts.push(parsed);
            ok = true;
          } catch {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        if (!ok) failed++;
      }
    };
    await Promise.all([worker(), worker()]);
    return { parts, failed };
  }

  function addOsm(parts) {
    const seen = new Set(hd.osm.cameras.map((c) => c.id));
    const seenS = new Set(hd.osm.sections.map((c) => c.id));
    for (const p of parts) {
      for (const c of p.cameras) if (!seen.has(c.id)) { seen.add(c.id); hd.osm.cameras.push(c); }
      for (const c of p.sections) if (!seenS.has(c.id)) { seenS.add(c.id); hd.osm.sections.push(c); }
    }
  }

  /** Trasy krótkie: jedno zapytanie na obwiednię. Długie (>80 km): okno [fromM, toM] wzdłuż trasy. */
  // Trzy źródła: plik OSM (cała Polska), plik GITD i Overpass na żywo. Pliki są dostępne od razu;
  // Overpass dochodzi w tle i niepowodzenie niczego nie psuje (nie pokazujemy o nim komunikatów).
  async function loadHazards(routes, { fromM = 0, toM = WINDOW_M } = {}) {
    await Promise.all([loadLocal(), loadStatic()]);
    const live = (async () => {
      const boxes = new Map();
      const long = routes.some((r) => r.distance > 80000);
      if (!long) {
        const all = routes.flatMap((r) => r.coords);
        const ub = all.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
        boxes.set('u', [ub[0] - 0.005, ub[1] - 0.004, ub[2] + 0.005, ub[3] + 0.004]);
      } else {
        for (const r of routes) corridorBoxesRange(r.line, fromM, toM).forEach((b) => boxes.set(b.map((v) => v.toFixed(3)).join(), b));
      }
      try {
        const { parts, failed } = await fetchBoxes([...boxes.values()]);
        addOsm(parts);
        hd.status = { ...hd.status, live: failed ? (parts.length ? 'częściowo' : 'niedostępne') : 'ok' };
        return { failed };
      } catch {
        hd.status = { ...hd.status, live: 'niedostępne' };
        return { failed: 1 };
      }
    })();
    return { live };
  }

  function itemsFor(route) {
    return [
      ...route.hz.cams,
      ...route.hz.secs.map((s) => ({ id: s.id, type: 'section', along: s.startAlong, limit: s.limit, lng: s.start[0], lat: s.start[1] })),
    ].sort((a, b) => a.along - b.along);
  }

  function allPoints() {
    const st = hd.static || {};
    const merged = mergeSources([hd.osm, st.osm, st.gitd], hd.local);
    return { cameras: merged.cameras, sections: merged.sections };
  }

  function applyHazards(routes) {
    const { cameras, sections } = allPoints();
    const rep = reports.active();
    for (const r of routes) {
      r.hz = {
        cams: onRoute(r, [...cameras, ...rep.map((x) => ({ ...x }))]),
        secs: sectionsOnRoute(r, sections),
      };
    }
  }


  Object.assign(hd, { loadHazards, itemsFor, allPoints, applyHazards });
  return hd;
}
