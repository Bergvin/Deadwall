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
  startingGold: 450,
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
  /** Reinforcing the gate: each level adds maxHp (and heals that much). Costs escalate. */
  reinforce: [
    { cost: 150, addHp: 600 },
    { cost: 300, addHp: 800 },
    { cost: 550, addHp: 1000 },
  ],
  /** Gate repair: gold per missing HP (the gate is more expensive to fix than walls). */
  repairCostPerHp: 0.35,
};

// Zombie, boss, elite and wave-composition config lives in enemies.js.
export { ZOMBIES, ELITE, WAVE_TABLE, WAVE_VARIANTS } from './enemies.js';

/** Run-wide bonuses from the Commander that the simulation reads (core/commander.js fills them). */
export const BONUS = { killGoldPct: 0, artifactLuckPct: 0 };

// Hero classes, rules and targeting modes live in heroes.js.
export { HEROES, HERO_RULES, TARGETING } from './heroes.js';
// Elemental towers and the champion hero rules live in towers.js.
export { TOWERS, TOWER_RULES, CHAMPION } from './towers.js';

export const WAVES = {
  /** Seconds before wave 1 starts on its own (the player can start it earlier). */
  firstPrepTime: 60,
  /** Seconds of preparation between waves. */
  prepTime: 25,
  /** Enemy counts, bosses and scaling are in enemies.js (WAVE_TABLE). */
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

/**
 * Wall types. All share the same modular pieces so mixed lines connect; each type has its
 * own tint and decorations (see render/wallView.js). Every wall can carry one tower, and
 * a 2x2 block of walls carries the champion hero (heroCapacity is per-wall occupancy).
 * armor: fraction of zombie damage ignored. thorns: damage per second dealt to every zombie
 * attacking it. arcane: aura that slows and pulses magic damage.
 */
export const WALLS = {
  stone: {
    name: 'Stone Wall', short: 'Stone',
    cost: 20, maxHp: 300, heroCapacity: 1, armor: 0,
    description: 'Affordable basic wall. Moderate health, can carry a tower.',
  },
  reinforced: {
    name: 'Reinforced Wall', short: 'Reinforced',
    cost: 45, maxHp: 750, heroCapacity: 1, armor: 0.2,
    description: 'Timber and iron braced. Very durable and resists heavy blows: the best base for towers.',
  },
  spiked: {
    name: 'Spiked Wall', short: 'Spiked',
    cost: 35, maxHp: 380, heroCapacity: 1, armor: 0,
    thorns: 6,
    description: 'Iron spikes wound every zombie that attacks it. Great against hordes.',
  },
  arcane: {
    name: 'Arcane Wall', short: 'Arcane',
    cost: 90, maxHp: 500, heroCapacity: 1, armor: 0.05,
    arcane: { radius: 2.2, slow: 0.6, pulseDamage: 18, pulseInterval: 2.5 },
    description: 'Glowing runes slow nearby zombies and pulse magic damage at them.',
  },
};

/**
 * Wall upgrades (levels 2 and 3). Cost is a multiple of the wall's base cost; each level
 * raises max HP and strengthens the type's special effect.
 */
export const WALL_UPGRADES = {
  maxLevel: 3,
  costMult: [0.9, 1.6],
  hpMult: 1.35,
  thornsMult: 1.5,
  arcaneDamageMult: 1.4,
  arcaneRadiusAdd: 0.3,
};

export const PATHING = {
  /** Extra path cost for routing through a wall instead of around it (zombies attack it). */
  wallBaseCost: 12,
  /** Additional cost per wall hit point, so stronger walls are avoided more. */
  wallCostPerHp: 0.02,
};

/** Game speed buttons in the top bar (multipliers of the simulation clock). */
export const GAME_SPEEDS = [1, 3, 5];

export const CAMERA = {
  pitchDeg: 55,
  yawDeg: 0,
  distance: 50,
  /** Orthographic view height in world units: [min, default, max]. */
  zoom: [7, 25, 34],
  panSpeed: 14, // world units per second at default zoom
  dragThresholdPx: 5,
};
