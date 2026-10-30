// Towers stand on free ground beside the roads. There are only a few slots (TOWER_RULES),
// so every tower matters: each one can be upgraded many times (expensive), picks one of
// two specialisations on the way, and runs on ammo that the runner has to bring.
// Units: range in cells, interval/durations in seconds, speed in cells/s.
//
//   ammo        shots per full load (one shot per attack, a volley is one shot)
//   damageType  physical (armor), magic and fire (resist), poison/true (neither)
//   specs       two exclusive specialisations chosen at TOWER_RULES.specLevel; `mods` are
//               applied on top of the level stats (Mult keys multiply, Add keys add, other
//               keys are set)
//   detect      can aim at stealthy enemies (Wraiths)
//   reveal      lights up stealthy enemies in range for every tower (Watchtower)
//   tags        attack tags: 'sharp' bounces off Ironclads
//   poison      damage over time that ignores armor and resist and stops regeneration
//   chain       lightning: {jumps, range, falloff} to the nearest enemies after the target
//   aimed       shoots along a direction the player sets (the line it covers), not at targets
//
// Who beats what (see the enemies' traits in enemies.js):
//   Wraith (stealth)  needs detect or a Watchtower nearby
//   Ghost (no physical) Fire, Frost, Arcane, Alchemist, Tesla, Watchtower
//   Ironclad (no sharp) everything but Arrow and Gale
//   Rotter (regrows)  Alchemist poison stops the regrowth; burst damage helps

