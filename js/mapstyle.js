// Własny styl mapy (nasz wygląd) na danych OpenStreetMap w schemacie OpenMapTiles.
// Dwa warianty: noc i dzień. Styl nie kopiuje żadnej mapy komercyjnej.

import { FACADE_KINDS } from './facade-list.js';

const PALETTE = {
  // Noc: granat, ciemny asfalt i światła w oknach
  night: {
    bg: '#0A1524', land: '#0D1A2C', park: '#0E2A2A', wood: '#0B2426', water: '#0B2C52', waterLine: '#123A6A',
    building: '#16233B', buildingTop: '#22324E', roofA: '#141E30', roofB: '#182337', roofC: '#111A2B', industrial: '#101D30', hospital: '#1C1F38', school: '#13223A',
    roadMinor: '#232E40', roadMinorCase: '#101A29', roadMid: '#2A3648', roadMidCase: '#101A29',
    roadMain: '#303C50', roadMainCase: '#101A29', roadMajor: '#354258', roadMajorCase: '#101A29', roadLine: '#F5FAFF', roadEdge: '#C9D8EA',
    rail: '#2F3D55', path: '#2B3950', pathPed: '#8FA8C4', steps: '#FFB547', cycle: '#32D69A', boundary: '#34456A',
    label: '#A9C2DA', labelMajor: '#F5FAFF', halo: '#071426', placeCity: '#F5FAFF', placeTown: '#C3D5E8',
  },
  // Dzień: zieleń, ciepły tynk i prawdziwy kolor asfaltu
  day: {
    bg: '#D5E0C8', land: '#DCE5CE', park: '#A9CF95', wood: '#8FBE7E', water: '#6FB1E3', waterLine: '#5BA3D9',
    building: '#E8DCC8', buildingTop: '#CFC4B2', roofA: '#B8735C', roofB: '#9BA0A8', roofC: '#C08A70', industrial: '#DADBD4', hospital: '#EBDDE0', school: '#E6E4CC',
    roadMinor: '#6E7681', roadMinorCase: '#C9CDC6', roadMid: '#646C78', roadMidCase: '#C2C6BF',
    roadMain: '#5B636F', roadMainCase: '#BFC3BC', roadMajor: '#525A66', roadMajorCase: '#B8BCB5', roadLine: '#F5FAFF', roadEdge: '#C8CCCD', roadEdge: '#DDE3E6',
    rail: '#8F96A0', path: '#C9CDC6', pathPed: '#6F7C94', steps: '#C47A1E', cycle: '#1E9E73', boundary: '#9AA6B5',
    label: '#2A3648', labelMajor: '#111B28', halo: '#F5FAFF', placeCity: '#0B1F38', placeTown: '#26364E',
  },
};

const mix = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a); const y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const lerpWidth = (a, b, c) => ['interpolate', ['exponential', 1.5], ['zoom'], 5, a, 12, b, 18, c];
// Szerokość drogi w prawdziwych metrach od z16 w górę: przy kamerze tuż nad jezdnią ulica ma skalę ulicy.
const meters = (lo, mid, m) => ['interpolate', ['exponential', 2], ['zoom'], 5, lo, 12, mid, 16, Math.max(mid * 2, m / 0.75), 21, m / 0.0234];
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

const H = ['*', ['max', ['coalesce', ['get', 'render_height'], 7], 7], 1.25]; // dane OSM są zaniżone: bez tego miasto wygląda jak makieta
// odmiana budynku: stała dla danej bryły, różna między sąsiadami
const VAR = ['%', ['coalesce', ['id'], 7], 3];
// rodzaj elewacji wg wysokości, wariant wg numeru budynku
const pick = (kind) => ['concat', `fa-${kind}-`, ['to-string', ['%', ['coalesce', ['id'], 7], FACADE_KINDS[kind] || 1]]];
const facadeExpr = () => ['case', ['<', H, 9], pick('house'), ['<', H, 16], pick('tenement'), ['<', H, 32], pick('block'), pick('office')];
export const NAME = ['coalesce', ['get', 'name:pl'], ['get', 'name']];
export const STREET_ROADS = ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]];

