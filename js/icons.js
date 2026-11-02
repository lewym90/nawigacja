// Ikony SVG (rysowane kreską, bez emoji). Zwracają łańcuch znaków do wstawienia w DOM.

const S = (inner, size = 24, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`;

export const icon = {
  search: (s) => S('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', s),
  menu: (s) => S('<path d="M4 7h16M4 12h16M4 17h16"/>', s),
  close: (s) => S('<path d="M6 6l12 12M18 6L6 18"/>', s),
  locate: (s) => S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/>', s),
  sound: (s) => S('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11"/>', s),
  mute: (s) => S('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>', s),
  warn: (s) => S('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>', s),
  pin: (s) => S('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>', s),
  home: (s) => S('<path d="M4 11l8-6.5 8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>', s),
  work: (s) => S('<rect x="3.5" y="8" width="17" height="11" rx="2"/><path d="M9 8V6a1 1 0 011-1h4a1 1 0 011 1v2M3.5 13h17"/>', s),
  curve: (s) => S('<path d="M7 21c0-6 10-6 10-12V3"/><path d="M13 7l4-4 4 4"/>', s),
  rail: (s) => S('<path d="M4 20l16-16"/><path d="M4 4l16 16"/><circle cx="12" cy="12" r="2"/>', s),
  bump: (s) => S('<path d="M3 18h18"/><path d="M5 18c2-8 12-8 14 0"/>', s),
  avoid: (s) => S('<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>', s),
  okroad: (s) => S('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>', s),
  school: (s) => S('<path d="M3 10l9-5 9 5-9 5z"/><path d="M7 12.5V17c3 2 7 2 10 0v-4.5"/>', s),
  tune: (s) => S('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>', s),
  plus: (s) => S('<path d="M12 5v14M5 12h14"/>', s),
  clock: (s) => S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  flag: (s) => S('<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>', s),
  play: (s) => S('<path d="M7 5l12 7-12 7z"/>', s),
  // zagrożenia
  camera: (s) => S('<rect x="3" y="8" width="18" height="11" rx="3"/><circle cx="12" cy="13.5" r="3"/><path d="M8 8l1.2-2.5h5.6L16 8"/>', s),
  redlight: (s) => S('<rect x="8" y="3" width="8" height="18" rx="3"/><circle cx="12" cy="8" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="16" r="1.3"/>', s),
  section: (s) => S('<path d="M3 17h18M5 17V9l4-3 4 3 2-1.5L19 9v8"/>', s),
  police: (s) => S('<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9.5 12l1.8 1.8L15 10"/>', s),
  accident: (s) => S('<path d="M5 17l3-8h8l3 8"/><circle cx="8" cy="17.5" r="1.7"/><circle cx="16" cy="17.5" r="1.7"/><path d="M12 3v3M6.5 5l1.6 2M17.5 5l-1.6 2"/>', s),
  obstacle: (s) => S('<path d="M3 20h18"/><path d="M5 20V9h14v11"/><path d="M5 13l4-4M9 20l6-11M14 20l5-5"/>', s),
  jam: (s) => S('<rect x="3" y="9" width="7" height="6" rx="2"/><rect x="14" y="9" width="7" height="6" rx="2"/><path d="M3 18h18"/>', s),
  roadwork: (s) => S('<path d="M12 4l9 15H3z"/><path d="M9 14h6M10.5 11h3"/>', s),
};

// Strzałki manewrów, większe (46 px), rysowane grubą kreską.
const ARROW = {
  straight: '<path d="M23 40V10M23 10L12 21M23 10l11 11"/>',
  right: '<path d="M12 40V24q0-8 8-8h12M26 8l8 8-8 8"/>',
  'slight-right': '<path d="M14 40V30q0-5 5-9l14-12M23 9h10v10"/>',
  'sharp-right': '<path d="M12 8v14q0 8 8 8h12M25 20l8 10-8 10" transform="translate(0,-4)"/>',
  uturn: '<path d="M34 40V18a10 10 0 00-20 0v20M8 32l6 8 6-8"/>',
  roundabout: '<circle cx="23" cy="26" r="9"/><path d="M23 42v-7M23 17V6M17 11l6-6 6 6"/>',
  merge: '<path d="M12 40V28l11-12V8M34 40V28L23 16M17 13l6-6 6 6"/>',
  arrive: '<path d="M23 42s-12-11-12-21a12 12 0 0124 0c0 10-12 21-12 21z"/><circle cx="23" cy="21" r="4.5"/>',
};

export function arrow(name = 'straight', size = 46) {
  const left = /^(left|slight-left|sharp-left)/.test(name);
  const base = name.replace(/^left/, 'right').replace(/^slight-left/, 'slight-right').replace(/^sharp-left/, 'sharp-right');
  const path = ARROW[base] || ARROW.straight;
  const g = left ? `<g transform="translate(46,0) scale(-1,1)">${path}</g>` : path;
  return `<svg width="${size}" height="${size}" viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>`;
}

// ---------- Pinezki zagrożeń na mapie (kolory z gradientów w index.html: #g-cam, #g-red, #g-sec, #g-end) ----------

const GLYPH = {
  // fotoradar: obudowa z obiektywem i lampą
  camera: '<rect x="11.5" y="13.5" width="21" height="13.5" rx="4" fill="#fff"/><circle cx="21.5" cy="20.3" r="4.4" fill="url(#g-cam)"/><circle cx="21.5" cy="20.3" r="1.7" fill="#fff"/><circle cx="29" cy="16.6" r="1.5" fill="url(#g-cam)"/>',
  // kamera na światłach: sygnalizator
  redlight: '<rect x="15.5" y="9.5" width="13" height="22" rx="4.5" fill="#fff"/><circle cx="22" cy="15.2" r="2.7" fill="url(#g-red)"/><circle cx="22" cy="20.5" r="2.7" fill="#d9a21b"/><circle cx="22" cy="25.8" r="2.7" fill="#3aa86b"/>',
  // początek odcinka: flaga na maszcie
  start: '<rect x="14" y="9.5" width="2.6" height="22" rx="1.3" fill="#fff"/><path d="M16.6 10.5h14.2l-3.6 5.2 3.6 5.2H16.6z" fill="#fff"/>',
  // koniec odcinka: flaga w szachownicę
  end: '<rect x="14" y="9.5" width="2.6" height="22" rx="1.3" fill="#fff"/><path d="M16.6 10.5h14.4v10.4H16.6z" fill="#fff"/><g fill="url(#g-end)"><rect x="16.6" y="10.5" width="3.6" height="3.47"/><rect x="23.8" y="10.5" width="3.6" height="3.47"/><rect x="20.2" y="13.97" width="3.6" height="3.47"/><rect x="27.4" y="13.97" width="3.6" height="3.47"/><rect x="16.6" y="17.43" width="3.6" height="3.47"/><rect x="23.8" y="17.43" width="3.6" height="3.47"/></g>',
};
const FILL = { camera: 'g-cam', redlight: 'g-red', start: 'g-sec', end: 'g-end' };

/**
 * Pinezka 44x54 (czubek na dole). kind: camera | redlight | start | end.
 * limit: opcjonalna tarcza z ograniczeniem w prawym górnym rogu.
 */
export function hazardPin(kind, { limit = null } = {}) {
  const badge = limit
    ? `<g transform="translate(35 9)"><circle r="9.4" fill="#fff" stroke="#d93636" stroke-width="3.2"/><text y="3.4" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-weight="800" font-size="${String(limit).length > 2 ? 8.6 : 10.5}" fill="#111">${limit}</text></g>`
    : '';
  return `<svg class="pin" width="44" height="54" viewBox="0 0 44 54" aria-hidden="true">
    <path d="M22 52.5 12.8 37.2h18.4z" fill="url(#${FILL[kind]})" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="4" y="2.5" width="36" height="36" rx="11.5" fill="url(#${FILL[kind]})" stroke="#fff" stroke-width="2.4"/>
    <path d="M17 37.6h10" stroke="url(#${FILL[kind]})" stroke-width="4"/>
    ${GLYPH[kind]}${badge}</svg>`;
}
