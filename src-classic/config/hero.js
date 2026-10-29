// The hero (one per run): weapons, gear, loot and the level-up ability pool.
//
// The hero starts with a common weapon of the player's choice and no abilities. Every level
// gives one ability pick (three random offers, chosen between waves). Weapons and gear drop
// from enemies during the run (mostly elites and bosses) and are equipped between waves.
// The weapon decides how the hero attacks: its style is one of the HEROES entries (the old
// class configs now act as weapon styles: base stats, attack kind and model).
//
// Balance is deliberately loose: big numbers, wild synergies and the odd broken combo are
// part of the fun. core/heroBuild.js turns weapon + gear + abilities into the hero's stats.

/** Weapon styles: HEROES key -> how it is shown and how it delivers hits. */
export const WEAPON_STYLES = {
  archer: { weapon: 'Bow', delivery: 'projectile', icon: '🏹' },
  crossbowman: { weapon: 'Crossbow', delivery: 'projectile', icon: '⌖' },
  mage: { weapon: 'Staff', delivery: 'projectile', icon: '✦' },
  alchemist: { weapon: 'Flasks', delivery: 'projectile', icon: '⚗' },
  warrior: { weapon: 'Sword', delivery: 'melee', icon: '⚔' },
  paladin: { weapon: 'Mace', delivery: 'melee', icon: '✠' },
};

/** Item names per style/slot and rarity (RARITIES order). */
export const ITEM_NAMES = {
  archer: ['Worn Shortbow', "Hunter's Bow", 'Elven Longbow', 'Stormstring', 'Dragonbone Bow', 'Starfall'],
  crossbowman: ['Rusty Crossbow', 'Militia Arbalest', 'Repeating Crossbow', 'Siegebreaker', 'Heartseeker', 'Godspike'],
  mage: ['Gnarled Staff', 'Apprentice Rod', 'Runed Staff', 'Stormcaller', 'Staff of Embers', 'Worldsplitter'],
  alchemist: ['Cracked Vials', 'Brewer Bandolier', 'Volatile Satchel', 'Plaguebringer Kit', 'Philosopher Flasks', 'Elixir of Ruin'],
  warrior: ['Chipped Sword', 'Soldier Blade', 'Knight Longsword', 'Executioner', 'Dawnbreaker', 'Kingslayer'],
  paladin: ['Wooden Club', 'Iron Mace', 'Blessed Hammer', 'Thunder Maul', 'Hammer of Dawn', 'Wrath of Heaven'],
  armor: ['Padded Vest', 'Leather Jerkin', 'Chainmail', 'Knight Plate', 'Dragonscale', 'Aegis of Ages'],
  trinket: ['Copper Ring', 'Silver Amulet', 'Runed Band', 'Eye of the Storm', 'Phoenix Feather', 'Heart of the World'],
};

/** How rarity scales items. Index = rarity. */
export const ITEM_RARITY = {
  /** Weapon damage multiplier on the style's base damage. */
  weaponDamage: [1, 1.35, 1.8, 2.4, 3.2, 4.4],
  /** Random affixes rolled onto the item. Trinkets get one more. */
  affixes: [0, 1, 2, 2, 3, 4],
  /** Armor base: % more health and % less damage taken. */
  armorHpPct: [15, 25, 40, 60, 85, 120],
  armorReduction: [5, 8, 12, 16, 20, 26],
  /** Legendary and mythical weapons also carry a free ability (rank 1). */
  grantsAbilityFrom: 4,
};

/**
 * Item affixes. `values` per rarity (null = cannot roll at that rarity); `slots` where it can
 * appear; `delivery` limits weapon affixes to projectile or melee weapons. The affix id is
 * the build mod it adds to (see heroBuild.js).
 */
