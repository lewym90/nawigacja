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
    followPitch: 54,
    announce: { far: 600, near: 300 }, // m: kiedy zapowiadać manewr przy typowej prędkości
  },
  pedestrian: {
    id: 'pedestrian',
    label: 'Pieszo',
    costing: 'pedestrian',
    hazards: false,
    limits: false,
    alternatives: true,
    simKmh: 5,
    followPitch: 0,
    announce: { far: 60, near: 25 },
  },
  bicycle: {
    id: 'bicycle',
    label: 'Rower',
    costing: 'bicycle',
    hazards: false,
    limits: false,
    alternatives: true,
    simKmh: 18,
    followPitch: 40,
    announce: { far: 150, near: 60 },
  },
};

export const DEFAULT_MODE = 'auto';
export const modeOf = (id) => MODES[id] || MODES[DEFAULT_MODE];
