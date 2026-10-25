// Pure stat derivation: a hero's effective numbers from class config, level and talents.
// Used for live combat and for "projected stats" previews in the upgrade UI.

/** Merges the mods of every chosen talent. Multipliers multiply, everything else adds. */
export function talentMods(typeCfg, talentIds) {
  const mods = {};
  for (const tier of typeCfg.talents ?? []) {
    for (const opt of tier.options) {
      if (!talentIds.includes(opt.id)) continue;
      for (const [k, v] of Object.entries(opt.mods)) {
        if (k.endsWith('Mult')) mods[k] = (mods[k] ?? 1) * v;
        else mods[k] = (mods[k] ?? 0) + v;
      }
    }
  }
  return mods;
}

/**
 * @param {object} t  hero class config (config/heroes.js)
 * @param {number} level
 * @param {string[]} talentIds
 */
export function heroStats(t, level, talentIds = []) {
  const m = talentMods(t, talentIds);
  const g = t.growth ?? {};
  const L = level - 1;
  const grow = (base, rate) => base * (1 + (rate ?? 0) * L);
  const attackSpeed = (1 / t.attackInterval) * (1 + (g.attackSpeed ?? 0) * L) * (m.attackSpeedMult ?? 1);
  return {
    maxHp: Math.round(grow(t.hp, g.hp)),
    damage: Math.round(grow(t.damage, g.damage) * (m.damageMult ?? 1) * 10) / 10,
    damageType: t.damageType,
    attackInterval: 1 / attackSpeed,
    range: t.range + (m.rangeAdd ?? 0),
    critChance: Math.min(0.9, t.critChance + (m.critAdd ?? 0)),
    critMultiplier: t.critMultiplier,
    armorPen: Math.min(1, (t.armorPen ?? 0) + (g.armorPen ?? 0) * L + (m.armorPenAdd ?? 0)),
    aoe: t.attack.aoe ? grow(t.attack.aoe, g.aoe) + (m.aoeAdd ?? 0) : (m.boltAoe ?? 0),
    pierce: m.pierce ?? 0,
    cleave: m.cleave ?? 0,
    poisonDps: t.poisonDps ? grow(t.poisonDps, g.poison) * (m.poisonMult ?? 1) : 0,
    poisonDuration: t.poisonDuration ? t.poisonDuration + (m.poisonDurationAdd ?? 0) : 0,
    wallGuard: t.wallGuard ? Math.min(0.8, grow(t.wallGuard, 0) + (g.wallGuard ?? 0) * L + (m.wallGuardAdd ?? 0)) : 0,
    guardAdjacent: !!m.guardAdjacent,
    repairPerSec: t.repairPerSec ? grow(t.repairPerSec, g.repair) * (m.repairMult ?? 1) : 0,
    auraRadius: t.auraRadius ?? 0,
    auraGuard: m.auraGuard ?? 0,
    cooldownMult: m.cooldownMult ?? 1,
    abilityDamageMult: m.abilityDamageMult ?? 1,
    mods: m,
  };
}

/** Abilities of a class with their unlock state at `level`. */
export function abilityList(t, level) {
  return Object.entries(t.abilities ?? {}).map(([id, a]) => ({ id, ...a, unlocked: level >= a.unlock }));
}
