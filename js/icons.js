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
