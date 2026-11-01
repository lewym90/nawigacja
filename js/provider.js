// Dostawca tras: własny Valhalla (jeśli adres ustawiony), a gdy zawiedzie – publiczny OSRM.
import { fetchRoutes, parseRoutes } from './routing.js';
import { fetchValhallaRoutes } from './valhalla.js';

export async function getRoutes(cfg, points, opts = {}) {
  if (cfg.routingOwnUrl) {
    try {
      const osrm = await fetchValhallaRoutes(cfg.routingOwnUrl, points, { costing: opts.costing || 'auto', alternatives: opts.alternatives !== false, heading: opts.heading, pref: opts.pref });
      const rs = parseRoutes(osrm);
      rs.meta = { engine: 'valhalla', costing: opts.costing || 'auto', from: points[0], to: points[points.length - 1], heading: opts.heading ?? null, avoid: osrm.avoid || null };
      return rs;
    } catch (e) {
      if (opts.costing && opts.costing !== 'auto') throw e; // pieszo/rower: publiczny OSRM nie zastąpi
    }
  }
  const rs = await fetchRoutes(cfg.routingUrl, points, opts);
  rs.meta = { engine: 'osrm', costing: 'auto', from: points[0], to: points[points.length - 1] };
  return rs;
}
