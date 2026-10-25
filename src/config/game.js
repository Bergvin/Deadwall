// Central gameplay configuration. Systems read numbers from here, never hard-code them.

export const MAP = {
  width: 30,
  height: 24,
  /** Rows 0..spawnRows-1 are the zombie spawn zone (north). */
  spawnRows: 3,
  /** The castle's outer wall row; rows below it are the castle interior. */
  castleWallRow: 21,
  /** Gate column in the castle wall row. */
  gateX: 15,
  /** Impassable, unbuildable terrain (rocks, ruins). [x, y] cell pairs. */
  blocked: [
    [4, 7], [5, 7], [4, 8],
    [24, 6], [25, 6],
    [9, 13], [20, 12], [21, 12], [21, 13],
    [2, 16], [27, 17],
  ],
};

export const ECONOMY = {
  startingGold: 400,
  /** Fraction of the build cost returned when selling a wall, scaled by its health ratio. */
  sellRefund: 0.5,
};

/** Wall types. Phase 1 has only Stone; the rest arrive in phase 4. */
export const WALLS = {
  stone: {
    name: 'Stone Wall',
    cost: 20,
    maxHp: 300,
    heroCapacity: 1,
    description: 'Affordable basic wall. Moderate health, holds one hero.',
  },
};

export const PATHING = {
  /** Extra path cost for routing through a wall instead of around it (zombies attack it). */
  wallBaseCost: 12,
  /** Additional cost per wall hit point, so stronger walls are avoided more. */
  wallCostPerHp: 0.02,
};

export const CAMERA = {
  pitchDeg: 55,
  yawDeg: 0,
  distance: 50,
  /** Orthographic view height in world units: [min, default, max]. */
  zoom: [7, 25, 34],
  panSpeed: 14, // world units per second at default zoom
  dragThresholdPx: 5,
};
