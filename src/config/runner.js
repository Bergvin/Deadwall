// The Runner: one silly little quartermaster (big head, big crate) who keeps the towers
// firing. He carries crates of ammo from the house to the towers, one crate fills one
// tower, and he casts spells that boost the towers around him. Zombies on the road knock
// him over. Every level gives a pick of 3 perks (chosen between waves).
// Units: speed in cells/s, times in seconds, radius in cells.

export const RUNNER = {
  names: [
    'Pip Puddlefoot', 'Barnaby Bumblecrate', 'Wobbles McGee', 'Sir Reginald Dropsalot',
    'Tobias Tinkerboots', 'Fergus Flapjack', 'Humphrey Hurrybottom', 'Nibbles Crumbwhistle',
    'Dobbin Clatterpot', 'Percival Puffcheeks',
  ],
  title: 'the Quartermaster',
  speed: 3.1,
  crates: 2,
  /** Seconds to fill a tower / to pick up crates at the house. */
  refillTime: 0.6,
  reloadTime: 0.8,
  /** How close he must get to a tower or the house door to work there. */
  reach: 0.75,
  /** A zombie this close knocks him over for bonkTime, then he is safe for bonkImmune. */
  bonkRadius: 0.55,
  bonkTime: 1.6,
  bonkImmune: 1.8,
  /** Fraction of the time a bonk also smashes one of his crates. */
  crateLossChance: 0.5,
  /** Auto supply: towers below this ammo fraction are worth a trip. */
  autoThreshold: 0.55,
  /** Spells affect towers within this radius of him. */
  spellRadius: 3,
  /** Model scale and the size of his head (he is silly). */
  modelScale: 1.25,
  headScale: 1.9,
  /** Runner XP: each kill's XP x killXp, plus this fraction of a level per cleared wave. */
  killXp: 1,
  waveClearLevelFraction: 0.35,
  xpToNext: (level) => Math.round(70 + 45 * level + 2 * level ** 2),
  maxLevel: 60,
  /** Picks: rarity weights per card and how fast luck grows with level (percent). */
  offerSize: 3,
  offerWeights: { common: 46, uncommon: 28, rare: 15, epic: 7, legendary: 3, mythical: 1 },
  luckPerLevel: 3,
};

/**
 * Spells (cast by the runner where he stands; towers within the spell radius get the
 * effect). Cast with Q/E/F/G/... or auto-cast. Ranks come from perks: each rank above 1
 * adds rankDuration to the duration, rankPower to the effect and cuts the cooldown.
 *   buff: { attackSpeedPct, damagePct, rangeAdd, critAdd, freeAmmo, jamAfter }
 *   refill: fills ammo instantly; zone: a ground effect at his feet (banana peel)
 */
export const SPELLS = {
  pepTalk: {
    name: 'Pep Talk', icon: '📣', cooldown: 18, duration: 6,
    buff: { attackSpeedPct: 50 },
    text: 'Towers nearby attack 50% faster.',
  },
  bottomless: {
    name: 'Bottomless Pockets', icon: '🎒', cooldown: 30, duration: 8,
    buff: { freeAmmo: true },
    text: 'Towers nearby use no ammo.',
  },
  overclock: {
    name: 'Duct-Tape Overclock', icon: '🔧', cooldown: 26, duration: 5,
    buff: { damagePct: 100, jamAfter: 2 },
    text: 'Towers nearby deal double damage, then jam for 2s.',
  },
  luckySocks: {
    name: 'Lucky Socks', icon: '🧦', cooldown: 22, duration: 8,
    buff: { critAdd: 35 },
    text: 'Towers nearby get +35% critical chance (double damage).',
  },
  stilts: {
    name: 'Stilts', icon: '🪜', cooldown: 24, duration: 8,
    buff: { rangeAdd: 2 },
    text: 'Towers nearby get +2 range.',
  },
  teaBreak: {
    name: 'Tea Break', icon: '🫖', cooldown: 40, refill: true, radiusAdd: 1,
    text: 'Instantly refills every tower nearby.',
  },
  bananaPeel: {
    name: 'Banana Peel', icon: '🍌', cooldown: 20, duration: 6,
    zone: { radius: 1.3, stun: 1.2 },
    text: 'Drops a banana peel: the dead slip and fall over (stunned).',
  },
};

/** Per rank above 1. */
export const SPELL_RANK = { duration: 0.3, power: 0.25, cooldown: 0.12, maxRank: 4 };

/**
 * Runner perks offered on level-up. rarity, maxRank and `mods(rank)` (summed over ranks the
 * runner has) or `spell` (learn the spell, later picks rank it up).
 * Mod keys: speedPct, crates, refillPct (faster), cooldownPct (spell), radiusAdd (spell),
 * bonkPct (shorter), bonkImmune, auraDamagePct/auraRadius (towers near him), refillHaste
 * (tower attack speed after a refill), recycle (ammo back per kill), tinker (ammo/s to
 * towers near him), goldenAmmo (refilled towers +% damage), stomp (he flattens zombies
 * instead of falling over), twin (a second runner), perpetual (towers near him need no
 * ammo), xpPct.
 */
