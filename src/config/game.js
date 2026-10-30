// Central gameplay configuration. Systems read numbers from here, never hard-code them.
// The battlefields live in maps.js, enemies in enemies.js, towers in towers.js and the
// ammo runner with his spells and perks in runner.js.

export { MAPS, MAP_RULES, mapById } from './maps.js';
export { ZOMBIES, ELITE, WAVE_TABLE, WAVE_VARIANTS } from './enemies.js';
export { TOWERS, TOWER_RULES, TARGETING } from './towers.js';
export { RUNNER, SPELLS, SPELL_RANK, RUNNER_PERKS } from './runner.js';
export { RARITIES, RARITY_INFO } from './rarities.js';

export const ECONOMY = {
  startingGold: 300,
  /** Tower and upgrade prices while a wave is being fought. */
  combatBuildMultiplier: 1.1,
};

/** The house the player protects. If it falls, the run is over. */
export const HOUSE = {
  /** Every zombie that reaches the house takes its `damage` off this (lives, in effect). */
  maxHp: 100,
  /** House HP fraction below which the HUD warns. */
  warnAt: 0.35,
  /** Repair (between waves only): gold per missing HP. */
  repairCostPerHp: 4,
};

/** Run-wide bonuses from the Commander that the simulation reads (core/commander.js fills them). */
export const BONUS = { killGoldPct: 0, artifactLuckPct: 0, towerSlotAdd: 0 };

export const WAVES = {
  /** Seconds before wave 1 starts on its own (the player can start it earlier). */
  firstPrepTime: 60,
  /** Seconds of preparation between waves. */
  prepTime: 25,
  /** Seconds between spawns at wave 1, shrinking toward minSpawnInterval. */
  spawnInterval: 1.15,
  spawnIntervalDecay: 0.05,
  minSpawnInterval: 0.3,
  /**
   * Stragglers: enemies still alive this long after a wave finished spawning become
   * enraged (faster, immune to knockback) so a wave can never be stalled forever.
   */
  enrageAfter: 45,
  enrageSpeedMult: 1.6,
  /** Gold for clearing a wave: base + perWave * wave. */
  clearBonusBase: 35,
  clearBonusPerWave: 12,
};

export const SCORE = {
  perKillGold: 1, // score += reward gold of each kill x this
  perWaveCleared: 250,
};

/** Knockback and air time (Gale tower, rolling stones). */
export const PHYSICS = {
  gravity: 22,
  /** How fast a shove along the road dies out (per second). */
  friction: 2.5,
  /** Bosses and elites only take this fraction of a shove. */
  bossResist: 0.15,
  eliteResist: 0.6,
  /** Each recent shove makes the next one weaker; stacks fade at shoveRecovery per second. */
  shoveResist: 0.5,
  shoveRecovery: 0.7,
  /** Fall damage: fraction of max HP per cell of fall height (from 1 cell up). */
  fallDamagePct: 0.05,
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
