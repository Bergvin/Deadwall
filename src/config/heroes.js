// Hero classes: base stats, per-level growth, abilities and talent choices.
// Units: range/radius in cells, intervals/cooldowns/durations in seconds, speeds in cells/s.
// Damage types: physical (reduced by armor), magic (reduced by resist), holy (magic that
// ignores resist), poison (damage over time, ignores armor).
//
// growth: multiplicative per level above 1 (0.08 = +8% per level).
// talents: three tiers unlocked at the given hero level; buying one option costs gold and
// excludes the other option of that tier. `mods` are read by heroStats() and the abilities.

export const HERO_RULES = {
  /** Seconds a hero spends walking to a new wall when repositioned (cannot attack meanwhile). */
  repositionTime: 3,
  /** XP per point of damage dealt (kill XP is added on top). */
  xpPerDamage: 0.2,
  maxLevel: 10,
  /** XP needed to go from level L to L+1. */
  xpToNext: (level) => Math.round(30 * level ** 1.6),
  /** Ability point targets may be this far beyond the hero's attack range. */
  abilityRangeBonus: 1,
  /** HP fraction at which a hero triggers a low-health warning. */
  lowHealthWarning: 0.35,
  /** Reviving a fallen hero costs this fraction of everything invested in it. */
  reviveCostFactor: 0.35,
  /** Each hero already recruited raises the next recruit's price by this fraction. */
  recruitCostGrowth: 0.1,
  names: ['Aldric', 'Brienne', 'Cedric', 'Daria', 'Edmund', 'Freya', 'Garrick', 'Helena',
    'Ivor', 'Johanna', 'Kendrick', 'Liora', 'Merek', 'Nessa', 'Osric', 'Rowena', 'Tobias', 'Wynn',
    'Alaric', 'Beatrix', 'Corwin', 'Elspeth', 'Godric', 'Isolde', 'Leofric', 'Maude', 'Percival', 'Sybil'],
};

