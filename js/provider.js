// Dostawca tras: własny Valhalla (jeśli adres ustawiony), a gdy zawiedzie – publiczny OSRM.
import { fetchRoutes, parseRoutes } from './routing.js';
import { fetchValhallaRoutes } from './valhalla.js';

export async function getRoutes(cfg, points, opts = {}) {
  if (cfg.routingOwnUrl) {
    try {
      const osrm = await fetchValhallaRoutes(cfg.routingOwnUrl, points, { costing: opts.costing || 'auto', alternatives: opts.alternatives !== false });
      return parseRoutes(osrm);
    } catch (e) {
      if (opts.costing && opts.costing !== 'auto') throw e; // pieszo/rower: publiczny OSRM nie zastąpi
    }
  }
  return fetchRoutes(cfg.routingUrl, points, opts);
}
