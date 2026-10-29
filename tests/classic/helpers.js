import { Emitter } from '../../src-classic/core/events.js';
import { Economy } from '../../src-classic/core/economy.js';
import { Grid, TERRAIN, createMapGrid } from '../../src-classic/core/grid.js';
import { WallSystem } from '../../src-classic/core/walls.js';
import { MAP, WALLS, ECONOMY } from '../../src-classic/config/game.js';

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

/** Builds a 2x2 block of walls with top-left (x, y); returns the top-left wall. */
export function buildBlock(sim, x, y, type = 'stone') {
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sim.walls.build(type, x + dx, y + dy);
  return sim.walls.at(x, y);
}

/** Open w x h grid (all OPEN terrain). */
export function openGrid(w, h) {
  const g = new Grid(w, h);
  g.terrain.fill(TERRAIN.OPEN);
  return g;
}