export const AFFIXES = {
  damagePct: { label: (v) => `+${v}% damage`, values: [8, 14, 22, 32, 45, 65], slots: ['weapon', 'trinket'] },
  attackSpeedPct: { label: (v) => `+${v}% attack speed`, values: [6, 10, 16, 22, 30, 42], slots: ['weapon', 'trinket'] },
  critAdd: { label: (v) => `+${v}% critical chance`, values: [4, 6, 9, 12, 16, 22], slots: ['weapon', 'trinket'] },
  critMultAdd: { label: (v) => `+${v}% critical damage`, values: [20, 35, 55, 80, 110, 160], slots: ['weapon', 'trinket'] },
  rangeAdd: { label: (v) => `+${v} range`, values: [0.3, 0.5, 0.8, 1.1, 1.5, 2], slots: ['weapon', 'trinket'] },
  hpPct: { label: (v) => `+${v}% health`, values: [10, 18, 28, 40, 55, 80], slots: ['armor', 'trinket'] },
  damageReduction: { label: (v) => `-${v}% damage taken`, values: [3, 5, 7, 10, 13, 18], slots: ['armor'] },
  burnPct: { label: (v) => `Hits burn for ${v}% of their damage per second`, values: [null, 25, 40, 60, 85, 120], slots: ['weapon', 'trinket'] },
  poisonPct: { label: (v) => `Hits poison for ${v}% of their damage per second`, values: [null, 20, 32, 48, 70, 100], slots: ['weapon', 'trinket'] },
  slowPct: { label: (v) => `Hits slow by ${v}%`, values: [null, 20, 28, 35, 42, 50], slots: ['weapon', 'trinket'] },
  lifestealPct: { label: (v) => `${v}% life steal`, values: [null, 2, 3, 5, 7, 10], slots: ['weapon', 'armor', 'trinket'] },
  goldOnKill: { label: (v) => `+${v} gold per kill`, values: [null, null, 1, 1, 2, 3], slots: ['trinket'] },
  knockback: { label: (v) => `Hits knock enemies back (${v})`, values: [0.6, 0.9, 1.3, 1.8, 2.4, 3.2], slots: ['weapon'] },
  executePct: { label: (v) => `+${v}% damage to enemies under 35% health`, values: [null, 30, 45, 60, 80, 110], slots: ['weapon', 'trinket'] },
  chainChance: { label: (v) => `${v}% chance to arc lightning to 3 enemies`, values: [null, null, 10, 15, 20, 30], slots: ['weapon', 'trinket'] },
  doubleStrike: { label: (v) => `${v}% chance to attack twice`, values: [null, null, null, 12, 18, 25], slots: ['weapon', 'trinket'] },
  aoeAdd: { label: (v) => `Hits explode (+${v} blast radius)`, values: [null, null, 0.4, 0.6, 0.9, 1.3], slots: ['weapon'] },
  pierce: { label: (v) => `Projectiles pierce ${v} more`, values: [null, null, 1, 1, 2, 3], slots: ['weapon'], delivery: 'projectile' },
  bounce: { label: (v) => `Projectiles bounce ${v} more times`, values: [null, null, null, 1, 2, 3], slots: ['weapon'], delivery: 'projectile' },
  split: { label: (v) => `Projectiles split into ${v} shards`, values: [null, null, null, null, 2, 3], slots: ['weapon'], delivery: 'projectile' },
  extraProjectiles: { label: (v) => `+${v} projectiles per attack`, values: [null, null, null, 1, 1, 2], slots: ['weapon'], delivery: 'projectile' },
  meleeRangeAdd: { label: (v) => `+${v} melee reach`, values: [null, null, 0.8, 1.2, 1.8, 2.5], slots: ['weapon'], delivery: 'melee' },
  cleavePct: { label: (v) => `Melee cleaves ${v}% to nearby enemies`, values: [null, 30, 40, 55, 70, 90], slots: ['weapon'], delivery: 'melee' },
};

/** Drops during a run. */
export const LOOT = {
  /** Chance that a kill drops an item, by enemy kind. Bosses drop `bossDrops` items. */
  chance: { normal: 0.004, elite: 0.3, boss: 1 },
  bossDrops: 2,
  /** Which slot a drop is for. */
  slotWeights: { weapon: 4, armor: 3, trinket: 3 },
  /** Rarity weights: base + perWave * wave (clamped); bosses add `bossLuckPct` luck. */
  odds: {
    common: { base: 60, perWave: -2.2, min: 8 },
    uncommon: { base: 28, perWave: 0.4, max: 34 },
    rare: { base: 9, perWave: 0.8, max: 28 },
    epic: { base: 2.5, perWave: 0.5, max: 18 },
    legendary: { base: 0.6, perWave: 0.3, max: 10 },
    mythical: { base: 0.08, perWave: 0.08, max: 4 },
  },
  bossLuckPct: 150,
  eliteLuckPct: 40,
  /** Unequipped items carried; beyond it new drops are sold for gold at once. */
  bagSize: 12,
};

