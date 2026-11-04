// Tryby podróży. Różnią się konfiguracją, a nie osobnym kodem: silnik tras (costing), to co
// pokazujemy (fotoradary, limity), prędkość symulacji i progi komunikatów głosowych.
// Dodanie trybu = nowy wpis tutaj (+ ewentualnie nowy dostawca w provider.js).

const zoomBySpeed = (kmh, slow, fast, top) => slow + (fast - slow) * Math.min(1, Math.max(0, kmh) / top);

export const MODES = {
  auto: {
    id: 'auto',
    label: 'Auto',
    costing: 'auto',
    hazards: true,        // fotoradary, odcinkowe pomiary, zgłoszenia
    limits: true,         // limity prędkości z drogi
    alternatives: true,
    simKmh: null,         // null = realistyczna jazda samochodem (sim.js)
    pitch: 55,
    // kamera pościgowa nisko za autem: stałe pochylenie, zoom ciągły (bez progów, które dawały skoki)
    camPitch: () => 73,
    zoom: (kmh) => zoomBySpeed(kmh, 18.6, 17.6, 130),
    guide: {}, // domyślne progi z guidance.js
    say: { arrive: 'Dojechałeś do celu', off: 'Zjechałeś z trasy. Przeliczam…', go: 'Ruszaj' },
  },
  pedestrian: {
    id: 'pedestrian',
    label: 'Pieszo',
    costing: 'pedestrian',
    hazards: false,
    limits: false,
    alternatives: false, // pieszo warianty wychodzą prawie identyczne: jedna, najlepsza trasa
    simKmh: 5,
    pitch: 55,
    camPitch: () => 72,
    zoom: () => 19.6,
    compass: true,        // kierunek z kompasu telefonu, gdy stoisz lub idziesz wolno
    guide: { arriveM: 8, maxOffM: 22, offFixes: 4, minSpeed: 1.2, nowMin: 12, nowMax: 28, nowSec: 5, remindMin: 70, remindMax: 220, remindSec: 60, preMargin: 25, passedPrev: 18, chainFar: 45, chainNear: 28 },
    say: { arrive: 'Jesteś na miejscu', off: 'Zszedłeś z trasy. Przeliczam…', go: 'Idź' },
  },
  bicycle: {
    id: 'bicycle',
    label: 'Rower',
    costing: 'bicycle',
    hazards: false,
    limits: false,
    alternatives: false,
    simKmh: 18,
    pitch: 55,
    camPitch: () => 72,
    zoom: (kmh) => zoomBySpeed(kmh, 19.2, 18.6, 35),
    guide: { arriveM: 12, maxOffM: 28, offFixes: 3, minSpeed: 4, nowMin: 25, nowMax: 70, nowSec: 5, remindMin: 150, remindMax: 500, remindSec: 40, preMargin: 40, passedPrev: 35, chainFar: 90, chainNear: 55 },
    say: { arrive: 'Dojechałeś do celu', off: 'Zjechałeś z trasy. Przeliczam…', go: 'Ruszaj' },
  },
};

export const DEFAULT_MODE = 'auto';
export const modeOf = (id) => MODES[id] || MODES[DEFAULT_MODE];
