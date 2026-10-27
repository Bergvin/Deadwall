// Zombie and boss types. Speeds are cells per second; attackInterval is seconds between
// hits. reward is gold granted exactly once on death; xp is shared among the heroes that
// hurt it. armor reduces physical damage, resist reduces magic damage (fractions).
//
// model refers to config/assets.js; scale and tint change the look of a shared model.
// Behaviour flags are read by core/zombies.js.

export const ZOMBIES = {
  walker: {
    name: 'Walker',
    description: 'Slow, steady and numerous.',
    hp: 60, armor: 0, resist: 0,
    speed: 0.6,
    wallDamage: 12, attackInterval: 1.2,
    reward: 4, xp: 10,
    model: 'walker', scale: 1, tint: null,
  },
  runner: {
    name: 'Runner',
    description: 'Fast and fragile. Races for weak spots and breaches.',
    hp: 35, armor: 0, resist: 0,
    speed: 1.5,
    wallDamage: 6, attackInterval: 0.8,
    reward: 5, xp: 10,
    model: 'runner', scale: 0.95, tint: [1.1, 0.95, 0.9],
  },
  brute: {
    name: 'Brute',
    description: 'Huge, armored and devastating against walls. Pierce its armor.',
    hp: 320, armor: 0.45, resist: 0.1,
    speed: 0.38,
    wallDamage: 40, attackInterval: 1.6,
    reward: 18, xp: 45,
    model: 'brute', scale: 1.45, tint: [0.95, 0.85, 0.8],
  },
  plague: {
    name: 'Plague Carrier',
    description: 'Poisons heroes near it and leaves toxic ground where it strikes or dies.',
    hp: 110, armor: 0.1, resist: 0.2,
    speed: 0.55,
    wallDamage: 10, attackInterval: 1.4,
    reward: 10, xp: 25,
    model: 'plague', scale: 1.05, tint: [0.65, 1.25, 0.55],
    /** Heroes within auraRadius take auraDps (poison). */
    plague: { auraRadius: 2, auraDps: 3, puddleRadius: 1.4, puddleDps: 5, puddleDuration: 5, deathPuddleDuration: 7 },
  },
  siege: {
    name: 'Siege Zombie',
    description: 'Smashes straight through walls toward the gate. Shreds reinforced walls.',
    hp: 260, armor: 0.25, resist: 0,
    speed: 0.45,
    wallDamage: 70, attackInterval: 1.8,
    reward: 20, xp: 50,
    model: 'brute', scale: 1.3, tint: [1.2, 0.6, 0.45],
    /** Routes with a much lower wall cost, so it bulldozes the direct line to the gate. */
    siege: { wallBaseCost: 1.5, wallCostPerHp: 0.004, reinforcedBonus: 1.5 },
  },

  // Bosses: one every few waves (see WAVES.bossEvery). Abilities run on their own timers.
  behemoth: {
    name: 'Rotting Behemoth',
    boss: true,
    description: 'Smashes several wall sections at once and spits out more dead.',
    hp: 1050, armor: 0.25, resist: 0.2,
    speed: 0.35,
    wallDamage: 60, attackInterval: 2,
    reward: 250, xp: 400,
    model: 'behemoth', scale: 1, tint: [0.8, 1.05, 0.75],
    /** Wall hits also damage orthogonal neighbours of the target at this fraction. */
    smashSplash: 0.6,
    summon: { type: 'walker', count: 5, interval: 12 },
  },
  gravelord: {
    name: 'Gravelord',
    boss: true,
    description: 'Empowers the undead around it and charges the weakest wall.',
    hp: 1100, armor: 0.2, resist: 0.35,
    speed: 0.45,
    wallDamage: 50, attackInterval: 1.6,
    reward: 250, xp: 400,
    model: 'gravelord', scale: 1, tint: [1.1, 0.8, 0.9],
    empower: { radius: 4, speedMult: 1.35, damageMult: 1.4, duration: 6, interval: 14 },
    /** Routes toward the weakest wall: wall path cost scales with remaining health. */
    charge: { wallBaseCost: 2, wallCostPerHp: 0.002, speedMult: 1.6 },
  },

  // Wanderers: rare, very tough creatures that cross the field from west to east between
  // waves. They pass through walls, never attack and are gone once they reach the east edge.
  // Slaying one drops an artifact from its loot table (config/commander.js LOOT_TABLES).
  wraith: {
    name: 'Wandering Horror',
    description: 'It ignores your walls. Slay it before it leaves the field for an artifact.',
    hp: 1300, armor: 0.2, resist: 0.2,
    speed: 0.7,
    wallDamage: 0, attackInterval: 99,
    reward: 40, xp: 150,
    model: 'gravelord', scale: 0.75, tint: [0.65, 0.85, 1.5],
    wanderer: { loot: 'minor', wobble: 1.2, regenPerSec: 0 },
  },
  colossus: {
    name: 'Dread Colossus',
    description: 'A heavily armored giant that heals as it walks. Rich spoils if you can fell it.',
    hp: 3800, armor: 0.45, resist: 0.25,
    speed: 0.5,
    wallDamage: 0, attackInterval: 99,
    reward: 100, xp: 400,
    model: 'behemoth', scale: 1.1, tint: [0.55, 0.6, 0.75],
    wanderer: { loot: 'major', wobble: 0.8, regenPerSec: 0.01 },
  },
  eclipse: {
    name: 'Eclipse Titan',
    description: 'Ancient, swift and nearly immune to magic. Legends speak of its treasure.',
    hp: 8500, armor: 0.35, resist: 0.55,
    speed: 0.62,
    wallDamage: 0, attackInterval: 99,
    reward: 250, xp: 900,
    model: 'gravelord', scale: 1.25, tint: [0.45, 0.3, 0.7],
    wanderer: { loot: 'mythic', wobble: 1.6, regenPerSec: 0.012 },
  },
};

