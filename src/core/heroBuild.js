// The hero's build (pure, tested in Node): rolling weapons and gear, rolling level-up
// ability offers, and turning weapon + gear + abilities into build mods and final stats.
//
// Build mods are plain numbers that add up (keys ending in "Mult" multiply instead);
// `actives` maps active ability ids to their rank. See config/hero.js for every key.
import { RARITIES } from '../config/rarities.js';

const ri = (r) => RARITIES.indexOf(r);

/** Picks a key with probability proportional to its weight. rnd() -> [0, 1). */
export function pickWeighted(weights, rnd) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = rnd() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1]?.[0] ?? null;
}

/** Rarity roll; luck (percent) multiplies every non-common weight. */
export function rollRarity(weights, rnd, luckPct = 0) {
  const w = {};
  for (const r of RARITIES) w[r] = (weights[r] ?? 0) * (r === 'common' ? 1 : 1 + luckPct / 100);
  return pickWeighted(w, rnd);
}

/** Loot rarity weights at a wave (base + perWave * wave, clamped). */
export function lootOdds(cfg, wave) {
  const w = {};
  for (const r of RARITIES) {
    const o = cfg.LOOT.odds[r];
    w[r] = Math.min(o.max ?? Infinity, Math.max(o.min ?? 0, o.base + o.perWave * Math.max(0, wave)));
  }
  return w;
}

