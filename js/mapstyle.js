// Własny styl mapy (nasz wygląd) na danych OpenStreetMap w schemacie OpenMapTiles.
// Dwa warianty: noc i dzień. Styl nie kopiuje żadnej mapy komercyjnej.

const PALETTE = {
  night: {
    bg: '#0D0D10', land: '#121216', park: '#12231B', wood: '#102019', water: '#0A1626', waterLine: '#0F2038',
    building: '#1B1B22', buildingTop: '#23232C', industrial: '#15151B', hospital: '#1B1519', school: '#16161C',
    roadMinor: '#24242C', roadMinorCase: '#0D0D10', roadMid: '#33333E', roadMidCase: '#0D0D10',
    roadMain: '#4A4A58', roadMainCase: '#0D0D10', roadMajor: '#7A6A3A', roadMajorCase: '#2B2411',
    rail: '#2A2A33', path: '#2E2E37', pathPed: '#8A8576', steps: '#E0A85A', cycle: '#3C8F6B', boundary: '#3A3A44',
    label: '#A09B91', labelMajor: '#D8D3C7', halo: '#0D0D10', placeCity: '#E7E2D6', placeTown: '#BDB8AD',
  },
  day: {
    bg: '#E9E6DE', land: '#EFECE4', park: '#D3E3CB', wood: '#C7DBC0', water: '#B9D3E6', waterLine: '#A9C7DE',
    building: '#DDD8CC', buildingTop: '#E8E3D8', industrial: '#E4E0D6', hospital: '#F0DDDD', school: '#EAE4D2',
    roadMinor: '#FFFFFF', roadMinorCase: '#D8D3C6', roadMid: '#FFFFFF', roadMidCase: '#CFC9BA',
    roadMain: '#FDF1D2', roadMainCase: '#C9BE9E', roadMajor: '#F5D58A', roadMajorCase: '#BFA45A',
    rail: '#C8C3B6', path: '#D6D0C2', pathPed: '#8E8776', steps: '#C47A1E', cycle: '#2E8B62', boundary: '#B8B2A4',
    label: '#6B665C', labelMajor: '#2E2B25', halo: '#F4F1EA', placeCity: '#23211C', placeTown: '#4A463E',
  },
};

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
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, c.building, 60, c.buildingTop],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
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