/** Level-up ability offers. */
export const ABILITY_OFFER = {
  size: 3,
  /** Rarity weights per offered card; each hero level adds `luckPerLevel`% luck. */
  weights: { common: 42, uncommon: 28, rare: 16, epic: 9, legendary: 4, mythical: 1.2 },
  luckPerLevel: 2,
  /** Abilities sharing a tag with what the hero already has are this many times likelier. */
  synergyWeight: 3,
  /** Extra weight for upgrading an ability the hero already owns (if not maxed). */
  rankUpWeight: 1.5,
};

/**
 * Active abilities (cast automatically, or by hand from the hero panel). Inherited from the
 * old class abilities plus new physics-flavoured ones. Higher ranks: more damage, shorter
 * cooldown (see heroBuild.activeConfig).
 */
export const HERO_ACTIVES = {
  multishot: { name: 'Multishot', cooldown: 10, target: 'none', description: 'Fires an arrow at each of several enemies in range.', arrows: 5, damageMult: 1.2 },
  piercing: { name: 'Piercing Arrow', cooldown: 12, target: 'point', description: 'A heavy shot that passes through every enemy in a line.', damageMult: 4, width: 0.6, extraLength: 4, speed: 22 },
  fireball: { name: 'Fireball', cooldown: 12, target: 'point', description: 'Explodes, sets the area ablaze and hurls enemies outward.', damage: 70, radius: 1.9, burnDps: 10, burnDuration: 3, speed: 11, blast: 2.2 },
  frostNova: { name: 'Frost Nova', cooldown: 16, target: 'none', description: 'A freezing pulse that slows everything around the hero.', damage: 30, radius: 3.5, slow: 0.45, slowDuration: 4 },
  arcaneBlast: { name: 'Arcane Blast', cooldown: 14, target: 'point', description: 'A concentrated burst of raw magic.', damage: 160, radius: 1.3 },
  shieldBash: { name: 'Shield Bash', cooldown: 8, target: 'none', description: 'Stuns and shoves back everything at the hero\'s feet.', damage: 50, radius: 2, stun: 1.2, blast: 2.5 },
  rally: { name: 'Rally', cooldown: 20, target: 'none', description: 'Walls around the hero take much less damage for a while.', radius: 4.5, reduction: 0.5, duration: 7 },
  apBolt: { name: 'Armor-Piercing Bolt', cooldown: 8, target: 'enemy', description: 'A bolt that ignores armor and hits the toughest enemy hard.', damageMult: 4.5, speed: 20 },
  holyShield: { name: 'Holy Shield', cooldown: 18, target: 'wall', reach: 7, description: 'A wall and its neighbours take far less damage.', reduction: 0.7, duration: 8 },
  consecration: { name: 'Consecration', cooldown: 12, target: 'point', description: 'Holy ground that burns the dead standing on it.', radius: 2, duration: 6, dps: 30 },
  toxicFlask: { name: 'Toxic Flask', cooldown: 11, target: 'point', description: 'A lingering poison cloud.', radius: 2, duration: 8, dps: 22, speed: 9 },
  explosiveMixture: { name: 'Explosive Mixture', cooldown: 13, target: 'point', description: 'A bomb that blows the horde apart and flings it outward.', damage: 120, radius: 2.2, speed: 9, blast: 3.5 },
  shockwave: { name: 'Shockwave', cooldown: 14, target: 'none', description: 'Slams the ground: everything nearby is launched into the air and lands far away.', damage: 60, radius: 3.5, blast: 5, lift: 6 },
  hurricane: { name: 'Hurricane', cooldown: 22, target: 'none', description: 'A storm that throws every enemy in reach back toward where it came from.', damage: 25, radius: 6, toss: 5, lift: 7 },
};

