// Elemental towers, built on top of walls (one per wall). They are the main source of
// firepower; the single champion hero supports them. Upgrades (levels 2 and 3) are bought
// with gold. Units: range in cells, interval/durations in seconds, speed in cells/s.
//
// Each element has a role:
//   fire  - area damage that sets enemies burning (hordes)
//   earth - slow, heavy boulders that pierce armor and briefly stun (brutes, bosses)
//   wind  - very fast, long-ranged gusts that hit several enemies at once (runners, swarms)
//   water - splashing bolts that slow everything they touch (control)

export const TOWERS = {
  // (stone) rolls a heavy ball in a straight line out from the wall: hits everything on its
  // path and shoves it aside. See TowerSystem.step and CombatSystem.impact (payload.roll).
  fire: {
    name: 'Fire Tower', element: 'Fire', color: 0xff6a20,
    description: 'Explosive fire bolts that set packs of zombies ablaze.',
    strengths: 'Packed hordes', weaknesses: 'Magic-resistant and lone enemies',
    cost: 70,
    damage: 12, damageType: 'fire',
    interval: 1.1, range: 5,
    projectile: { kind: 'firebolt', speed: 11 },
    aoe: 1.0,
    burn: { dps: 4, duration: 3 },
  },
  earth: {
    name: 'Earth Tower', element: 'Earth', color: 0x9a7040,
    description: 'Hurls heavy boulders that crush armor and stagger their target.',
    strengths: 'Brutes, siege zombies, bosses', weaknesses: 'Slow against swarms',
    cost: 90,
    damage: 62, damageType: 'physical', armorPen: 0.4,
    interval: 1.6, range: 5,
    projectile: { kind: 'boulder', speed: 9, arc: 1.2 },
    stun: 0.4,
  },
  wind: {
    name: 'Wind Tower', element: 'Wind', color: 0xbfffd8,
    description: 'Rapid, far-reaching gusts that strike several enemies at once.',
    strengths: 'Runners and swarms of weak enemies', weaknesses: 'Armored targets',
    cost: 60,
    damage: 6, damageType: 'physical',
    interval: 0.5, range: 7,
    projectile: { kind: 'gust', speed: 20 },
    targets: 2,
  },
  water: {
    name: 'Water Tower', element: 'Water', color: 0x4aa8ff,
    description: 'Splashing water bolts that slow everything they hit.',
    strengths: 'Holding the horde under fire', weaknesses: 'Low damage on its own',
    cost: 75,
    damage: 9, damageType: 'magic',
    interval: 1.2, range: 5.5,
    projectile: { kind: 'waterbolt', speed: 12 },
    aoe: 0.8,
    slow: { factor: 0.55, duration: 2 },
  },
  roller: {
    name: 'Rolling Stone Tower', element: 'Stone', color: 0xb8a888,
    description: 'Rolls a huge stone ball down the field that crushes and scatters a whole line.',
    strengths: 'Long lines of zombies, pushing packs apart', weaknesses: 'Slow, can miss lone enemies off its path',
    cost: 85,
    damage: 40, damageType: 'physical',
    interval: 3.2, range: 6,
    /** roll: sideways shove; rollLift: hop; length beyond the target; width of the ball's path. */
    projectile: { kind: 'roller', speed: 5.5, roll: 4.5, rollLift: 2.5, extraLength: 6, width: 0.6 },
  },
};

export const TOWER_RULES = {
  maxLevel: 3,
  /** Each tower already standing raises the next tower's price by this fraction. */
  costGrowth: 0.05,
  /** Upgrade cost to level 2 and 3 as multiples of the tower's base cost. */
  costMult: [0.9, 1.6],
  /** Per level above 1: damage multiplier and range bonus. */
  damageMult: 1.45,
  rangeAdd: 0.5,
  /** Per level above 1: element effects grow. */
  burnMult: 1.5,
  stunAdd: 0.2,
  targetsAdd: 1,
  slowFactorMult: 0.8, // 0.55 -> 0.44 -> 0.35
  /** Fraction of everything invested returned when a tower is sold. */
  sellRefund: 0.5,
  /** Tower ids start here so they never collide with hero ids in damage statistics. */
  idBase: 100000,
};

/** The champion: one hero chosen at the start, standing on a 2x2 block of walls. */
export const CHAMPION = {
  hpMult: 3,
  damageMult: 2.2,
  rangeAdd: 1,
  /** Visual scale of the champion model (heroes were ~0.9 units tall). */
  modelScale: 2,
  /** A giant with a sword or mace: longer reach, heavier blows that cleave (melee weapons only). */
  meleeRangeAdd: 1.5,
  meleeDamageMult: 1.5,
  meleeCleavePct: 35,
};
