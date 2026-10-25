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
  /** Construction and repair cost multiplier while a wave is in progress. */
  combatBuildMultiplier: 1.25,
  /** Repair cost = missing HP fraction x build cost x this factor. */
  repairCostFactor: 0.6,
  /** Fraction of a hero's total investment returned on dismissal. */
  heroRefund: 0.5,
};

export const FORTRESS = {
  gateMaxHp: 1500,
  /** Gate HP fraction below which the HUD warns that the fortress is in danger. */
  warnAt: 0.35,
};

/**
 * Zombie types. Speeds are cells per second; attackInterval is seconds between hits.
 * reward is gold granted exactly once on death; xp is shared among heroes that hurt it.
 */
export const ZOMBIES = {
  walker: {
    name: 'Walker',
    hp: 60,
    /** Fraction of physical damage ignored (armor penetration lowers it). */
    armor: 0,
    /** Fraction of magic damage ignored (holy ignores it). */
    resist: 0,
    speed: 0.6,
    wallDamage: 12,
    attackInterval: 1.2,
    reward: 4,
    xp: 10,
    model: 'walker',
    tint: null,
    scale: 1,
  },
};

// Hero classes, rules and targeting modes live in heroes.js.
export { HEROES, HERO_RULES, TARGETING } from './heroes.js';

export const WAVES = {
  /** Seconds before wave 1 starts on its own (the player can start it earlier). */
  firstPrepTime: 60,
  /** Seconds of preparation between waves. */
  prepTime: 25,
  /** Walker count = base + perWave * (wave - 1). */
  walkerBase: 8,
  walkerPerWave: 4,
  /** Enemy HP multiplier grows linearly per wave: 1 + hpGrowth * (wave - 1). */
  hpGrowth: 0.12,
  /** Seconds between spawns at wave 1, shrinking toward minSpawnInterval. */
  spawnInterval: 1.1,
  spawnIntervalDecay: 0.06,
  minSpawnInterval: 0.25,
  /** Gold for clearing a wave: base + perWave * wave. */
  clearBonusBase: 30,
  clearBonusPerWave: 10,
};

export const SCORE = {
  perKillGold: 1, // score += reward gold of each kill x this
  perWaveCleared: 250,
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
