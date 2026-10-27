// The Commander: the player's own persistent character across runs.
// A fresh commander is meant to fall around wave 5; perks, skills and artifacts are what
// carry later runs further.
//   - Every finished run gives commander XP. Each level-up offers three random choices,
//     each rolled with its own rarity: stat perks or skills (automatic abilities).
//   - Every finished run also offers three artifacts to choose one from. The further the
//     run got, the better the rarity odds. Uncommon and better artifacts carry an automatic
//     ability; two identical artifacts (same kind and rarity) merge into a higher level.
// core/commander.js turns all of it into a modified copy of the gameplay config.

/** Rarity order matters: index 0 is the weakest. */
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'mythical'];

export const RARITY_INFO = {
  common: { name: 'Common', color: '#b9b3a6', salvageXp: 10 },
  uncommon: { name: 'Uncommon', color: '#5fd35f', salvageXp: 30 },
  rare: { name: 'Rare', color: '#4aa3ff', salvageXp: 80 },
  legendary: { name: 'Legendary', color: '#ff9f1a', salvageXp: 200 },
  mythical: { name: 'Mythical', color: '#ff4fd8', salvageXp: 500 },
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
  /** Choices offered per level-up and artifacts offered per finished run. */
  offerSize: 3,
  /** Rarity weights for each level-up choice (rolled per option). */
  offerWeights: { common: 52, uncommon: 28, rare: 13, legendary: 5.5, mythical: 1.5 },
  /** Artifact slots: base + one more at each listed commander level. */
  baseSlots: 2,
  slotLevels: [4, 8, 14, 20],
  /** The stash holds at most this many artifacts; beyond it new ones are salvaged for XP. */
  maxStash: 60,
  /** Reductions (costs, cooldowns, enemy hp/speed) never go beyond this percentage. */
  maxReductionPct: 60,
  /** Merging: highest artifact level, and the extra strength each level adds (of level 1). */
  artifactMaxLevel: 5,
  artifactLevelBonus: 0.35,
};

/**
 * Run-end artifact odds. Weight of each rarity = base + perWave * (wave reached), clamped
 * to [min, max]. Early runs mostly give commons; deep runs make rare and better common.
 * artifactLuckPct multiplies every non-common weight.
 */
export const ARTIFACT_ODDS = {
  common: { base: 75, perWave: -2.6, min: 8 },
  uncommon: { base: 20, perWave: 0.6, max: 40 },
  rare: { base: 4, perWave: 0.9, max: 32 },
  legendary: { base: 0.8, perWave: 0.45, max: 16 },
  mythical: { base: 0.1, perWave: 0.15, max: 6 },
};

/**
 * Automatic abilities (from skills and from uncommon+ artifacts). They only act while a wave
 * is being fought. `power` (summed over every source of the same ability) scales the effect;
 * damage also scales with the current wave's enemy HP so abilities stay relevant.
 *   interval    seconds between activations
 *   damage      per power, times the wave HP multiplier
 *   target      'pack' (densest group) | 'toughest' (most HP) | 'all' | 'walls' | 'gate'
 */
export const ABILITIES = {
  meteor: {
    name: 'Meteor', icon: '☄', interval: 16, target: 'pack', radius: 1.8,
    damage: 55, type: 'fire', burn: { dps: 8, duration: 3 }, fx: 'explosion',
    text: (p) => `Every 16s a meteor hits the largest pack (${Math.round(55 * p)} fire damage + burn)`,
  },
  storm: {
    name: 'Storm Call', icon: 'ϟ', interval: 6, target: 'several', targets: 2,
    damage: 22, type: 'magic', fx: 'arcane',
    text: (p) => `Every 6s lightning strikes ${2 + Math.floor(p)} enemies (${Math.round(22 * p)} damage each)`,
  },
  frost: {
    name: "Winter's Breath", icon: '❄', interval: 20, target: 'all',
    damage: 8, type: 'magic', slow: 0.5, slowDuration: 2.5, fx: 'frost',
    text: (p) => `Every 20s slows every enemy on the field by 50% for ${(2.5 * Math.sqrt(p)).toFixed(1)}s`,
  },
  judgement: {
    name: 'Judgement', icon: '✝', interval: 9, target: 'toughest',
    damage: 140, type: 'holy', fx: 'holy',
    text: (p) => `Every 9s smites the toughest enemy (${Math.round(140 * p)} holy damage)`,
  },
  rot: {
    name: 'Rot Cloud', icon: '☣', interval: 12, target: 'pack', radius: 1.7,
    poison: { dps: 12, duration: 5 }, fx: 'poison',
    text: (p) => `Every 12s poisons the largest pack (${Math.round(12 * p)} damage/s for 5s)`,
  },
  stillness: {
    name: 'Stillness', icon: '⧗', interval: 35, target: 'all', stun: 1, fx: 'arcane',
    text: (p) => `Every 35s freezes every enemy in time for ${Math.min(4, Math.sqrt(p)).toFixed(1)}s`,
  },
  masonry: {
    name: "Mason's Blessing", icon: '▦', interval: 14, target: 'walls', healPct: 0.06,
    text: (p) => `Every 14s repairs every wall by ${Math.round(6 * p)}% of its health`,
  },
  bulwark: {
    name: 'Bulwark', icon: '⛨', interval: 18, target: 'gate', healPct: 0.05,
    text: (p) => `Every 18s restores ${Math.round(5 * p)}% of the gate's health`,
  },
  tithe: {
    name: 'War Tithe', icon: '♛', onWaveClear: true, goldPerWave: 10,
    text: (p) => `Every cleared wave pays ${Math.round(10 * p)} gold per wave number`,
  },
};

