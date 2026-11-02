// Własny styl mapy (nasz wygląd) na danych OpenStreetMap w schemacie OpenMapTiles.
// Dwa warianty: noc i dzień. Styl nie kopiuje żadnej mapy komercyjnej.

const PALETTE = {
  // Noc: granat i „świecące” drogi; wyższe budynki jaśnieją na niebiesko
  night: {
    bg: '#070B1A', land: '#0A1026', park: '#0B2230', wood: '#0A1D29', water: '#0A2A57', waterLine: '#123A74',
    building: '#141C3A', buildingTop: '#3B52A0', industrial: '#0E1530', hospital: '#2A1530', school: '#101A38',
    roadMinor: '#1B2550', roadMinorCase: '#070B1A', roadMid: '#2A3A78', roadMidCase: '#070B1A',
    roadMain: '#4660B8', roadMainCase: '#0A1026', roadMajor: '#FF9F3A', roadMajorCase: '#5A3210',
    rail: '#2A3566', path: '#26336B', pathPed: '#8FA0D0', steps: '#FFB454', cycle: '#37D6A0', boundary: '#34406E',
    label: '#8FA0D0', labelMajor: '#D4DCF5', halo: '#070B1A', placeCity: '#E4EAFB', placeTown: '#AEBBE0',
  },
  // Dzień: chłodny, jasny błękit zamiast beżu; droga główna ciepła, zieleń i woda wyraźne
  day: {
    bg: '#E3EBF3', land: '#EAF0F6', park: '#CBE8D4', wood: '#BCE0C9', water: '#9CC8EE', waterLine: '#86B8E4',
    building: '#E1E7F0', buildingTop: '#A5B5D2', industrial: '#E2E7EF', hospital: '#F5DDE3', school: '#EEF0DC',
    roadMinor: '#FFFFFF', roadMinorCase: '#CBD5E3', roadMid: '#FFFFFF', roadMidCase: '#B7C4D8',
    roadMain: '#FFEBB5', roadMainCase: '#D9B565', roadMajor: '#FFC24D', roadMajorCase: '#D98E1E',
    rail: '#B9C4D6', path: '#CBD5E3', pathPed: '#6F7C94', steps: '#C47A1E', cycle: '#1E9E73', boundary: '#AEB9CC',
    label: '#5A6785', labelMajor: '#1E2A45', halo: '#F3F6FA', placeCity: '#1B2540', placeTown: '#3A4666',
  },
};

const mix = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a); const y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const lerpWidth = (a, b, c) => ['interpolate', ['exponential', 1.5], ['zoom'], 5, a, 12, b, 18, c];
// Ścieżki: domyślnie ledwo widoczne (jazda autem), dla pieszego i rowerzysty główny bohater mapy.
function pathLayers(road, c, travel) {
  const P = ['path', 'track', 'pedestrian'];
  if (travel === 'pedestrian') {
    const w = ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 2.4, 19, 5];
    return [
      road('path', P, c.pathPed, w, { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 1], 'line-dasharray': [1, 0] }),
      { ...road('steps', ['path'], c.steps, ['interpolate', ['linear'], ['zoom'], 15, 1.6, 19, 5], { 'line-dasharray': [0.8, 0.8] }), filter: ['all', ['==', ['get', 'class'], 'path'], ['==', ['get', 'subclass'], 'steps']], minzoom: 15 },
    ];
  }
  if (travel === 'bicycle') {
    const w = ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2.2, 19, 4.5];
    return [
      road('path', P, c.path, lerpWidth(0.3, 1, 3), { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1] }),
      { ...road('cycleway', ['path'], c.cycle, w, {}), filter: ['all', ['==', ['get', 'class'], 'path'], ['==', ['get', 'subclass'], 'cycleway']], minzoom: 11 },
    ];
  }
  return [road('path', P, c.path, lerpWidth(0.3, 0.6, 2), { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1] })];
}

const NAME = ['coalesce', ['get', 'name:pl'], ['get', 'name']];