/**
 * Wanderer sightings: after each cleared wave (from `fromWave`), one Wanderer may appear with
 * probability `chance`. Each type has its own first wave and weight. Wanderers walk along a
 * random row between minRow and maxRow and get the current wave's HP multiplier.
 */
export const WANDERERS = {
  fromWave: 3,
  chance: 0.3,
  maxChance: 0.9,
  minRow: 5,
  maxRow: 15,
  types: [
    { type: 'wraith', fromWave: 3, weight: 6 },
    { type: 'colossus', fromWave: 10, weight: 3 },
    { type: 'eclipse', fromWave: 20, weight: 1.5 },
  ],
};

/** Elite variants: stronger, glowing, worth more. */
export const ELITE = {
  fromWave: 3,
  chance: 0.06,
  chancePerWave: 0.012,
  maxChance: 0.35,
  hpMult: 2.5,
  damageMult: 1.5,
  rewardMult: 3,
  xpMult: 2.5,
  scaleMult: 1.15,
};

/**
 * Wave composition: count of each type in wave n = base + perWave * (n - from), from wave
 * `from` onward. Bosses appear every `bossEvery` waves, alternating between `bosses`.
 */
export const WAVE_TABLE = {
  groups: [
    { type: 'walker', from: 1, base: 10, perWave: 3.5 },
    { type: 'runner', from: 2, base: 3, perWave: 2 },
    { type: 'brute', from: 3, base: 1, perWave: 0.9 },
    { type: 'plague', from: 5, base: 1, perWave: 0.5 },
    { type: 'siege', from: 6, base: 1, perWave: 0.7 },
  ],
  bossEvery: 5,
  bosses: ['behemoth', 'gravelord'],
  /**
   * Enemy HP multiplier: 1 + hpGrowth * (n - 1) + hpGrowthLate * (n - 1)^2 (gentle early,
   * steeper late so endless runs end). Damage: 1 + damageGrowth * (n - 1).
   */
  hpGrowth: 0.13,
  hpGrowthLate: 0.026,
  damageGrowth: 0.06,
};

/**
 * Wave variants. Before each wave one is rolled (weights, from `fromWave`); boss waves and
 * the first `normalUntil` waves are always normal, and a special variant never repeats
 * back to back. A variant reshapes the normal composition:
 *   countMult  - multiplies each type's count (`default` for types not listed; 0 removes)
 *   ensure     - minimum count per type (adds types that are not out yet)
 *   hpMult     - on top of the wave's HP scaling
 *   spawnIntervalMult - < 1 pours them in faster, > 1 slower
 *   rewardMult - gold and XP per kill, so a swarm is not a gold mine
 */
export const WAVE_VARIANTS = {
  normalUntil: 2,
  types: {
    normal: {
      name: 'Wave', label: null, weight: 5, fromWave: 1,
      banner: 'The dead are coming',
    },
    swarm: {
      name: 'Swarm', label: 'SWARM', weight: 2, fromWave: 3,
      banner: 'A tide of fast, frail dead',
      countMult: { walker: 2.5, runner: 3, default: 0 },
      ensure: { runner: 6 },
      hpMult: 0.6,
      spawnIntervalMult: 0.35,
      rewardMult: 0.5,
    },
    chubby: {
      name: 'Chubby Wave', label: 'CHUBBY', weight: 2, fromWave: 4,
      banner: 'Few of them. Very hard to kill.',
      countMult: { brute: 2, siege: 1.6, plague: 1.3, walker: 0.15, runner: 0 },
      ensure: { brute: 3 },
      hpMult: 1.6,
      spawnIntervalMult: 2.5,
      rewardMult: 1.4,
    },
  },
};