/**
 * Ability damage follows the wave's enemy HP multiplier only partly (multiplier ^ this), so
 * abilities matter a lot early and fade late instead of carrying a run forever.
 */
export const ABILITY_HP_SCALING = 0.6;

/** Ability strength by rarity (artifacts and skills); common artifacts carry no ability. */
export const ABILITY_POWER = [0, 1, 1.5, 2.2, 3.2];

/**
 * Bonus keys (numbers add up across perks and artifacts; core/commander.js applies them):
 *   heroDamagePct, heroAttackSpeedPct, heroRangeAdd (cells): towers and champion;
 *   heroHpPct, heroCritAdd (points), abilityCooldownPct (reduction), heroXpPct: champion;
 *   towerCostPct, wallCostPct (reductions), wallHpPct, thornsPct, arcanePct, gateHpPct,
 *   startingGoldAdd, killGoldPct, waveBonusPct, prepTimeAdd (seconds),
 *   artifactLuckPct, enemySpeedPct (reduction), enemyHpPct (reduction)
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
  artifactLuckPct: (v) => `+${v}% artifact luck`,
  enemySpeedPct: (v) => `-${v}% enemy speed`,
  enemyHpPct: (v) => `-${v}% enemy health`,
};

/**
 * Level-up choices. Stat perks have `bonus` + `values`; skills have `ability` + `values`
 * (ability power). One number per rarity in RARITIES order; null = never offered at that
 * rarity. Taking the same perk or skill again stacks.
 */
const SKILL_VALUES = [null, 1, 1.5, 2.2, 3.2];
export const PERKS = {
  sharpSteel: { name: 'Sharpened Steel', bonus: 'heroDamagePct', values: [8, 14, 22, 32, 50] },
  quickHands: { name: 'Quick Hands', bonus: 'heroAttackSpeedPct', values: [6, 10, 16, 24, 36] },
  hardened: { name: 'Battle-Hardened', bonus: 'heroHpPct', values: [12, 20, 30, 44, 70] },
  eagleEyes: { name: 'Eagle Eyes', bonus: 'heroRangeAdd', values: [0.3, 0.6, 1, 1.5, 2.4] },
  luckyStrikes: { name: 'Lucky Strikes', bonus: 'heroCritAdd', values: [2, 4, 7, 10, 16] },
  arcaneStudy: { name: 'Arcane Study', bonus: 'abilityCooldownPct', values: [6, 10, 16, 24, 36] },
  mentor: { name: 'Mentor', bonus: 'heroXpPct', values: [16, 28, 44, 64, 100] },
  engineers: { name: 'Siege Engineers', bonus: 'towerCostPct', values: [6, 10, 16, 24, 36] },
  masonry: { name: 'Master Masonry', bonus: 'wallHpPct', values: [10, 18, 28, 40, 64] },
  quarry: { name: 'Quarry Rights', bonus: 'wallCostPct', values: [6, 10, 16, 24, 36] },
  ironSpikes: { name: 'Iron Spikes', bonus: 'thornsPct', values: [20, 36, 56, 80, 120] },
  runecraft: { name: 'Runecraft', bonus: 'arcanePct', values: [16, 28, 44, 64, 100] },
  oakenGate: { name: 'Oaken Gate', bonus: 'gateHpPct', values: [12, 20, 32, 48, 80] },
  warChest: { name: 'War Chest', bonus: 'startingGoldAdd', values: [40, 70, 110, 160, 260] },
  plunder: { name: 'Plunder', bonus: 'killGoldPct', values: [6, 10, 16, 24, 36] },
  tribute: { name: 'Tribute', bonus: 'waveBonusPct', values: [16, 28, 44, 64, 100] },
  scouts: { name: 'Scouts', bonus: 'prepTimeAdd', values: [3, 5, 8, 11, 15] },
  fortune: { name: "Fortune's Favor", bonus: 'artifactLuckPct', values: [6, 10, 16, 24, 40] },
  hallowedGround: { name: 'Hallowed Ground', bonus: 'enemySpeedPct', values: [null, null, null, 8, 14] },
  witheringCurse: { name: 'Withering Curse', bonus: 'enemyHpPct', values: [null, null, null, 6, 10] },
  // Skills: automatic abilities, uncommon and better.
  skillMeteor: { name: 'Meteor', ability: 'meteor', values: SKILL_VALUES },
  skillStorm: { name: 'Storm Call', ability: 'storm', values: SKILL_VALUES },
  skillFrost: { name: "Winter's Breath", ability: 'frost', values: SKILL_VALUES },
  skillJudgement: { name: 'Judgement', ability: 'judgement', values: SKILL_VALUES },
  skillRot: { name: 'Rot Cloud', ability: 'rot', values: SKILL_VALUES },
  skillMasonry: { name: "Mason's Blessing", ability: 'masonry', values: SKILL_VALUES },
  skillBulwark: { name: 'Bulwark', ability: 'bulwark', values: SKILL_VALUES },
  skillTithe: { name: 'War Tithe', ability: 'tithe', values: SKILL_VALUES },
  skillStillness: { name: 'Stillness', ability: 'stillness', values: [null, null, 1.5, 2.2, 3.2] },
};