export const TOWERS = {
  arrow: {
    name: 'Arrow Tower', icon: '➶', color: 0xd8c8a0,
    description: 'Fast, far-reaching arrows. Cheap ammo, steady damage.',
    strengths: 'Runners, everything early', weaknesses: 'Armored brutes',
    cost: 100, ammo: 40,
    damage: 13, damageType: 'physical', interval: 0.7, range: 5.5,
    projectile: { kind: 'arrow', speed: 18 },
    tags: ['sharp'],
    specs: {
      a: { name: 'Volley', text: 'Shoots 3 targets at once.', mods: { targetsAdd: 2 } },
      b: { name: 'Sniper', text: '+3 range, double damage, triple against elites and bosses; slower. Sees stealth.', mods: { rangeAdd: 3, damageMult: 2, bossMult: 1.5, intervalMult: 1.35, detect: true } },
    },
  },
  fire: {
    name: 'Fire Tower', icon: '♨', color: 0xff6a20,
    description: 'Firebombs that explode and set the pack burning.',
    strengths: 'Packs, swarms, armored brutes', weaknesses: 'Plague carriers resist it',
    cost: 140, ammo: 20,
    damage: 15, damageType: 'fire', interval: 1.4, range: 4.5, aoe: 1.2,
    burn: { dps: 6, duration: 3 },
    projectile: { kind: 'firebolt', speed: 11, arc: 1 },
    specs: {
      a: { name: 'Napalm', text: 'Leaves burning ground on the road.', mods: { napalm: { radius: 1.1, duration: 3, dpsMult: 1.2 } } },
      b: { name: 'Inferno', text: 'Bigger blasts, double burn.', mods: { aoeMult: 1.6, burnMult: 2 } },
    },
  },
  frost: {
    name: 'Frost Tower', icon: '❄', color: 0x8fd8ff,
    description: 'Icy shards that slow everything they splash.',
    strengths: 'Runners, holding the horde under fire', weaknesses: 'Low damage on its own',
    cost: 120, ammo: 30,
    damage: 8, damageType: 'magic', interval: 1.2, range: 5, aoe: 1,
    slow: { factor: 0.55, duration: 2 },
    projectile: { kind: 'waterbolt', speed: 12 },
    specs: {
      a: { name: 'Deep Freeze', text: '20% chance to freeze solid for 1.5s.', mods: { freezeChance: 0.2, freezeTime: 1.5 } },
      b: { name: 'Blizzard', text: 'Twice the splash, stronger slow.', mods: { aoeMult: 2, slowFactorMult: 0.7 } },
    },
  },
  boulder: {
    name: 'Boulder Tower', icon: '◆', color: 0xa07848,
    description: 'Hurls heavy boulders that crush armor and stagger.',
    strengths: 'Brutes, siege zombies, bosses', weaknesses: 'Slow, little ammo',
    cost: 170, ammo: 12,
    damage: 55, damageType: 'physical', armorPen: 0.5, interval: 2.4, range: 5, aoe: 0.5, stun: 0.3,
    projectile: { kind: 'boulder', speed: 9, arc: 1.4 },
    specs: {
      a: { name: 'Quake', text: 'Huge impact area that stuns everything hit.', mods: { aoeMult: 2.6, stunAdd: 0.4, stunAll: true } },
      b: { name: 'Armor Breaker', text: 'Ignores armor and strips it from its victims.', mods: { armorPen: 1, shred: { amount: 0.5, duration: 6 }, damageMult: 1.3 } },
    },
  },
  gale: {
    name: 'Gale Tower', icon: '≋', color: 0xbfffd8,
    description: 'Gusts of wind that blow the dead back down the road.',
    strengths: 'Buying time, keeping them under fire longer', weaknesses: 'Bosses barely move',
    cost: 130, ammo: 25,
    damage: 6, damageType: 'physical', interval: 1.1, range: 4.5, targets: 2, knock: 3,
    projectile: { kind: 'gust', speed: 20 },
    tags: ['sharp'],
    specs: {
      a: { name: 'Hurricane', text: 'Throws them into the air: they land hard, further back.', mods: { knockMult: 1.3, lift: 7, aoe: 0.9 } },
      b: { name: 'Tailwind', text: 'Hits 3 more targets, pushes twice as far.', mods: { targetsAdd: 3, knockMult: 2 } },
    },
  },
  roller: {
    name: 'Rolling Stone', icon: '●', color: 0xb8a888,
    description: 'Rolls a huge stone ball down the line that crushes and scatters everything on it.',
    strengths: 'Long lines of zombies on a straight road', weaknesses: 'Very slow, very little ammo',
    cost: 160, ammo: 8,
    damage: 45, damageType: 'physical', interval: 3.5, range: 6,
    projectile: { kind: 'roller', speed: 6, extraLength: 5, width: 0.7, roll: 3.5, rollLift: 2 },
    specs: {
      a: { name: 'Twin Stones', text: 'Rolls two balls side by side.', mods: { balls: 2 } },
      b: { name: 'Spiked Ball', text: 'Spikes make every victim bleed and pierce armor.', mods: { bleed: { dps: 0.35, duration: 4 }, armorPen: 0.6 } },
    },
  },
  watchtower: {
    name: 'Watchtower', icon: '◉', color: 0xffe38a,
    description: 'A lantern on a tall post. Lights up invisible Wraiths in range so every tower can shoot them.',
    strengths: 'Wraiths (reveals them), Ghosts', weaknesses: 'Very little damage of its own',
    cost: 110, ammo: 40,
    damage: 6, damageType: 'magic', interval: 1, range: 5.5,
    projectile: { kind: 'lightbolt', speed: 16 },
    detect: true, reveal: true,
    specs: {
      a: { name: 'Beacon', text: '+2.5 range: lights up a much bigger area.', mods: { rangeAdd: 2.5 } },
      b: { name: "Hunter's Mark", text: 'Enemies in its light take 25% more damage from every tower.', mods: { markPct: 25 } },
    },
  },
  arcane: {
    name: 'Arcane Tower', icon: '✦', color: 0xb07aff,
    description: 'Magic bolts that ignore armor and go right through ghosts and iron.',
    strengths: 'Ghosts, Ironclads, Brutes', weaknesses: 'Plague carriers resist magic; pricey',
    cost: 150, ammo: 30,
    damage: 17, damageType: 'magic', interval: 1, range: 5,
    projectile: { kind: 'arcane', speed: 14 },
    specs: {
      a: { name: 'Arcane Missiles', text: 'Shoots 3 targets at once.', mods: { targetsAdd: 2 } },
      b: { name: 'Seer', text: 'Sees stealth, +1.5 range, +20% damage.', mods: { detect: true, rangeAdd: 1.5, damageMult: 1.2 } },
    },
  },
  alchemist: {
    name: 'Alchemist', icon: '⚗', color: 0x7cff5a,
    description: 'Flasks of poison that splash and eat through armor and resist. Stops Rotters regrowing.',
    strengths: 'Brutes, Rotters, Ghosts, bosses', weaknesses: 'Slow to kill: fast runners get through',
    cost: 130, ammo: 20,
    damage: 4, damageType: 'poison', interval: 1.5, range: 4.5, aoe: 1,
    poison: { dps: 9, duration: 4 },
    projectile: { kind: 'flask', speed: 9, arc: 1.2 },
    specs: {
      a: { name: 'Corrosive', text: 'Strips half their armor for 5s.', mods: { shred: { amount: 0.5, duration: 5 } } },
      b: { name: 'Plague Cask', text: 'Bigger splash, poison 60% stronger.', mods: { aoeMult: 1.8, poisonMult: 1.6 } },
    },
  },
  tesla: {
    name: 'Tesla Coil', icon: 'ϟ', color: 0x9fe8ff,
    description: 'Lightning that jumps from enemy to enemy.',
    strengths: 'Packs, swarms, Ghosts, Ironclads', weaknesses: 'Bosses and lone enemies; plague resists',
    cost: 160, ammo: 25,
    damage: 13, damageType: 'magic', interval: 1.3, range: 4.5,
    chain: { jumps: 3, range: 2, falloff: 0.8 },
    projectile: { kind: 'spark', speed: 0 },
    specs: {
      a: { name: 'Storm Coil', text: 'Jumps to 3 more enemies.', mods: { jumpsAdd: 3 } },
      b: { name: 'Overload', text: '80% more damage and a short stun on the first target.', mods: { damageMult: 1.8, stunAdd: 0.3 } },
    },
  },
  ballista: {
    name: 'Ballista', icon: '➹', color: 0xc8a070,
    description: 'Shoots huge bolts in the direction you aim it; each bolt goes through everything on its line.',
    strengths: 'Long straight roads, Ironclads, big groups in a line', weaknesses: 'Ghosts; only covers its line',
    cost: 150, ammo: 16,
    damage: 38, damageType: 'physical', armorPen: 0.3, interval: 2, range: 9,
    projectile: { kind: 'ballista', speed: 22, width: 0.55 },
    aimed: true,
    specs: {
      a: { name: 'Repeater', text: 'Shoots twice as often.', mods: { intervalMult: 0.5 } },
      b: { name: 'Siege Bolt', text: 'Double damage, shoves them back down the road.', mods: { damageMult: 2, knock: 1.6 } },
    },
  },
};

