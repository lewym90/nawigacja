// „Dlaczego ta trasa”: kilka konkretnych zdań o tym, czemu wybrana trasa wygląda tak, a nie inaczej.
// Same liczby i fakty z wyliczonej trasy, bez ogólników.

const km = (m) => (m / 1000).toFixed(1).replace('.', ',');
const min = (s) => Math.round(s / 60);

/** Metry trasy na drogach o limicie >= `from` km/h (z route.limits). */
export function metersAtLeast(route, from) {
  let m = 0;
  for (const l of route.limits || []) if (l.kmh >= from) m += l.to - l.from;
  return m;
}

/**
 * routes: wszystkie warianty, sel: indeks wybranego, ctx: { prefLabel, avoid (tekst z silnika), fixes (liczba), cams (liczba lub null) }.
 * Zwraca tablicę zdań.
 */
export function explainRoute(routes, sel, ctx = {}) {
  const r = routes[sel];
  if (!r) return [];
  const out = [];
  const others = routes.filter((_, i) => i !== sel);
  if (others.length) {
    const fastest = routes.every((o) => o.duration >= r.duration - 1);
    const shortest = routes.every((o) => o.distance >= r.distance - 1);
    const cmp = (o) => ({ dt: min(o.duration - r.duration), dd: (o.distance - r.distance) / 1000, via: o.via });
    if (fastest) {
      const o = others.slice().sort((a, b) => a.duration - b.duration)[0];
      const c = cmp(o);
      const dist = Math.abs(c.dd) < 0.2 ? 'podobny dystans' : c.dd > 0 ? `o ${c.dd.toFixed(1).replace('.', ',')} km krócej` : `o ${(-c.dd).toFixed(1).replace('.', ',')} km dłużej`;
      out.push(c.dt >= 1 ? `Najszybsza: ${c.dt} min szybciej niż trasa przez ${c.via || 'inną drogę'} (${dist}).` : 'Najszybsza z dostępnych, ale różnica wobec pozostałych jest poniżej minuty.');
    } else if (shortest) {
      const o = others.slice().sort((a, b) => a.distance - b.distance)[0];
      const c = cmp(o);
      out.push(`Najkrótsza: ${Math.abs(c.dd).toFixed(1).replace('.', ',')} km krócej niż trasa przez ${c.via || 'inną drogę'}${c.dt < 0 ? `, ale ${-c.dt} min dłużej` : ''}.`);
    } else {
      const f = routes.slice().sort((a, b) => a.duration - b.duration)[0];
      out.push(`Wybrany wariant jest ${min(r.duration - f.duration)} min wolniejszy od najszybszego (przez ${f.via || 'inną drogę'}).`);
    }
  }
  if (ctx.prefLabel) out.push(`Ustawienie trasy: ${ctx.prefLabel}.`);
  const fast = metersAtLeast(r, 100);
  if (fast >= 3000 && r.distance > 0) out.push(`Drogi szybkiego ruchu (limit od 100 km/h): ${km(fast)} km, czyli ${Math.round((fast / r.distance) * 100)}% trasy.`);
  const slow = (r.limits || []).reduce((a, l) => a + (l.kmh && l.kmh <= 50 ? l.to - l.from : 0), 0);
  if (slow >= 3000 && r.distance > 0) out.push(`Tereny zabudowane (limit do 50 km/h): ${km(slow)} km.`);
  const av = /^poprawiona (\d+)→(\d+) m/.exec(ctx.avoid || '');
  if (av && +av[1] > +av[2]) out.push(`Ominięto ${+av[1] - +av[2]} m dróg polnych i serwisowych w środku trasy.`);
  if (ctx.fixes > 0) out.push(`Uwzględniono ${ctx.fixes} ${ctx.fixes === 1 ? 'zgłoszone miejsce' : 'zgłoszonych miejsc'} do ominięcia.`);
  if (ctx.cams != null) out.push(ctx.cams ? `Fotoradary i odcinkowe pomiary na trasie: ${ctx.cams}. Ostrzegę z wyprzedzeniem.` : 'Brak znanych fotoradarów na trasie.');
  return out;
}