// Nowy wygląd: prawdziwe użytkowanie terenu z BDOT10k. Miasto jest miastem, a trawa tylko tam, gdzie naprawdę rośnie.
function groundNew(mode) {
  const n = mode === 'night';
  const col = n
    ? { bg: '#111A29', house: '#141D2A', estate: '#161E2B', paved: '#1B2331', bare: '#161D29', field: '#131C24', wood: '#0F1D20', water: '#0B2C52' }
    : { bg: '#A9AAA2', house: '#94A081', estate: '#9CA291', paved: '#A09E96', bare: '#A39E8C', field: '#A9A47E', wood: '#4F6849', water: '#5F9BCB' };
  const fill = (k, paint) => ({ id: `g-${k}`, type: 'fill', source: 'ground', minzoom: 11, filter: ['==', ['get', 'k'], k], paint });
  return [
    { id: 'ground-land', type: 'background', minzoom: 12, paint: { 'background-color': col.bg, 'background-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, 1] } },
    ...['field', 'bare', 'house', 'estate', 'paved'].map((k) => fill(k, { 'fill-color': col[k] })),
    fill('grass', { 'fill-pattern': 'tx-grass', 'fill-opacity': n ? 0.8 : 0.85 }),
    fill('wood', { 'fill-color': col.wood }),
    fill('water', { 'fill-color': col.water }),
  ];
}

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
    sources: { omt: { type: 'vector', url: cfg.tilesUrl }, ...(cfg.newLook ? { ground: { type: 'geojson', data: `${cfg.cityBaseNew}ground.json`, tolerance: 0.2, buffer: 8 } } : {}) },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], paint: { 'fill-color': c.wood } },
      { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]], paint: { 'fill-color': c.park, 'fill-opacity': 0.7 } },
      { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]], paint: { 'fill-color': c.land } },
      { id: 'landuse-ind', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['industrial', 'commercial', 'retail']]], paint: { 'fill-color': c.industrial } },
      { id: 'landuse-school', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['school', 'university', 'kindergarten']]], paint: { 'fill-color': c.school } },
      { id: 'landuse-hosp', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'hospital'], paint: { 'fill-color': c.hospital } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      ...(cfg.newLook ? groundNew(mode) : [
        { id: 'ground-land', type: 'background', minzoom: 14, paint: { 'background-pattern': 'tx-grass' } },
        { id: 'ground-paved', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 14, filter: ['in', ['get', 'class'], ['literal', ['industrial', 'commercial', 'retail', 'school', 'university', 'hospital']]], paint: { 'fill-pattern': 'tx-pave' } },
      ]),
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': c.waterLine, 'line-width': lerpWidth(0.4, 1.2, 4) } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': c.rail, 'line-width': lerpWidth(0.4, 0.8, 2), 'line-dasharray': [3, 2] } },

      ...pathLayers(road, c, travel),
      road('minor-case', ['minor', 'service'], c.roadMinorCase, meters(0.3, 2.4, 7.4)),
      road('minor', ['minor', 'service'], c.roadMinor, meters(0.2, 1.6, 6)),
      road('mid-case', ['tertiary', 'secondary'], c.roadMidCase, meters(0.6, 3.6, 10.6)),
      road('mid', ['tertiary', 'secondary'], c.roadMid, meters(0.4, 2.6, 9)),
      road('main-case', ['primary'], c.roadMainCase, meters(1, 4.4, 13.8)),
      road('main', ['primary'], c.roadMain, meters(0.8, 3.2, 12)),
      road('major-case', ['motorway', 'trunk'], c.roadMajorCase, meters(1.4, 5.2, 20)),
      road('major', ['motorway', 'trunk'], c.roadMajor, meters(1.1, 3.8, 18)),
      ...(cfg.newLook ? [
        { ...road('sidewalk', ['minor'], c.roadMinorCase, meters(0.3, 2.4, 11), { 'line-pattern': 'tx-pave' }), minzoom: 15 },
        { ...road('sidewalk-mid', ['tertiary', 'secondary'], c.roadMinorCase, meters(0.3, 2.4, 15), { 'line-pattern': 'tx-pave' }), minzoom: 15 },
        { ...road('sidewalk-main', ['primary'], c.roadMinorCase, meters(0.3, 2.4, 18), { 'line-pattern': 'tx-pave' }), minzoom: 15 },
      ] : [{ ...road('sidewalk', ['minor', 'tertiary', 'secondary', 'primary'], c.roadMinorCase, meters(0.3, 2.4, 13), { 'line-pattern': 'tx-pave' }), minzoom: 15 }]),
      { ...road('road-edge-minor', ['minor', 'service'], c.roadEdge, meters(0.3, 2.4, cfg.newLook ? 6.5 : 7)), minzoom: 15 },
      { ...road('road-edge-mid', ['tertiary', 'secondary'], c.roadEdge, meters(0.5, 3.2, cfg.newLook ? 9.6 : 10.2)), minzoom: 15 },
      { ...road('road-edge-main', ['primary'], c.roadEdge, meters(1, 4, cfg.newLook ? 12.6 : 13.2)), minzoom: 15 },
      { ...road('road-edge-major', ['motorway', 'trunk'], c.roadEdge, meters(1.3, 4.6, cfg.newLook ? 18.6 : 19.2)), minzoom: 15 },
      { ...road('asphalt-minor', ['minor', 'service'], c.roadMinor, meters(0.2, 1.6, 6), { 'line-pattern': 'tx-asphalt' }), minzoom: 15 },
      { ...road('asphalt-mid', ['tertiary', 'secondary'], c.roadMid, meters(0.4, 2.6, 9), { 'line-pattern': 'tx-asphalt' }), minzoom: 15 },
      { ...road('asphalt-main', ['primary'], c.roadMain, meters(0.8, 3.2, 12), { 'line-pattern': 'tx-asphalt' }), minzoom: 15 },
      { ...road('asphalt-major', ['motorway', 'trunk'], c.roadMajor, meters(1.1, 3.8, 18), { 'line-pattern': 'tx-asphalt' }), minzoom: 15 },
      { ...road('lane-line', ['tertiary', 'secondary', 'primary', 'trunk'], c.roadLine, ['interpolate', ['exponential', 2], ['zoom'], 15, 0.4, 21, 14], { 'line-dasharray': [6, 9], 'line-opacity': 0.85 }), minzoom: 15, layout: { 'line-cap': 'butt', 'line-join': 'round' } },

      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, maxzoom: 15.5, paint: { 'fill-color': c.building, 'fill-opacity': 0.9 } },
      {
        id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14.5,
        paint: {
          'fill-extrusion-pattern': facadeExpr(),
          'fill-extrusion-height': H,
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 1,
        },
      },
      // dach: cienka warstwa na wierzchu bryły, żeby tekstura okien nie wchodziła na dach
      {
        id: 'building-roof', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14.5,
        paint: {
          'fill-extrusion-color': ['match', VAR, 0, c.roofA, 1, c.roofB, c.roofC],
          'fill-extrusion-height': ['+', H, 0.4],
          'fill-extrusion-base': H,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false,
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
        // podczas jazdy: nazwy stoją do oka kierowcy, główne ulice większe od małych
        id: 'street-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
        filter: STREET_ROADS,
        layout: {
          visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 900, 'text-field': NAME, 'text-font': [cfg.fontBold], 'text-pitch-alignment': 'viewport', 'text-rotation-alignment': 'viewport', 'text-keep-upright': true,
          'text-size': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], 15, 'tertiary', 14, 12], 'text-max-angle': 70, 'text-padding': 18, 'text-letter-spacing': 0.02,
        },
        paint: { 'text-color': mode === 'night' ? '#F2F7FF' : '#0E1A2B', 'text-halo-color': mode === 'night' ? '#0B1524' : '#FFFFFF', 'text-halo-width': 2 },
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