export const RUNNER_PERKS = {
  // Common
  sneakers: { name: 'Squeaky Sneakers', rarity: 'common', maxRank: 5, mods: (r) => ({ speedPct: 10 * r }), text: (r) => `+${10 * r}% running speed` },
  backpack: { name: 'Bigger Backpack', rarity: 'common', maxRank: 4, mods: (r) => ({ crates: r }), text: (r) => `Carries ${r} more crate${r > 1 ? 's' : ''}` },
  coffee: { name: 'Strong Coffee', rarity: 'common', maxRank: 5, mods: (r) => ({ cooldownPct: 8 * r }), text: (r) => `-${8 * r}% spell cooldowns` },
  whistle: { name: 'Loud Whistle', rarity: 'common', maxRank: 4, mods: (r) => ({ radiusAdd: 0.5 * r }), text: (r) => `+${0.5 * r} spell radius` },
  nimble: { name: 'Nimble Fingers', rarity: 'common', maxRank: 3, mods: (r) => ({ refillPct: 25 * r }), text: (r) => `Refills and reloads ${25 * r}% faster` },
  // Uncommon
  helmet: { name: 'Saucepan Helmet', rarity: 'uncommon', maxRank: 3, mods: (r) => ({ bonkPct: 25 * r }), text: (r) => `Knocked over ${25 * r}% shorter` },
  oiled: { name: 'Oiled Gears', rarity: 'uncommon', maxRank: 3, mods: (r) => ({ refillHaste: 25 * r }), text: (r) => `A tower he refills attacks ${25 * r}% faster for 8s` },
  recycler: { name: 'Ammo Recycler', rarity: 'uncommon', maxRank: 3, mods: (r) => ({ recycle: 0.34 * r }), text: (r) => `Kills give the killing tower ${Math.round(34 * r)}% of a shot back` },
  learnPep: { name: 'Pep Talk', rarity: 'uncommon', spell: 'pepTalk' },
  learnSocks: { name: 'Lucky Socks', rarity: 'uncommon', spell: 'luckySocks' },
  learnBanana: { name: 'Banana Peel', rarity: 'uncommon', spell: 'bananaPeel' },
  learnStilts: { name: 'Stilts', rarity: 'uncommon', spell: 'stilts' },
  // Rare
  cheerleader: { name: 'Cheerleader', rarity: 'rare', maxRank: 3, mods: (r) => ({ auraDamagePct: 15 * r, auraRadius: 2.5 }), text: (r) => `Towers within 2.5 of him deal +${15 * r}% damage` },
  tinker: { name: 'Tinkerer', rarity: 'rare', maxRank: 3, mods: (r) => ({ tinker: 0.6 * r }), text: (r) => `Towers within 2 of him regain ${(0.6 * r).toFixed(1)} shots per second` },
  learnBottomless: { name: 'Bottomless Pockets', rarity: 'rare', spell: 'bottomless' },
  learnOverclock: { name: 'Duct-Tape Overclock', rarity: 'rare', spell: 'overclock' },
  learnTea: { name: 'Tea Break', rarity: 'rare', spell: 'teaBreak' },
  wisdom: { name: 'Pocket Almanac', rarity: 'rare', maxRank: 3, mods: (r) => ({ xpPct: 20 * r }), text: (r) => `+${20 * r}% runner XP` },
  // Epic
  goldenAmmo: { name: 'Golden Ammo', rarity: 'epic', maxRank: 2, mods: (r) => ({ goldenAmmo: 25 * r }), text: (r) => `Towers he refills deal +${25 * r}% damage until their next refill` },
  stomp: { name: 'Stompy Boots', rarity: 'epic', maxRank: 1, mods: () => ({ stomp: 1 }), text: () => 'Zombies that touch him get flattened (stunned and hurt) instead of him' },
  crates: { name: 'Crate on a Stick', rarity: 'epic', maxRank: 2, mods: (r) => ({ crates: 2 * r, speedPct: 5 * r }), text: (r) => `${2 * r} more crates, +${5 * r}% speed` },
  // Legendary
  twin: { name: 'Twin Brother', rarity: 'legendary', maxRank: 1, mods: () => ({ twin: 1 }), text: () => 'His twin brother shows up and runs ammo too' },
  express: { name: 'Express Delivery', rarity: 'legendary', maxRank: 1, mods: () => ({ speedPct: 35, refillPct: 100 }), text: () => '+35% speed, instant refills' },
  // Mythical
  perpetual: { name: 'Perpetual Motion', rarity: 'mythical', maxRank: 1, mods: () => ({ perpetual: 3.5 }), text: () => 'Towers within 3.5 of him need no ammo at all' },
  timeLord: { name: 'Pocket Watch of Ages', rarity: 'mythical', maxRank: 1, mods: () => ({ cooldownPct: 40, durationPct: 50 }), text: () => '-40% spell cooldowns, +50% spell duration' },
};
