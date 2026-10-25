// Battlefield grid. Cell (x, y): x grows east, y grows south (north = y 0).
// World position of a cell center is (x + 0.5, 0, y + 0.5).

export const TERRAIN = {
  OPEN: 0, // buildable, walkable
  BLOCKED: 1, // rocks/ruins: not buildable, not walkable
  SPAWN: 2, // walkable, not buildable
  CASTLE: 3, // castle wall/interior: not buildable, not walkable
  GATE: 4, // the fortress gate cell: zombies' goal
};

export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.terrain = new Uint8Array(width * height);
    /** Wall id occupying each cell, 0 = none. */
    this.wallId = new Int32Array(width * height);
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

  wallAt(x, y) {
    return this.inBounds(x, y) ? this.wallId[this.index(x, y)] : 0;
  }

  /** True when terrain alone lets units stand here (walls are handled separately). */
  isWalkableTerrain(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrainAt(x, y);
    return t === TERRAIN.OPEN || t === TERRAIN.SPAWN || t === TERRAIN.GATE;
  }
}

/** Builds the grid for the configured map layout. */
export function createMapGrid(map) {
  const grid = new Grid(map.width, map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      let t = TERRAIN.OPEN;
      if (y < map.spawnRows) t = TERRAIN.SPAWN;
      else if (y >= map.castleWallRow) t = TERRAIN.CASTLE;
      grid.terrain[grid.index(x, y)] = t;
    }
  }
  grid.terrain[grid.index(map.gateX, map.castleWallRow)] = TERRAIN.GATE;
  for (const [x, y] of map.blocked) {
    if (grid.inBounds(x, y) && grid.terrainAt(x, y) === TERRAIN.OPEN) {
      grid.terrain[grid.index(x, y)] = TERRAIN.BLOCKED;
    }
  }
  return grid;
}