export const HEROES = {
  archer: {
    name: 'Archer',
    role: 'Fast ranged damage',
    description: 'Fast, long-ranged arrows. Strong vs Walkers and Runners, weak vs armor.',
    strengths: 'Swarms of weak enemies, long reach', weaknesses: 'Armored targets',
    model: 'archer',
    cost: 80,
    hp: 100,
    damage: 14, damageType: 'physical',
    attackInterval: 0.75,
    range: 6.5,
    attack: { kind: 'arrow', speed: 16 },
    critChance: 0.1, critMultiplier: 2,
    growth: { damage: 0.08, attackSpeed: 0.04, hp: 0.05 },
    abilities: {
      multishot: {
        name: 'Multishot', unlock: 1, cooldown: 12, target: 'none',
        description: 'Fires an arrow at each of several enemies in range.',
        arrows: 4, damageMult: 1,
      },
      piercing: {
        name: 'Piercing Arrow', unlock: 2, cooldown: 16, target: 'point',
        description: 'A heavy arrow that passes through every enemy in a line.',
        damageMult: 3, width: 0.55, extraLength: 3, speed: 20,
      },
    },
    talents: [
      { level: 3, cost: 100, options: [
        { id: 'piercingShafts', name: 'Piercing Shafts', description: 'Basic arrows pass through 1 extra enemy.', mods: { pierce: 1 } },
        { id: 'rapidDraw', name: 'Rapid Draw', description: '+25% attack speed.', mods: { attackSpeedMult: 1.25 } },
      ] },
      { level: 5, cost: 220, options: [
        { id: 'volley', name: 'Volley', description: 'Multishot fires 3 more arrows.', mods: { multishotAdd: 3 } },
        { id: 'eagleEye', name: 'Eagle Eye', description: '+1.5 range.', mods: { rangeAdd: 1.5 } },
      ] },
      { level: 7, cost: 380, options: [
        { id: 'deadlyAim', name: 'Deadly Aim', description: '+15% critical chance.', mods: { critAdd: 0.15 } },
        { id: 'broadheads', name: 'Broadheads', description: '+30% damage.', mods: { damageMult: 1.3 } },
      ] },
    ],
  },

  mage: {
    name: 'Mage',
    role: 'Area damage and crowd control',
    description: 'Explosive magic that shreds packed hordes. Fragile and expensive.',
    strengths: 'Dense groups, slowing the horde', weaknesses: 'Lone or magic-resistant enemies',
    model: 'mage',
    cost: 120,
    hp: 70,
    damage: 16, damageType: 'magic',
    attackInterval: 1.3,
    range: 5.5,
    attack: { kind: 'orb', speed: 9, aoe: 0.9 },
    critChance: 0.05, critMultiplier: 1.5,
    growth: { damage: 0.1, aoe: 0.03, hp: 0.04 },
    abilities: {
      fireball: {
        name: 'Fireball', unlock: 1, cooldown: 16, target: 'point',
        description: 'Explodes on impact and sets the area ablaze.',
        damage: 40, radius: 1.8, burnDps: 4, burnDuration: 3, speed: 10,
      },
      frostNova: {
        name: 'Frost Nova', unlock: 2, cooldown: 22, target: 'none',
        description: 'A freezing pulse around the mage that slows enemies.',
        damage: 15, radius: 3, slow: 0.5, slowDuration: 4,
      },
      arcaneBlast: {
        name: 'Arcane Blast', unlock: 4, cooldown: 24, target: 'point',
        description: 'A concentrated burst of raw magic.',
        damage: 95, radius: 1.2,
      },
    },
    talents: [
      { level: 3, cost: 120, options: [
        { id: 'pyromancer', name: 'Pyromancer', description: 'Fireball radius +0.8.', mods: { fireballRadiusAdd: 0.8 } },
        { id: 'focus', name: 'Focus', description: 'Ability cooldowns -20%.', mods: { cooldownMult: 0.8 } },
      ] },
      { level: 5, cost: 240, options: [
        { id: 'searingOrbs', name: 'Searing Orbs', description: 'Basic orb blast radius +0.5.', mods: { aoeAdd: 0.5 } },
        { id: 'deepFreeze', name: 'Deep Freeze', description: 'Frost Nova slows harder and 2s longer.', mods: { slowDurationAdd: 2, slowFactor: 0.35 } },
      ] },
      { level: 7, cost: 400, options: [
        { id: 'archmage', name: 'Archmage', description: '+35% basic attack damage.', mods: { damageMult: 1.35 } },
        { id: 'overcharge', name: 'Overcharge', description: '+40% ability damage.', mods: { abilityDamageMult: 1.4 } },
      ] },
    ],
  },

  warrior: {
    name: 'Warrior',
    role: 'Heavy frontline defense',
    description: 'Cuts down zombies at the wall and makes the wall he holds much harder to break.',
    strengths: 'Holding a key wall, enemies at the wall', weaknesses: 'Short reach',
    model: 'warrior',
    cost: 100,
    hp: 260,
    damage: 22, damageType: 'physical',
    attackInterval: 1.1,
    range: 1.7,
    attack: { kind: 'melee' },
    critChance: 0.08, critMultiplier: 1.8,
    /** Fraction of damage the warrior's wall is spared. */
    wallGuard: 0.35,
    growth: { damage: 0.07, hp: 0.12, wallGuard: 0.02 },
    abilities: {
      shieldBash: {
        name: 'Shield Bash', unlock: 1, cooldown: 10, target: 'none',
        description: 'Slams nearby enemies, damaging and stunning them.',
        damage: 35, radius: 1.8, stun: 1.5,
      },
      rally: {
        name: 'Rally', unlock: 2, cooldown: 25, target: 'none',
        description: 'Nearby walls take half damage for a while.',
        radius: 3.5, reduction: 0.5, duration: 8,
      },
    },
    talents: [
      { level: 3, cost: 100, options: [
        { id: 'cleave', name: 'Cleave', description: 'Attacks also hit enemies next to the target.', mods: { cleave: 1 } },
        { id: 'bulwark', name: 'Bulwark', description: 'Wall guard +15%.', mods: { wallGuardAdd: 0.15 } },
      ] },
      { level: 5, cost: 220, options: [
        { id: 'guardian', name: 'Guardian', description: 'Adjacent walls also get half the wall guard.', mods: { guardAdjacent: 1 } },
        { id: 'warcry', name: 'War Cry', description: 'Rally lasts 4s longer.', mods: { rallyDurationAdd: 4 } },
      ] },
      { level: 7, cost: 380, options: [
        { id: 'berserker', name: 'Berserker', description: '+40% damage.', mods: { damageMult: 1.4 } },
        { id: 'concussion', name: 'Concussion', description: 'Shield Bash stuns 1s longer.', mods: { stunAdd: 1 } },
      ] },
    ],
  },

  crossbowman: {
    name: 'Crossbowman',
    role: 'Heavy single-target damage',
    description: 'Slow, devastating bolts that punch through armor. Kills big threats.',
    strengths: 'Brutes, siege zombies, bosses', weaknesses: 'Large numbers of weak enemies',
    model: 'crossbowman',
    cost: 130,
    hp: 110,
    damage: 55, damageType: 'physical',
    attackInterval: 2.2,
    range: 7.5,
    armorPen: 0.3,
    attack: { kind: 'bolt', speed: 22 },
    critChance: 0.12, critMultiplier: 2,
    /** Prefers the toughest enemy in range by default. */
    defaultTargeting: 'strongest',
    growth: { damage: 0.09, armorPen: 0.02, hp: 0.05 },
    abilities: {
      apBolt: {
        name: 'Armor-Piercing Bolt', unlock: 1, cooldown: 12, target: 'enemy',
        description: 'Ignores all armor and deals heavy bonus damage.',
        damageMult: 3.5, speed: 26,
      },
    },
    talents: [
      { level: 3, cost: 110, options: [
        { id: 'steadyAim', name: 'Steady Aim', description: '+1.5 range.', mods: { rangeAdd: 1.5 } },
        { id: 'quickReload', name: 'Quick Reload', description: '+30% attack speed.', mods: { attackSpeedMult: 1.3 } },
      ] },
      { level: 5, cost: 230, options: [
        { id: 'heavyBolts', name: 'Heavy Bolts', description: '+30% armor penetration.', mods: { armorPenAdd: 0.3 } },
        { id: 'explosiveTips', name: 'Explosive Tips', description: 'Bolts burst on impact (radius 0.8).', mods: { boltAoe: 0.8 } },
      ] },
      { level: 7, cost: 390, options: [
        { id: 'executioner', name: 'Executioner', description: '+35% damage.', mods: { damageMult: 1.35 } },
        { id: 'huntersMark', name: "Hunter's Mark", description: 'Armor-Piercing Bolt cooldown -40%.', mods: { cooldownMult: 0.6 } },
      ] },
    ],
  },

  paladin: {
    name: 'Paladin',
    role: 'Protection and support',
    description: 'Holy fighter who slowly mends nearby walls and shields the line.',
    strengths: 'Keeping walls alive, sustained sieges', weaknesses: 'Modest damage',
    model: 'paladin',
    cost: 120,
    hp: 220,
    damage: 18, damageType: 'holy',
    attackInterval: 1,
    range: 1.8,
    attack: { kind: 'melee' },
    critChance: 0.05, critMultiplier: 1.5,
    /** Walls within auraRadius regain this much HP per second (free). */
    repairPerSec: 2.5,
    /** Heroes within auraRadius regain this much HP per second. */
    healPerSec: 4,
    auraRadius: 2.5,
    growth: { damage: 0.06, hp: 0.1, repair: 0.1 },
    abilities: {
      holyShield: {
        name: 'Holy Shield', unlock: 1, cooldown: 22, target: 'wall',
        description: 'A chosen wall and its neighbours take far less damage.',
        reduction: 0.7, duration: 8, reach: 4.5,
      },
      consecration: {
        name: 'Consecration', unlock: 2, cooldown: 16, target: 'point',
        description: 'Hallowed ground that burns the undead.',
        radius: 1.8, dps: 14, duration: 6,
        /** Melee heroes cast point abilities farther than they can strike. */
        reach: 4,
      },
    },
    talents: [
      { level: 3, cost: 110, options: [
        { id: 'devotion', name: 'Devotion', description: 'Wall mending doubled.', mods: { repairMult: 2 } },
        { id: 'zeal', name: 'Zeal', description: '+30% damage.', mods: { damageMult: 1.3 } },
      ] },
      { level: 5, cost: 230, options: [
        { id: 'aegis', name: 'Aegis', description: 'Holy Shield lasts 4s longer.', mods: { shieldDurationAdd: 4 } },
        { id: 'sanctuary', name: 'Sanctuary', description: 'Consecration radius +0.8.', mods: { consecrationRadiusAdd: 0.8 } },
      ] },
      { level: 7, cost: 380, options: [
        { id: 'blessedAura', name: 'Blessed Aura', description: 'Walls in the aura take 15% less damage.', mods: { auraGuard: 0.15 } },
        { id: 'crusader', name: 'Crusader', description: '+30% attack speed.', mods: { attackSpeedMult: 1.3 } },
      ] },
    ],
  },

  alchemist: {
    name: 'Alchemist',
    role: 'Damage over time and area control',
    description: 'Hurls volatile flasks that poison whole packs of zombies.',
    strengths: 'Tightly packed hordes, attrition', weaknesses: 'Slow to kill single targets',
    model: 'alchemist',
    cost: 110,
    hp: 80,
    damage: 10, damageType: 'physical',
    attackInterval: 1.4,
    range: 5,
    attack: { kind: 'flask', speed: 8, aoe: 1 },
    poisonDps: 6, poisonDuration: 4,
    critChance: 0.05, critMultiplier: 1.5,
    growth: { damage: 0.07, poison: 0.1, hp: 0.04 },
    abilities: {
      toxicFlask: {
        name: 'Toxic Flask', unlock: 1, cooldown: 14, target: 'point',
        description: 'Leaves a poison cloud that eats away at anything inside.',
        radius: 1.8, dps: 10, duration: 6, speed: 9,
      },
      explosiveMixture: {
        name: 'Explosive Mixture', unlock: 2, cooldown: 20, target: 'point',
        description: 'A large explosion that blasts a whole pack.',
        damage: 90, radius: 2.2, speed: 9,
      },
    },
    talents: [
      { level: 3, cost: 100, options: [
        { id: 'virulence', name: 'Virulence', description: 'Poison lasts 3s longer.', mods: { poisonDurationAdd: 3 } },
        { id: 'potency', name: 'Potency', description: 'Poison deals 50% more damage.', mods: { poisonMult: 1.5 } },
      ] },
      { level: 5, cost: 220, options: [
        { id: 'lingeringFumes', name: 'Lingering Fumes', description: 'Toxic clouds last 4s longer.', mods: { cloudDurationAdd: 4 } },
        { id: 'volatile', name: 'Volatile', description: 'Explosive Mixture radius +0.8.', mods: { explosiveRadiusAdd: 0.8 } },
      ] },
      { level: 7, cost: 380, options: [
        { id: 'plagueMaster', name: 'Plague Master', description: 'Toxic clouds +0.6 radius.', mods: { cloudRadiusAdd: 0.6 } },
        { id: 'nitro', name: 'Nitro', description: 'Explosive Mixture deals 60% more damage.', mods: { explosiveDamageMult: 1.6 } },
      ] },
    ],
  },
};

/** Targeting preferences selectable per hero. */
export const TARGETING = {
  threat: 'Closest to the gate',
  nearest: 'Nearest',
  strongest: 'Highest health',
  weakest: 'Lowest health',
};
