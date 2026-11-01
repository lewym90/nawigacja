// Tryby podróży. Różnią się konfiguracją, a nie osobnym kodem: silnik tras (costing), to co
// pokazujemy (fotoradary, limity), prędkość symulacji i progi komunikatów głosowych.
// Dodanie trybu = nowy wpis tutaj (+ ewentualnie nowy dostawca w provider.js).

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
    zoom: (kmh) => (kmh > 100 ? 14.8 : kmh > 70 ? 15.4 : kmh > 40 ? 16 : 16.6),
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
    zoom: () => 18,
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
    zoom: (kmh) => (kmh > 25 ? 16.8 : 17.4),
    guide: { arriveM: 12, maxOffM: 28, offFixes: 3, minSpeed: 4, nowMin: 25, nowMax: 70, nowSec: 5, remindMin: 150, remindMax: 500, remindSec: 40, preMargin: 40, passedPrev: 35, chainFar: 90, chainNear: 55 },
    say: { arrive: 'Dojechałeś do celu', off: 'Zjechałeś z trasy. Przeliczam…', go: 'Ruszaj' },
  },
};

export const DEFAULT_MODE = 'auto';
export const modeOf = (id) => MODES[id] || MODES[DEFAULT_MODE];
