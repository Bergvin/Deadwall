// The Commander: the player's own persistent character across runs.
// Every finished run gives commander XP. Each level-up offers a choice of three random perks,
// each rolled with its own rarity. Artifacts drop from Wanderers (and rarely from bosses) and
// are equipped in a limited number of slots. Perks and equipped artifacts become bonuses that
// core/commander.js applies to a copy of the gameplay config at the start of every run.

/** Rarity order matters: index 0 is the weakest. */
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'mythical'];

export const RARITY_INFO = {
  common: { name: 'Common', color: '#b9b3a6', salvageXp: 5 },
  uncommon: { name: 'Uncommon', color: '#5fd35f', salvageXp: 15 },
  rare: { name: 'Rare', color: '#4aa3ff', salvageXp: 40 },
  legendary: { name: 'Legendary', color: '#ff9f1a', salvageXp: 100 },
  mythical: { name: 'Mythical', color: '#ff4fd8', salvageXp: 250 },
};

export const COMMANDER = {
  /** Commander XP needed to go from level L to L+1. */
  xpToNext: (level) => 150 + 100 * (level - 1),
  /** XP for a finished run (summary from Simulation.summary()). */
  xpPerWaveCleared: 25,
  /** Extra XP that grows with how far the run got: round(wave^1.5 * this). */
  xpDepthFactor: 5,
  /** One XP per this many kills. */
  killsPerXp: 4,
  /** Choices offered per level-up. */
  offerSize: 3,
  /** Rarity weights for each offered perk (rolled per option). */
  offerWeights: { common: 52, uncommon: 28, rare: 13, legendary: 5.5, mythical: 1.5 },
  /** Artifact slots: base + one more at each listed commander level. */
  baseSlots: 2,
  slotLevels: [5, 10, 20],
  /** The stash holds at most this many artifacts; new drops beyond it are salvaged for XP. */
  maxStash: 60,
  /** Reductions (costs, cooldowns, enemy hp/speed) never go beyond this percentage. */
  maxReductionPct: 60,
};

/**
 * Bonus keys (all numbers add up across perks and artifacts; core/commander.js applies them):
 *   heroDamagePct, heroAttackSpeedPct, heroRangeAdd (cells): towers and champion;
 *   heroHpPct, heroCritAdd (points), abilityCooldownPct (reduction), heroXpPct: champion;
 *   towerCostPct (reduction),
 *   wallHpPct, wallCostPct (reduction), thornsPct, arcanePct, gateHpPct,
 *   startingGoldAdd, killGoldPct, waveBonusPct, prepTimeAdd (seconds),
 *   wandererChancePct, artifactLuckPct, enemySpeedPct (reduction), enemyHpPct (reduction)
 */
export const BONUS_LABELS = {
  heroDamagePct: (v) => `+${v}% tower and champion damage`,
  heroAttackSpeedPct: (v) => `+${v}% tower and champion attack speed`,
  heroHpPct: (v) => `+${v}% champion health`,
  heroRangeAdd: (v) => `+${v} tower and champion range`,
  heroCritAdd: (v) => `+${v}% champion critical chance`,
  abilityCooldownPct: (v) => `-${v}% champion ability cooldowns`,
  heroXpPct: (v) => `+${v}% champion XP`,
  towerCostPct: (v) => `-${v}% tower cost`,
  wallHpPct: (v) => `+${v}% wall health`,
  wallCostPct: (v) => `-${v}% wall cost`,
  thornsPct: (v) => `+${v}% spike damage`,
  arcanePct: (v) => `+${v}% arcane wall damage`,
  gateHpPct: (v) => `+${v}% gate health`,
  startingGoldAdd: (v) => `+${v} starting gold`,
  killGoldPct: (v) => `+${v}% gold from kills`,
  waveBonusPct: (v) => `+${v}% wave clear bonus`,
  prepTimeAdd: (v) => `+${v}s preparation time`,
  wandererChancePct: (v) => `+${v}% Wanderer sightings`,
  artifactLuckPct: (v) => `+${v}% artifact luck`,
  enemySpeedPct: (v) => `-${v}% enemy speed`,
  enemyHpPct: (v) => `-${v}% enemy health`,
};

/**
 * Level-up perks. `values` holds one number per rarity (RARITIES order); null = that rarity
 * does not exist for this perk (it can only be offered at a rarity with a value).
 */
