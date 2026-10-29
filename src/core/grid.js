// Battlefield grid of one map. Cell (x, y): x grows east, y grows south (north = y 0).
// World position of a cell centre is (x + 0.5, 0, y + 0.5). Roads are polylines in world
// units (see paths.js); cells near a road's centre line are ROAD and cannot carry towers.
import { buildPath, distanceToPath } from './paths.js';

export const TERRAIN = {
  OPEN: 0, // buildable, walkable
  BLOCKED: 1, // rocks: neither
  ROAD: 2, // the zombies' road: walkable, not buildable
  HOUSE: 3, // the house: neither
  WATER: 4, // river: neither
};

export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.terrain = new Uint8Array(width * height);
    /** Tower id standing on each cell, 0 = none. */
    this.towerId = new Int32Array(width * height);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x, y) {
    return y * this.width + x;
  }

  terrainAt(x, y) {
    return this.terrain[this.index(x, y)];
  }

  towerAt(x, y) {
    return this.inBounds(x, y) ? this.towerId[this.index(x, y)] : 0;
  }

  /** Free ground a tower can stand on. */
  isBuildable(x, y) {
    return this.inBounds(x, y) && this.terrainAt(x, y) === TERRAIN.OPEN && !this.towerAt(x, y);
  }

  /** Ground the runner can walk on (towers do not block him: he squeezes past). */
  isWalkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrainAt(x, y);
    return t === TERRAIN.OPEN || t === TERRAIN.ROAD;
  }
}

/**
 * Builds the grid and road paths of a map (config/maps.js).
 * @returns {{grid: Grid, paths: object[], house: {x:number, z:number, cells:{x,y}[]}}}
 */
export function buildMap(map, rules) {
  const grid = new Grid(rules.width, rules.height);
  const paths = map.roads.map((r, i) => ({ ...buildPath(r.points), id: i, from: r.from ?? 1, weight: r.weight ?? 1 }));
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const d = Math.min(...paths.map((p) => distanceToPath(p, x + 0.5, y + 0.5)));
      if (d <= rules.roadHalfWidth) grid.terrain[grid.index(x, y)] = TERRAIN.ROAD;
    }
  }
  for (const [x0, y0, x1, y1] of map.water ?? []) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (grid.inBounds(x, y) && grid.terrainAt(x, y) !== TERRAIN.ROAD) grid.terrain[grid.index(x, y)] = TERRAIN.WATER;
      }
    }
  }
  for (const [x, y] of map.blocked ?? []) {
    if (grid.inBounds(x, y) && grid.terrainAt(x, y) === TERRAIN.OPEN) grid.terrain[grid.index(x, y)] = TERRAIN.BLOCKED;
  }
  const hx = map.house.x, hz = map.house.z;
  const cells = [];
  for (let y = hz - 1; y <= hz; y++) {
    for (let x = hx - 1; x <= hx; x++) {
      if (!grid.inBounds(x, y)) continue;
      grid.terrain[grid.index(x, y)] = TERRAIN.HOUSE;
      cells.push({ x, y });
    }
  }
  return { grid, paths, house: { x: hx, z: hz, cells } };
}
