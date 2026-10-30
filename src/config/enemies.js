// Zombie and boss types. They walk the roads to the house. Speeds are cells per second;
// damage is what one zombie that reaches the house takes off it (then it is gone); a Tower
// Smasher's attackInterval is the time between its blows on a tower. reward is gold granted exactly once
// on death; xp goes to the runner. armor reduces physical damage, resist reduces magic and
// fire damage (fractions).
//
// model refers to config/assets.js; scale and tint change the look of a shared model.
// Behaviour flags are read by core/zombies.js.
//
// Traits (like camo, lead and purple bloons in Bloons TD): towers are good against some
// enemies and useless against others.
//   stealth    invisible: only towers that detect (Watchtower, Arcane Seer, Arrow Sniper)
//              can aim at it, or any tower once a Watchtower has revealed it. Splash still hits.
//   immune     damage types that do nothing at all (Ghost: physical)
//   immuneTags attack tags that bounce off (Ironclad: 'sharp' = arrows and gusts)
//   regen      {pct, delay}: regains pct of max HP per second after `delay` s without
//              damage; poison on it stops the regeneration

export const ZOMBIES = {
  walker: {
    name: 'Walker',
    description: 'Slow, steady and numerous.',
    hp: 60, armor: 0, resist: 0,
    speed: 0.75,
    damage: 5, attackInterval: 1.2,
    reward: 4, xp: 10,
    model: 'walker', scale: 1, tint: null,
  },
  runner: {
    name: 'Runner',
    description: 'Fast and fragile. Slow it down or it is at the door in no time.',
    hp: 34, armor: 0, resist: 0,
    speed: 1.7,
    damage: 3, attackInterval: 0.8,
    reward: 5, xp: 10,
    model: 'runner', scale: 0.95, tint: [1.1, 0.95, 0.9],
  },
  brute: {
    name: 'Brute',
    description: 'Huge and heavily armored. Arrows bounce off: use fire, frost or boulders.',
    hp: 320, armor: 0.6, resist: 0.1,
    speed: 0.5,
    damage: 15, attackInterval: 1.6,
    reward: 18, xp: 45,
    model: 'brute', scale: 1.45, tint: [0.95, 0.85, 0.8],
  },
  plague: {
    name: 'Plague Carrier',
    description: 'Resists magic and fire. Dies in a toxic cloud that gums up nearby towers and slows your runner.',
    hp: 120, armor: 0.1, resist: 0.6,
    speed: 0.65,
    damage: 8, attackInterval: 1.4,
    reward: 10, xp: 25,
    model: 'plague', scale: 1.05, tint: [0.65, 1.25, 0.55],
    /** On death: a cloud where towers attack slower and the runner is slowed. */
    cloud: { radius: 1.8, duration: 7, towerSlow: 0.5, runnerSlow: 0.5 },
  },
  siege: {
    name: 'Tower Smasher',
    description: 'Stops by towers near the road and smashes them: their ammo spills and they jam.',
    hp: 260, armor: 0.3, resist: 0,
    speed: 0.55,
    damage: 12, attackInterval: 1.8,
    reward: 20, xp: 50,
    model: 'brute', scale: 1.3, tint: [1.2, 0.6, 0.45],
    /** Attacks towers within `range` of it: each hit drains ammo and jams; moves on after `hits`. */
    smasher: { range: 2.2, hits: 3, ammoDrain: 0.35, jam: 2 },
  },
  wraith: {
    name: 'Wraith',
    description: 'Invisible. Only towers that detect can see it: build a Watchtower nearby.',
    hp: 70, armor: 0, resist: 0.2,
    speed: 1.0,
    damage: 6, attackInterval: 1,
    reward: 9, xp: 18,
    model: 'runner', scale: 1, tint: [0.55, 0.42, 0.9],
    stealth: true,
  },
  ghost: {
    name: 'Ghost',
    description: 'Arrows, boulders and rolling stones pass straight through. Use magic, fire or poison.',
    hp: 90, armor: 0, resist: 0,
    speed: 0.8,
    damage: 6, attackInterval: 1.2,
    reward: 9, xp: 18,
    model: 'walker', scale: 0.95, tint: [0.8, 1.15, 1.45],
    immune: ['physical'],
  },
  ironclad: {
    name: 'Ironclad',
    description: 'Iron plates: arrows and gusts bounce off. Boulders, fire, magic and poison work.',
    hp: 200, armor: 0.3, resist: 0,
    speed: 0.55,
    damage: 12, attackInterval: 1.6,
    reward: 15, xp: 35,
    model: 'brute', scale: 1.25, tint: [0.72, 0.78, 0.9],
    immuneTags: ['sharp'],
  },
  rotter: {
    name: 'Rotter',
    description: 'Its flesh grows back when it is left alone. Poison stops the regrowth.',
    hp: 140, armor: 0.1, resist: 0.1,
    speed: 0.7,
    damage: 8, attackInterval: 1.4,
    reward: 10, xp: 22,
    model: 'walker', scale: 1.05, tint: [0.75, 0.95, 0.5],
    regen: { pct: 0.08, delay: 1.5 },
  },

  // Bosses: one every few waves (see WAVE_TABLE.bossEvery). Abilities run on their own timers.
  behemoth: {
    name: 'Rotting Behemoth',
    boss: true,
    description: 'A mountain of rot that spits out more dead as it walks.',
    hp: 750, armor: 0.25, resist: 0.2,
    speed: 0.42,
    damage: 25, attackInterval: 2,
    reward: 250, xp: 400,
    model: 'behemoth', scale: 1, tint: [0.8, 1.05, 0.75],
    summon: { type: 'walker', count: 4, interval: 9 },
  },
  gravelord: {
    name: 'Gravelord',
    boss: true,
    description: 'Empowers the undead around it: faster and harder hitting.',
    hp: 700, armor: 0.2, resist: 0.35,
    speed: 0.5,
    damage: 22, attackInterval: 1.6,
    reward: 250, xp: 400,
    model: 'gravelord', scale: 1, tint: [1.1, 0.8, 0.9],
    empower: { radius: 4, speedMult: 1.35, damageMult: 1.4, duration: 6, interval: 12 },
  },

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
    { type: 'walker', from: 1, base: 10, perWave: 3 },
    { type: 'runner', from: 2, base: 3, perWave: 2 },
    { type: 'brute', from: 4, base: 1, perWave: 0.7 },
    { type: 'plague', from: 6, base: 1, perWave: 0.5 },
    { type: 'siege', from: 7, base: 1, perWave: 0.5 },
    { type: 'ironclad', from: 7, base: 1, perWave: 0.4 },
    { type: 'ghost', from: 8, base: 2, perWave: 0.5 },
    { type: 'wraith', from: 10, base: 2, perWave: 0.5 },
    { type: 'rotter', from: 12, base: 1, perWave: 0.5 },
  ],
  bossEvery: 5,
  bosses: ['behemoth', 'gravelord'],
  /**
   * Enemy HP multiplier: hpBase * (1 + hpGrowth * (n - 1) + hpGrowthLate * (n - 1)^2)
   * * exp(hpGrowthExp * (n - 1)). Towers grow by upgrades bought with the wave's gold, so a
   * gentle exponential keeps every run finite. Damage (to the house when one gets through):
   * damageBase * (1 + damageGrowth * (n - 1)). Tuned with tools/simulate.js.
   */
  hpBase: 1,
  hpGrowth: 0.18,
  hpGrowthLate: 0.02,
  hpGrowthExp: 0.12,
  damageBase: 1,
  damageGrowth: 0.03,
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