/**
 * Artifacts: stat bonuses (values per rarity in RARITIES order, multiplied by the artifact's
 * level factor) and, from uncommon up, an automatic ability (power from ABILITY_POWER).
 */
export const ARTIFACTS = {
  bloodstone: { name: 'Bloodstone Amulet', icon: '◆', ability: 'judgement', bonuses: { heroDamagePct: [6, 12, 24, 40, 70] } },
  windcaller: { name: 'Windcaller Feather', icon: '➶', ability: 'storm', bonuses: { heroAttackSpeedPct: [4, 10, 18, 30, 50] } },
  giantsBelt: { name: "Giant's Belt", icon: '▣', ability: 'bulwark', bonuses: { heroHpPct: [10, 20, 36, 60, 100] } },
  falconHood: { name: 'Falcon Hood', icon: '◉', ability: 'meteor', bonuses: { heroRangeAdd: [0.2, 0.5, 1, 1.5, 2.4] } },
  mortar: { name: 'Mortar of Ages', icon: '▦', ability: 'masonry', bonuses: { wallHpPct: [8, 18, 32, 55, 90] } },
  gateWard: { name: 'Ward of the Gate', icon: '⛨', ability: 'bulwark', bonuses: { gateHpPct: [10, 24, 44, 75, 130] } },
  goldenIdol: { name: 'Golden Idol', icon: '♛', ability: 'tithe', bonuses: { killGoldPct: [4, 10, 20, 34, 55] } },
  ledger: { name: "Merchant's Ledger", icon: '✉', ability: 'tithe', bonuses: { startingGoldAdd: [30, 70, 140, 240, 420] } },
  hourglass: { name: 'Cracked Hourglass', icon: '⧗', ability: 'stillness', bonuses: { abilityCooldownPct: [4, 10, 18, 28, 45] } },
  thornCrown: { name: 'Crown of Thorns', icon: '♆', ability: 'rot', bonuses: { thornsPct: [16, 36, 64, 110, 200] } },
  runestone: { name: 'Humming Runestone', icon: '✦', ability: 'frost', bonuses: { arcanePct: [12, 28, 52, 90, 160] } },
  compass: { name: "Hunter's Compass", icon: '✧', ability: 'meteor', bonuses: { artifactLuckPct: [5, 10, 18, 30, 50] } },
  kingslayer: {
    name: "Kingslayer's Edge", icon: '†', ability: 'judgement',
    bonuses: { heroDamagePct: [4, 8, 16, 28, 50], heroCritAdd: [2, 4, 8, 12, 20] },
  },
  heartOfWinter: {
    name: 'Heart of Winter', icon: '❄', ability: 'frost',
    bonuses: { enemySpeedPct: [2, 4, 8, 12, 20], arcanePct: [6, 12, 24, 40, 70] },
  },
};
