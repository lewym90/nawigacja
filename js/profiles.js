// Profile kamery i jakości nowego wyglądu. Tylko liczby: silnik i kamera czytają je przy każdej klatce,
// więc zmiana działa od razu, także w trakcie jazdy.

export const CAMERA_PROFILES = {
  classic: { label: 'Klasyczna', pitch: 60, zoom: -0.6, bearingTau: 0.8 }, // wyżej i dalej: najwięcej drogi przed autem
  dynamic: { label: 'Dynamiczna', pitch: 68, zoom: 0, bearingTau: 0.8 },
  cinematic: { label: 'Filmowa', pitch: 72, zoom: 0.3, bearingTau: 1.3 }, // niżej i bliżej, kadr obraca się wolniej
};

export const QUALITY_PROFILES = {
  ultra: { label: 'Ultra', pixelRatio: 3, radius: 2600, drop: 3600, shadows: true },
  high: { label: 'Wysoka', pixelRatio: 2, radius: 2000, drop: 3000, shadows: true },
  eco: { label: 'Eko', pixelRatio: 1.5, radius: 1300, drop: 1900, shadows: false }, // na długą trasę: mniej grzeje telefon
};

export const cameraProfile = (id) => CAMERA_PROFILES[id] || CAMERA_PROFILES.dynamic;
export const qualityProfile = (id) => QUALITY_PROFILES[id] || QUALITY_PROFILES.high;