export const TOWER_RULES = {
  maxLevel: 10,
  /**
   * Upgrades are paid at once but built by the runner: he walks over and works on the tower
   * for buildTime(level) seconds (level = the level being built). The tower is out of action
   * while he works on it.
   */
  buildTime: (level) => 2 + 0.6 * level,
  /** Free cells required between two towers (1 = no tower on the 8 cells around another). */
  spacing: 1,
  /** Upgrading to this level asks for one of the tower's two specialisations. */
  specLevel: 5,
  /** Upgrade to level L+1 costs base cost x upgradeBase x upgradeGrowth^(L-1). */
  upgradeBase: 0.75,
  upgradeGrowth: 1.42,
  /** Per level above 1. */
  damageMult: 1.3,
  rangeAdd: 0.15,
  intervalMult: 0.97,
  ammoMult: 1.08,
  burnMult: 1.25,
  knockAdd: 0.2,
  slowFactorMult: 0.97,
  stunAdd: 0.02,
  /** Tower slots: base, +1 when each listed wave is reached, plus commander bonuses. */
  baseSlots: 5,
  slotWaves: [8, 16, 26, 38, 50],
  maxSlots: 10,
  /** Fraction of everything invested returned when a tower is sold. */
  sellRefund: 0.6,
  /** Tower ids start here so they never collide with other ids in damage statistics. */
  idBase: 100000,
  /** Below this ammo fraction a tower calls for the runner (HUD warning, auto supply). */
  lowAmmo: 0.35,
};

/** Targeting modes for towers. */
export const TARGETING = {
  first: 'First (closest to the house)',
  last: 'Last',
  strongest: 'Strongest',
  nearest: 'Nearest',
};