/** travel: auto | pedestrian | bicycle. Pieszo wyraźnie rysujemy ścieżki i schody, rowerem drogi rowerowe. */
export function buildStyle(mode, cfg, travel = 'auto') {
  const c = PALETTE[mode] || PALETTE.night;
  const road = (id, classes, color, w, extra = {}) => ({
    id, type: 'line', source: 'omt', 'source-layer': 'transportation',
    filter: ['all', ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': w, ...extra },
  });

  return {
    version: 8,
    name: `nav-${mode}`,
    glyphs: cfg.glyphsUrl,
    sources: { omt: { type: 'vector', url: cfg.tilesUrl } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], paint: { 'fill-color': c.wood } },
      { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]], paint: { 'fill-color': c.park, 'fill-opacity': 0.7 } },
      { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]], paint: { 'fill-color': c.land } },
      { id: 'landuse-ind', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['industrial', 'commercial', 'retail']]], paint: { 'fill-color': c.industrial } },
      { id: 'landuse-school', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['school', 'university', 'kindergarten']]], paint: { 'fill-color': c.school } },
      { id: 'landuse-hosp', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'hospital'], paint: { 'fill-color': c.hospital } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': c.waterLine, 'line-width': lerpWidth(0.4, 1.2, 4) } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': c.rail, 'line-width': lerpWidth(0.4, 0.8, 2), 'line-dasharray': [3, 2] } },

      ...pathLayers(road, c, travel),
      road('minor-case', ['minor', 'service'], c.roadMinorCase, lerpWidth(0.3, 2.4, 14)),
      road('minor', ['minor', 'service'], c.roadMinor, lerpWidth(0.2, 1.6, 12)),
      road('mid-case', ['tertiary', 'secondary'], c.roadMidCase, lerpWidth(0.6, 3.6, 22)),
      road('mid', ['tertiary', 'secondary'], c.roadMid, lerpWidth(0.4, 2.6, 18)),
      road('main-case', ['primary'], c.roadMainCase, lerpWidth(1, 4.4, 26)),
      road('main', ['primary'], c.roadMain, lerpWidth(0.8, 3.2, 21)),
      road('major-case', ['motorway', 'trunk'], c.roadMajorCase, lerpWidth(1.4, 5.2, 30)),
      road('major', ['motorway', 'trunk'], c.roadMajor, lerpWidth(1.1, 3.8, 25)),

      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, maxzoom: 15.5, paint: { 'fill-color': c.building, 'fill-opacity': 0.9 } },
      {
        id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 15,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, c.building, 30, mix(c.building, c.buildingTop, 0.45), 80, c.buildingTop],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.96,
        },
      },
      { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': c.boundary, 'line-width': 0.8, 'line-dasharray': [4, 3] } },

      {
        id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.5,
        layout: {
          'symbol-placement': 'line', 'text-field': NAME, 'text-font': [cfg.fontRegular], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14],
          'text-letter-spacing': 0.04, 'text-max-angle': 30,
        },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.6 },
      },
      {
        id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'village', 'hamlet']]],
        layout: { 'text-field': NAME, 'text-font': [cfg.fontRegular], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 15], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 7,
        filter: ['==', ['get', 'class'], 'town'],
        layout: { 'text-field': NAME, 'text-font': [cfg.fontBold], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 14, 17] },
        paint: { 'text-color': c.placeTown, 'text-halo-color': c.halo, 'text-halo-width': 1.6 },
      },
      {
        id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4,
        filter: ['==', ['get', 'class'], 'city'],
        layout: { 'text-field': NAME, 'text-font': [cfg.fontBold], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 22], 'text-letter-spacing': 0.04 },
        paint: { 'text-color': c.placeCity, 'text-halo-color': c.halo, 'text-halo-width': 2 },
      },
    ],
  };
}

/** Kolory interfejsu zależne od trybu (używane też przez CSS przez zmienne). */
export function isNight(theme, now = new Date()) {
  if (theme === 'night') return true;
  if (theme === 'day') return false;
  const h = now.getHours();
  return h >= 19 || h < 6;
}
