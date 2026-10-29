import { Grid, TERRAIN } from '../src/core/grid.js';

/** Open w x h grid (all OPEN terrain). */
export function openGrid(w, h) {
  const g = new Grid(w, h);
  g.terrain.fill(TERRAIN.OPEN);
  return g;
}
