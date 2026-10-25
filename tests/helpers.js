import { Emitter } from '../src/core/events.js';
import { Economy } from '../src/core/economy.js';
import { Grid, TERRAIN, createMapGrid } from '../src/core/grid.js';
import { WallSystem } from '../src/core/walls.js';
import { MAP, WALLS, ECONOMY } from '../src/config/game.js';

/** Fresh world on the real map layout. Collects emitted events in `log`. */
export function makeWorld({ gold = 1000, map = MAP } = {}) {
  const events = new Emitter();
  const log = [];
  for (const t of ['wallAdded', 'wallRemoved', 'goldChanged', 'actionRejected']) {
    events.on(t, (p) => log.push({ t, p }));
  }
  const grid = createMapGrid(map);
  const economy = new Economy(gold, events);
  const walls = new WallSystem(grid, economy, WALLS, events, ECONOMY);
  return { events, log, grid, economy, walls };
}

/** Open w x h grid (all OPEN terrain). */
export function openGrid(w, h) {
  const g = new Grid(w, h);
  g.terrain.fill(TERRAIN.OPEN);
  return g;
}