/** Adds mod maps together (Mult keys multiply; actives merge by max rank). */
export function mergeMods(...list) {
  const out = { actives: {} };
  for (const m of list) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (k === 'actives') { for (const [a, r] of Object.entries(v)) out.actives[a] = Math.max(out.actives[a] ?? 0, r); continue; }
      if (k.endsWith('Mult')) out[k] = (out[k] ?? 1) * v;
      else out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

// --- items ------------------------------------------------------------------------------

let itemUid = 1;

/**
 * Creates an item. Weapons have a `style` (a HEROES key). Affixes are rolled from those that
 * exist at the rarity, fit the slot and (for weapons) the delivery of the style.
 */
export function makeItem(cfg, { slot, style = null, rarity = 'common', rnd = Math.random, affixes = null, grants = null }) {
  const i = ri(rarity);
  const count = cfg.ITEM_RARITY.affixes[i] + (slot === 'trinket' ? 1 : 0);
  const delivery = style ? cfg.WEAPON_STYLES[style].delivery : null;
  let rolled = affixes;
  if (!rolled) {
    const pool = Object.entries(cfg.AFFIXES)
      .filter(([, a]) => a.slots.includes(slot) && a.values[i] != null && (!a.delivery || a.delivery === delivery))
      .map(([id]) => id);
    rolled = [];
    for (let n = 0; n < count && pool.length; n++) {
      const id = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      rolled.push({ id, value: cfg.AFFIXES[id].values[i] });
    }
  }
  // Legendary and better weapons carry a free ability that suits them.
  let grant = grants;
  if (!grant && slot === 'weapon' && i >= cfg.ITEM_RARITY.grantsAbilityFrom) {
    const fits = Object.entries(cfg.HERO_ABILITIES)
      .filter(([, a]) => ['rare', 'epic', 'legendary'].includes(a.rarity) && !a.requires && (!a.delivery || a.delivery === delivery))
      .map(([id]) => id);
    if (fits.length) grant = fits[Math.floor(rnd() * fits.length)];
  }
  const names = cfg.ITEM_NAMES[slot === 'weapon' ? style : slot];
  return { uid: itemUid++, slot, style, rarity, name: names[i], affixes: rolled, grants: grant ?? null };
}

/** A random drop for a run at `wave`. */
export function rollItem(cfg, wave, rnd, luckPct = 0) {
  const slot = pickWeighted(cfg.LOOT.slotWeights, rnd);
  const rarity = rollRarity(lootOdds(cfg, wave), rnd, luckPct);
  const styles = Object.keys(cfg.WEAPON_STYLES);
  const style = slot === 'weapon' ? styles[Math.floor(rnd() * styles.length)] : null;
  return makeItem(cfg, { slot, style, rarity, rnd });
}

/** Build mods of one item. */
export function itemMods(cfg, item) {
  if (!item) return null;
  const i = ri(item.rarity);
  const m = {};
  for (const a of item.affixes) m[a.id] = (m[a.id] ?? 0) + a.value;
  if (item.slot === 'weapon') m.weaponDamageMult = cfg.ITEM_RARITY.weaponDamage[i];
  if (item.slot === 'armor') {
    m.hpPct = (m.hpPct ?? 0) + cfg.ITEM_RARITY.armorHpPct[i];
    m.damageReduction = (m.damageReduction ?? 0) + cfg.ITEM_RARITY.armorReduction[i];
  }
  const out = mergeMods(m);
  if (item.grants) Object.assign(out, mergeMods(out, abilityMods(cfg, item.grants, 1, item.style)));
  return out;
}

/** Human-readable lines for an item. */
export function itemLines(cfg, item) {
  const i = ri(item.rarity);
  const lines = [];
  if (item.slot === 'weapon') lines.push(`${cfg.WEAPON_STYLES[item.style].weapon} · ${cfg.ITEM_RARITY.weaponDamage[i]}x damage`);
  if (item.slot === 'armor') lines.push(`+${cfg.ITEM_RARITY.armorHpPct[i]}% health, -${cfg.ITEM_RARITY.armorReduction[i]}% damage taken`);
  for (const a of item.affixes) lines.push(cfg.AFFIXES[a.id].label(a.value));
  if (item.grants) lines.push(`Grants ${cfg.HERO_ABILITIES[item.grants].name}`);
  return lines;
}

// --- abilities -------------------------------------------------------------------------

/** Build mods of an ability at a rank (inactive if it needs another weapon delivery). */
export function abilityMods(cfg, id, rank, style) {
  const a = cfg.HERO_ABILITIES[id];
  if (!a || rank < 1) return null;
  if (a.delivery && style && cfg.WEAPON_STYLES[style].delivery !== a.delivery) return null;
  const m = mergeMods(a.mods ? a.mods(rank) : null);
  if (a.active) m.actives[a.active] = rank;
  return m;
}

/** Whether the ability works with the hero's current weapon. */
export function abilityFits(cfg, id, style) {
  const a = cfg.HERO_ABILITIES[id];
  return !a?.delivery || !style || cfg.WEAPON_STYLES[style].delivery === a.delivery;
}

/** Tags the hero has (from abilities and from item affixes). */
export function heroTags(cfg, hero) {
  const tags = new Set();
  for (const id of Object.keys(hero.abilities ?? {})) for (const t of cfg.HERO_ABILITIES[id]?.tags ?? []) tags.add(t);
  const affixTags = { burnPct: 'fire', poisonPct: 'poison', slowPct: 'frost', critAdd: 'crit', critMultAdd: 'crit', chainChance: 'lightning', knockback: 'physics', bounce: 'projectile', split: 'projectile', pierce: 'projectile' };
  for (const item of [hero.weapon, ...Object.values(hero.gear ?? {})]) {
    for (const a of item?.affixes ?? []) if (affixTags[a.id]) tags.add(affixTags[a.id]);
  }
  if (hero.weapon) tags.add(cfg.WEAPON_STYLES[hero.weapon.style].delivery);
  return tags;
}

/**
 * Three distinct level-up offers. Each card rolls a rarity (luck grows with hero level), then
 * picks an ability of that rarity the hero can take, favouring synergies (shared tags) and
 * rank-ups. Falls back to lower rarities when nothing fits.
 */
export function rollAbilityOffer(cfg, hero, rnd) {
  const o = cfg.ABILITY_OFFER;
  const tags = heroTags(cfg, hero);
  const style = hero.weapon?.style ?? hero.type;
  const offer = [];
  for (let n = 0; n < o.size; n++) {
    let rarity = rollRarity(o.weights, rnd, (hero.level ?? 1) * o.luckPerLevel);
    let pick = null;
    while (!pick && rarity) {
      const weights = {};
      for (const [id, a] of Object.entries(cfg.HERO_ABILITIES)) {
        if (a.rarity !== rarity || offer.some((x) => x.id === id)) continue;
        const rank = hero.abilities?.[id] ?? 0;
        if (rank >= a.maxRank) continue;
        if (a.requires && !tags.has(a.requires)) continue;
        if (!abilityFits(cfg, id, style)) continue;
        let w = 1;
        if (a.tags.some((t) => tags.has(t))) w *= o.synergyWeight;
        if (rank > 0) w *= o.rankUpWeight;
        weights[id] = w;
      }
      const id = pickWeighted(weights, rnd);
      if (id) pick = { id, rarity, rank: (hero.abilities?.[id] ?? 0) + 1, synergy: cfg.HERO_ABILITIES[id].tags.some((t) => tags.has(t)) };
      else rarity = RARITIES[ri(rarity) - 1] ?? null;
    }
    if (pick) offer.push(pick);
  }
  return offer;
}

/** Every build mod the hero has right now. */
export function heroMods(cfg, hero) {
  const style = hero.weapon?.style ?? hero.type;
  const parts = [itemMods(cfg, hero.weapon)];
  for (const g of Object.values(hero.gear ?? {})) parts.push(itemMods(cfg, g));
  for (const [id, rank] of Object.entries(hero.abilities ?? {})) parts.push(abilityMods(cfg, id, rank, style));
  return mergeMods(...parts);
}

/**
 * Final combat stats: `base` from heroStats() (style + level) with the build applied.
 * Adds every mechanic the combat system reads.
 */
export function applyBuild(base, m, delivery) {
  const p = (k) => (m[k] ?? 0) / 100;
  const s = { ...base };
  s.damage = Math.round(base.damage * (m.weaponDamageMult ?? 1) * (1 + p('damagePct')) * 10) / 10;
  s.attackInterval = base.attackInterval / (1 + p('attackSpeedPct'));
  s.maxHp = Math.round(base.maxHp * (1 + p('hpPct')));
  s.range = base.range + (m.rangeAdd ?? 0) + (delivery === 'melee' ? m.meleeRangeAdd ?? 0 : 0);
  s.critChance = Math.min(0.95, base.critChance + p('critAdd'));
  s.critMultiplier = base.critMultiplier + p('critMultAdd');
  s.armorPen = Math.min(1, base.armorPen + p('armorPenAdd'));
  s.aoe = (base.aoe ?? 0) + (m.aoeAdd ?? 0);
  s.pierce = (base.pierce ?? 0) + (m.pierce ?? 0);
  s.cooldownMult = (base.cooldownMult ?? 1) * (1 - Math.min(0.75, p('cooldownPct')));
  Object.assign(s, {
    delivery,
    damageReduction: Math.min(0.8, p('damageReduction')),
    extraProjectiles: m.extraProjectiles ?? 0,
    bounce: m.bounce ?? 0,
    bounceGain: p('bounceGain'),
    split: m.split ?? 0,
    splitGenerations: m.splitGenerations ?? 0,
    cleavePct: p('cleavePct') + (base.cleave ? 0.5 : 0),
    whirlwind: m.whirlwind ?? 0,
    toss: m.toss ?? 0,
    knockback: m.knockback ?? 0,
    blastForce: m.blastForce ?? 0,
    burnPct: p('burnPct') * (m.burnMult ?? 1),
    poisonPct: p('poisonPct'),
    slowPct: Math.min(0.8, p('slowPct')),
    freezeChance: p('freezeChance'),
    chainChance: Math.min(1, p('chainChance')),
    chainTargets: 3 + (m.chainTargets ?? 0),
    critChain: m.critChain ?? 0,
    executePct: p('executePct'),
    shatterPct: p('shatterPct'),
    eliteDmgPct: p('eliteDmgPct'),
    burningDmgPct: p('burningDmgPct'),
    lifestealPct: p('lifestealPct'),
    healOnKillPct: p('healOnKillPct'),
    goldOnKill: m.goldOnKill ?? 0,
    eliteGold: m.eliteGold ?? 0,
    doubleStrike: Math.min(0.9, p('doubleStrike')),
    frenzyMax: p('frenzyMax'),
    corpseBlastPct: p('corpseBlastPct'),
    burnSpread: m.burnSpread ?? 0,
    poisonBurst: m.poisonBurst ?? 0,
    earthshaker: m.earthshaker ?? 0,
    phoenix: m.phoenix ?? 0,
    flameAvatar: m.flameAvatar ?? 0,
    actives: { ...(m.actives ?? {}) },
  });
  return s;
}

/** Config of an active ability at a rank: more damage, shorter cooldown each rank. */
export function activeConfig(cfg, id, rank) {
  const a = cfg.HERO_ACTIVES[id];
  if (!a || !rank) return null;
  const k = 1 + 0.6 * (rank - 1);
  const out = { ...a, rank, cooldown: a.cooldown * 0.85 ** (rank - 1) };
  for (const key of ['damage', 'dps', 'burnDps', 'damageMult', 'blast', 'toss']) if (a[key]) out[key] = a[key] * (key === 'blast' || key === 'toss' ? 1 + 0.25 * (rank - 1) : k);
  if (a.arrows) out.arrows = a.arrows + 2 * (rank - 1);
  return out;
}