export const PERKS = {
  sharpSteel: { name: 'Sharpened Steel', bonus: 'heroDamagePct', values: [4, 7, 11, 16, 25] },
  quickHands: { name: 'Quick Hands', bonus: 'heroAttackSpeedPct', values: [3, 5, 8, 12, 18] },
  hardened: { name: 'Battle-Hardened', bonus: 'heroHpPct', values: [6, 10, 15, 22, 35] },
  eagleEyes: { name: 'Eagle Eyes', bonus: 'heroRangeAdd', values: [0.15, 0.3, 0.5, 0.75, 1.2] },
  luckyStrikes: { name: 'Lucky Strikes', bonus: 'heroCritAdd', values: [1, 2, 3.5, 5, 8] },
  arcaneStudy: { name: 'Arcane Study', bonus: 'abilityCooldownPct', values: [3, 5, 8, 12, 18] },
  mentor: { name: 'Mentor', bonus: 'heroXpPct', values: [8, 14, 22, 32, 50] },
  engineers: { name: 'Siege Engineers', bonus: 'towerCostPct', values: [3, 5, 8, 12, 18] },
  masonry: { name: 'Master Masonry', bonus: 'wallHpPct', values: [5, 9, 14, 20, 32] },
  quarry: { name: 'Quarry Rights', bonus: 'wallCostPct', values: [3, 5, 8, 12, 18] },
  ironSpikes: { name: 'Iron Spikes', bonus: 'thornsPct', values: [10, 18, 28, 40, 60] },
  runecraft: { name: 'Runecraft', bonus: 'arcanePct', values: [8, 14, 22, 32, 50] },
  oakenGate: { name: 'Oaken Gate', bonus: 'gateHpPct', values: [6, 10, 16, 24, 40] },
  warChest: { name: 'War Chest', bonus: 'startingGoldAdd', values: [20, 35, 55, 80, 130] },
  plunder: { name: 'Plunder', bonus: 'killGoldPct', values: [3, 5, 8, 12, 18] },
  tribute: { name: 'Tribute', bonus: 'waveBonusPct', values: [8, 14, 22, 32, 50] },
  scouts: { name: 'Scouts', bonus: 'prepTimeAdd', values: [2, 3, 5, 7, 10] },
  beastLore: { name: 'Beast Lore', bonus: 'wandererChancePct', values: [5, 9, 14, 20, 30] },
  fortune: { name: "Fortune's Favor", bonus: 'artifactLuckPct', values: [3, 5, 8, 12, 20] },
  // Only ever legendary or mythical.
  hallowedGround: { name: 'Hallowed Ground', bonus: 'enemySpeedPct', values: [null, null, null, 4, 7] },
  witheringCurse: { name: 'Withering Curse', bonus: 'enemyHpPct', values: [null, null, null, 3, 5] },
};

/**
 * Artifacts. Each has one or more bonuses; values per rarity in RARITIES order. A common
 * artifact is deliberately weak, a mythical one game-changing.
 */
export const ARTIFACTS = {
  bloodstone: { name: 'Bloodstone Amulet', icon: '◆', bonuses: { heroDamagePct: [3, 6, 12, 22, 40] } },
  windcaller: { name: 'Windcaller Feather', icon: '➶', bonuses: { heroAttackSpeedPct: [2, 5, 9, 16, 28] } },
  giantsBelt: { name: "Giant's Belt", icon: '▣', bonuses: { heroHpPct: [5, 10, 18, 30, 55] } },
  falconHood: { name: 'Falcon Hood', icon: '◉', bonuses: { heroRangeAdd: [0.1, 0.3, 0.6, 1, 1.6] } },
  mortar: { name: 'Mortar of Ages', icon: '▦', bonuses: { wallHpPct: [4, 9, 16, 28, 50] } },
  gateWard: { name: 'Ward of the Gate', icon: '⛨', bonuses: { gateHpPct: [5, 12, 22, 38, 70] } },
  goldenIdol: { name: 'Golden Idol', icon: '♛', bonuses: { killGoldPct: [2, 5, 10, 17, 30] } },
  ledger: { name: "Merchant's Ledger", icon: '✉', bonuses: { startingGoldAdd: [15, 35, 70, 120, 220] } },
  hourglass: { name: 'Cracked Hourglass', icon: '⧗', bonuses: { abilityCooldownPct: [2, 5, 9, 15, 25] } },
  thornCrown: { name: 'Crown of Thorns', icon: '♆', bonuses: { thornsPct: [8, 18, 32, 55, 100] } },
  runestone: { name: 'Humming Runestone', icon: '✦', bonuses: { arcanePct: [6, 14, 26, 45, 80] } },
  compass: {
    name: "Hunter's Compass", icon: '✧',
    bonuses: { wandererChancePct: [5, 10, 18, 30, 50], artifactLuckPct: [0, 0, 3, 6, 10] },
  },
  kingslayer: {
    name: "Kingslayer's Edge", icon: '†',
    bonuses: { heroDamagePct: [2, 4, 8, 14, 25], heroCritAdd: [1, 2, 4, 6, 10] },
  },
  heartOfWinter: {
    name: 'Heart of Winter', icon: '❄',
    bonuses: { enemySpeedPct: [1, 2, 4, 6, 10], arcanePct: [3, 6, 12, 20, 35] },
  },
};

/**
 * Rarity weights for artifact drops. Common is always the most likely result; better tables
 * only belong to harder enemies. artifactLuckPct multiplies every non-common weight.
 * `chance` is the probability that anything drops at all.
 */
export const LOOT_TABLES = {
  boss: { chance: 0.25, weights: { common: 80, uncommon: 17, rare: 3, legendary: 0, mythical: 0 } },
  minor: { chance: 1, weights: { common: 70, uncommon: 22, rare: 6.5, legendary: 1.3, mythical: 0.2 } },
  major: { chance: 1, weights: { common: 50, uncommon: 28, rare: 15, legendary: 5.5, mythical: 1.5 } },
  mythic: { chance: 1, weights: { common: 35, uncommon: 30, rare: 20, legendary: 11, mythical: 4 } },
};