/**
 * The level-up pool. Each ability has a fixed rarity, tags (for synergy weighting and
 * requirements), a max rank (taking it again ranks it up), optional `requires` (a tag the
 * hero must already have), optional `delivery` (projectile/melee weapons only), and either
 * `mods(rank)` (passive build mods) or `active` (an id in HERO_ACTIVES), or both.
 */
export const HERO_ABILITIES = {
  // --- common: raw stats -----------------------------------------------------------
  whetstone: { name: 'Whetstone', rarity: 'common', tags: ['damage'], maxRank: 5, mods: (r) => ({ damagePct: 15 * r }), text: (r) => `+${15 * r}% damage` },
  quickHands: { name: 'Quick Hands', rarity: 'common', tags: ['speed'], maxRank: 5, mods: (r) => ({ attackSpeedPct: 12 * r }), text: (r) => `+${12 * r}% attack speed` },
  ironHide: { name: 'Iron Hide', rarity: 'common', tags: ['defense'], maxRank: 4, mods: (r) => ({ hpPct: 25 * r, damageReduction: 5 * r }), text: (r) => `+${25 * r}% health, -${5 * r}% damage taken` },
  keenEye: { name: 'Keen Eye', rarity: 'common', tags: ['crit'], maxRank: 4, mods: (r) => ({ critAdd: 8 * r }), text: (r) => `+${8 * r}% critical chance` },
  longReach: { name: 'Long Reach', rarity: 'common', tags: ['range'], maxRank: 3, mods: (r) => ({ rangeAdd: 0.7 * r }), text: (r) => `+${(0.7 * r).toFixed(1)} range` },
  heavyHands: { name: 'Heavy Hands', rarity: 'common', tags: ['physics'], maxRank: 3, mods: (r) => ({ knockback: 0.8 * r }), text: (r) => `Hits knock enemies back (${(0.8 * r).toFixed(1)})` },

  // --- uncommon: elements and tricks -----------------------------------------------
  emberTips: { name: 'Ember Tips', rarity: 'uncommon', tags: ['fire'], maxRank: 3, mods: (r) => ({ burnPct: 40 * r }), text: (r) => `Hits set enemies on fire (${40 * r}% of the hit per second, 3s)` },
  venom: { name: 'Venom', rarity: 'uncommon', tags: ['poison'], maxRank: 3, mods: (r) => ({ poisonPct: 35 * r }), text: (r) => `Hits poison (${35 * r}% of the hit per second, 4s)` },
  frostbite: { name: 'Frostbite', rarity: 'uncommon', tags: ['frost'], maxRank: 3, mods: (r) => ({ slowPct: 20 + 10 * r }), text: (r) => `Hits slow enemies by ${20 + 10 * r}%` },
  executioner: { name: 'Executioner', rarity: 'uncommon', tags: ['damage'], maxRank: 3, mods: (r) => ({ executePct: 60 * r }), text: (r) => `+${60 * r}% damage to enemies under 35% health` },
  cruelty: { name: 'Cruelty', rarity: 'uncommon', tags: ['crit'], maxRank: 3, mods: (r) => ({ critMultAdd: 50 * r, critAdd: 3 }), text: (r) => `+${50 * r}% critical damage` },
  bloodthirst: { name: 'Bloodthirst', rarity: 'uncommon', tags: ['defense'], maxRank: 3, mods: (r) => ({ lifestealPct: 3 * r, healOnKillPct: 2 * r }), text: (r) => `${3 * r}% life steal, heal ${2 * r}% per kill` },
  bounty: { name: 'Bounty Hunter', rarity: 'uncommon', tags: ['gold'], maxRank: 3, mods: (r) => ({ goldOnKill: r }), text: (r) => `+${r} gold per kill` },
  piercingArrow: { name: 'Piercing Arrow', rarity: 'uncommon', tags: ['projectile'], maxRank: 3, active: 'piercing', text: () => 'Active: a heavy shot through a whole line' },
  fireball: { name: 'Fireball', rarity: 'uncommon', tags: ['fire', 'physics'], maxRank: 3, active: 'fireball', text: () => 'Active: explosion that burns and hurls enemies outward' },
  frostNova: { name: 'Frost Nova', rarity: 'uncommon', tags: ['frost'], maxRank: 3, active: 'frostNova', text: () => 'Active: slows everything around the hero' },
  shieldBash: { name: 'Shield Bash', rarity: 'uncommon', tags: ['melee', 'physics'], maxRank: 3, active: 'shieldBash', text: () => 'Active: stun and shove back everything close' },
  rally: { name: 'Rally', rarity: 'uncommon', tags: ['defense'], maxRank: 3, active: 'rally', text: () => 'Active: walls nearby take half damage' },
  holyShield: { name: 'Holy Shield', rarity: 'uncommon', tags: ['defense', 'holy'], maxRank: 3, active: 'holyShield', text: () => 'Active: shields the most battered wall' },
  toxicFlask: { name: 'Toxic Flask', rarity: 'uncommon', tags: ['poison'], maxRank: 3, active: 'toxicFlask', text: () => 'Active: a lingering poison cloud' },

  // --- rare: build-defining -----------------------------------------------------------
  piercingShots: { name: 'Piercing Shots', rarity: 'rare', tags: ['projectile'], delivery: 'projectile', maxRank: 3, mods: (r) => ({ pierce: r }), text: (r) => `Projectiles pierce ${r} more enem${r > 1 ? 'ies' : 'y'}` },
  twinShot: { name: 'Twin Shot', rarity: 'rare', tags: ['projectile'], delivery: 'projectile', maxRank: 2, mods: (r) => ({ extraProjectiles: r }), text: (r) => `+${r} projectile${r > 1 ? 's' : ''} per attack at other enemies` },
  cleave: { name: 'Cleave', rarity: 'rare', tags: ['melee'], delivery: 'melee', maxRank: 3, mods: (r) => ({ cleavePct: 40 + 20 * r }), text: (r) => `Melee hits splash ${40 + 20 * r}% to everything nearby` },
  chainSpark: { name: 'Chain Spark', rarity: 'rare', tags: ['lightning'], maxRank: 3, mods: (r) => ({ chainChance: 20 * r }), text: (r) => `${20 * r}% chance on hit to arc lightning to 3 enemies` },
  wildfire: { name: 'Wildfire', rarity: 'rare', tags: ['fire'], requires: 'fire', maxRank: 2, mods: (r) => ({ burnSpread: r }), text: (r) => `Burning enemies spread their fire when they die${r > 1 ? ' (twice as far)' : ''}` },
  shatter: { name: 'Shatter', rarity: 'rare', tags: ['frost'], requires: 'frost', maxRank: 3, mods: (r) => ({ shatterPct: 40 * r }), text: (r) => `Slowed enemies take +${40 * r}% damage` },
  plagueBloom: { name: 'Plague Bloom', rarity: 'rare', tags: ['poison'], requires: 'poison', maxRank: 2, mods: (r) => ({ poisonBurst: r }), text: (r) => `Poisoned enemies burst into a poison cloud on death${r > 1 ? ' (bigger, nastier)' : ''}` },
  frenzy: { name: 'Frenzy', rarity: 'rare', tags: ['speed'], maxRank: 3, mods: (r) => ({ frenzyMax: 30 * r }), text: (r) => `Every attack +4% attack speed, up to +${30 * r}% (resets when idle)` },
  giantSlayer: { name: 'Giant Slayer', rarity: 'rare', tags: ['damage'], maxRank: 3, mods: (r) => ({ eliteDmgPct: 60 * r }), text: (r) => `+${60 * r}% damage to elites and bosses` },
  concussion: { name: 'Concussive Blasts', rarity: 'rare', tags: ['physics'], maxRank: 3, mods: (r) => ({ blastForce: 1.5 * r, aoeAdd: 0.3 }), text: (r) => `Every hit is a small explosion that flings enemies outward (force ${1.5 * r})` },
  multishot: { name: 'Multishot', rarity: 'rare', tags: ['projectile'], delivery: 'projectile', maxRank: 3, active: 'multishot', text: () => 'Active: an arrow at each of several enemies' },
  arcaneBlast: { name: 'Arcane Blast', rarity: 'rare', tags: ['magic'], maxRank: 3, active: 'arcaneBlast', text: () => 'Active: a huge burst of raw magic' },
  apBolt: { name: 'Armor-Piercing Bolt', rarity: 'rare', tags: ['projectile', 'damage'], maxRank: 3, active: 'apBolt', text: () => 'Active: a bolt that ignores armor' },
  consecration: { name: 'Consecration', rarity: 'rare', tags: ['holy'], maxRank: 3, active: 'consecration', text: () => 'Active: holy ground that burns the dead' },
  explosiveMixture: { name: 'Explosive Mixture', rarity: 'rare', tags: ['fire', 'physics'], maxRank: 3, active: 'explosiveMixture', text: () => 'Active: a bomb that flings the horde apart' },

  // --- epic: big edges ------------------------------------------------------------
  ricochet: { name: 'Ricochet', rarity: 'epic', tags: ['projectile'], delivery: 'projectile', maxRank: 3, mods: (r) => ({ bounce: 2 * r }), text: (r) => `Projectiles bounce to ${2 * r} more enemies (85% damage each)` },
  splitShot: { name: 'Split Shot', rarity: 'epic', tags: ['projectile'], delivery: 'projectile', maxRank: 3, mods: (r) => ({ split: 1 + 2 * r }), text: (r) => `Projectiles burst into ${1 + 2 * r} shards on impact (45% damage each)` },
  titansReach: { name: "Titan's Reach", rarity: 'epic', tags: ['melee'], delivery: 'melee', maxRank: 2, mods: (r) => ({ meleeRangeAdd: 2.5 * r, cleavePct: 25 }), text: (r) => `+${2.5 * r} melee reach, melee hits splash` },
  whirlwind: { name: 'Whirlwind', rarity: 'epic', tags: ['melee', 'physics'], delivery: 'melee', maxRank: 3, mods: (r) => ({ whirlwind: 1.4 + 0.4 * r, toss: 2 + r }), text: (r) => `Melee hits everything within ${(1.4 + 0.4 * r).toFixed(1)} and hurls it away from the gate` },
  inferno: { name: 'Inferno', rarity: 'epic', tags: ['fire'], requires: 'fire', maxRank: 2, mods: (r) => ({ burnMult: 1 + 1.5 * r, burningDmgPct: 25 * r }), text: (r) => `Burns deal ${1 + 1.5 * r}x damage; burning enemies take +${25 * r}% damage` },
  deepFreeze: { name: 'Deep Freeze', rarity: 'epic', tags: ['frost'], requires: 'frost', maxRank: 2, mods: (r) => ({ freezeChance: 20 * r }), text: (r) => `Hits on slowed enemies have ${20 * r}% chance to freeze them solid for 1.5s` },
  critCascade: { name: 'Critical Cascade', rarity: 'epic', tags: ['crit', 'lightning'], requires: 'crit', maxRank: 2, mods: (r) => ({ critChain: 1 + r }), text: (r) => `Critical hits arc to ${1 + r} more enemies at full damage` },
  doubleStrike: { name: 'Double Strike', rarity: 'epic', tags: ['speed'], maxRank: 3, mods: (r) => ({ doubleStrike: 25 * r }), text: (r) => `${25 * r}% chance to attack twice` },
  corpseBlast: { name: 'Corpse Explosion', rarity: 'epic', tags: ['damage', 'physics'], maxRank: 3, mods: (r) => ({ corpseBlastPct: 20 * r }), text: (r) => `Kills explode for ${20 * r}% of the victim's health, flinging its friends` },
  shockwave: { name: 'Shockwave', rarity: 'epic', tags: ['physics', 'melee'], maxRank: 3, active: 'shockwave', text: () => 'Active: launches everything nearby into the air, far away' },

  // --- legendary: run-defining ----------------------------------------------------------
  steelStorm: { name: 'Storm of Steel', rarity: 'legendary', tags: ['projectile'], delivery: 'projectile', maxRank: 2, mods: (r) => ({ extraProjectiles: 2 + r }), text: (r) => `Every attack fires ${2 + r} extra projectiles` },
  fractal: { name: 'Fractal Shards', rarity: 'legendary', tags: ['projectile'], requires: 'projectile', delivery: 'projectile', maxRank: 1, mods: () => ({ split: 2, splitGenerations: 1 }), text: () => 'Shards split again when they hit' },
  earthshaker: { name: 'Earthshaker', rarity: 'legendary', tags: ['melee', 'physics'], delivery: 'melee', maxRank: 2, mods: (r) => ({ earthshaker: r }), text: (r) => `Every ${r > 1 ? '3rd' : '4th'} hit is a quake: 250% damage, stun and launch in a wide circle` },
  phoenix: { name: 'Phoenix Heart', rarity: 'legendary', tags: ['defense', 'fire'], maxRank: 1, mods: () => ({ phoenix: 1 }), text: () => 'Once per wave: rise from death at full health in a burst of fire' },
  thunderlord: { name: 'Thunderlord', rarity: 'legendary', tags: ['lightning'], requires: 'lightning', maxRank: 1, mods: () => ({ chainChance: 100, chainTargets: 3 }), text: () => 'Lightning arcs on every hit, to 6 enemies' },
  midas: { name: 'Midas Touch', rarity: 'legendary', tags: ['gold'], maxRank: 2, mods: (r) => ({ goldOnKill: 3 * r, eliteGold: 40 * r }), text: (r) => `+${3 * r} gold per kill, elites drop ${40 * r} more` },
  hurricane: { name: 'Hurricane', rarity: 'legendary', tags: ['physics'], maxRank: 2, active: 'hurricane', text: () => 'Active: throws every enemy in reach back where it came from' },

  // --- mythical: broken on purpose -------------------------------------------------------
  godslayer: { name: 'Godslayer', rarity: 'mythical', tags: ['crit', 'damage'], maxRank: 1, mods: () => ({ eliteDmgPct: 200, critMultAdd: 200 }), text: () => '+200% damage to elites and bosses, critical hits deal 3x more' },
  endlessRicochet: { name: 'Endless Ricochet', rarity: 'mythical', tags: ['projectile'], delivery: 'projectile', maxRank: 1, mods: () => ({ bounce: 8, bounceGain: 15 }), text: () => 'Projectiles bounce 8 more times and grow 15% stronger each bounce' },
  avatarOfFlame: { name: 'Avatar of Flame', rarity: 'mythical', tags: ['fire'], maxRank: 1, mods: () => ({ aoeAdd: 1.5, burnPct: 80, blastForce: 1.5, flameAvatar: 1 }), text: () => 'Every hit explodes in fire around the target and sets it ablaze' },
  timeWarp: { name: 'Time Warp', rarity: 'mythical', tags: ['speed'], maxRank: 1, mods: () => ({ attackSpeedPct: 100, cooldownPct: 50 }), text: () => '+100% attack speed, active abilities recharge twice as fast' },
  blackHole: { name: 'Singularity', rarity: 'mythical', tags: ['physics'], maxRank: 1, mods: () => ({ blastForce: -3, aoeAdd: 1.2, corpseBlastPct: 30 }), text: () => 'Every hit pulls the horde together; kills implode on their friends' },
};

/** Physics: how zombies fly, fall and resist being shoved. */
export const PHYSICS = {
  gravity: 22,
  /** Ground friction per second (velocity *= exp(-friction * dt)). */
  friction: 6,
  /** Below this speed a shoved zombie walks again. */
  settleSpeed: 0.4,
  /** Knockback taken by bosses and elites (fraction). */
  bossResist: 0.2,
  eliteResist: 0.6,
  /** Impulse cap (cells/s) so nothing flies off the map. */
  maxSpeed: 14,
  /** Landing from this height or higher hurts (fraction of max HP per cell of height). */
  fallDamagePct: 0.04,
  /** Each shove adds a stack; force is divided by (1 + stacks * shoveResist). Stacks fade per second. */
  shoveResist: 0.6,
  shoveRecovery: 0.8,
};
