// Commander progression (pure logic, no DOM, tested in Node): run XP and levels, random
// level-up offers with rarities, artifact stash and equipment, loot rolls, and turning
// perks + equipped artifacts into a modified copy of the gameplay config for one run.
//
// A commander record lives in the save (see save.js) and looks like:
//   { level, xp, pendingPicks, offer: [{id, rarity}] | null, perks: [{id, rarity}],
//     artifacts: [{uid, id, rarity}], equipped: [uid], nextUid }
// Functions that change a commander mutate the record they are given.
import { RARITIES, RARITY_INFO, COMMANDER, PERKS, ARTIFACTS, LOOT_TABLES, BONUS_LABELS } from '../config/commander.js';

export function commanderDefaults() {
  return { level: 1, xp: 0, pendingPicks: 0, offer: null, perks: [], artifacts: [], equipped: [], nextUid: 1 };
}

/** Picks a key of `weights` with probability proportional to its weight. rnd() -> [0, 1). */
export function rollWeighted(weights, rnd) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [k, w] of entries) {
    if ((r -= w) < 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** Rarity roll; luck (percent) multiplies the weight of everything better than common. */
export function rollRarity(weights, rnd, luckPct = 0) {
  const w = {};
  for (const r of RARITIES) w[r] = (weights[r] ?? 0) * (r === 'common' ? 1 : 1 + luckPct / 100);
  return rollWeighted(w, rnd);
}

export const rarityIndex = (r) => RARITIES.indexOf(r);

/** Artifact slots unlocked at a commander level. */
export function slotCount(level) {
  return COMMANDER.baseSlots + COMMANDER.slotLevels.filter((l) => level >= l).length;
}

/** Commander XP earned by a finished run. */
export function runXp(summary) {
  const c = COMMANDER;
  const cleared = Math.max(0, summary.wavesCleared | 0);
  const wave = Math.max(0, summary.wave | 0);
  return cleared * c.xpPerWaveCleared + Math.round(wave ** 1.5 * c.xpDepthFactor)
    + Math.floor(Math.max(0, summary.kills | 0) / c.killsPerXp);
}

/** Adds XP and levels up as often as it allows. Each level grants one pending pick. */
export function addXp(cmd, xp) {
  let levels = 0;
  cmd.xp += Math.max(0, Math.floor(xp));
  while (cmd.xp >= COMMANDER.xpToNext(cmd.level)) {
    cmd.xp -= COMMANDER.xpToNext(cmd.level);
    cmd.level++;
    cmd.pendingPicks++;
    levels++;
  }
  return levels;
}

/** Value of a perk at a rarity, or null when the perk never comes in that rarity. */
export function perkValue(id, rarity) {
  return PERKS[id]?.values[rarityIndex(rarity)] ?? null;
}

/** {bonusKey: value} of an artifact at a rarity. */
export function artifactBonuses(id, rarity) {
  const out = {};
  const i = rarityIndex(rarity);
  for (const [k, vals] of Object.entries(ARTIFACTS[id]?.bonuses ?? {})) {
    if (vals[i]) out[k] = vals[i];
  }
  return out;
}

/** Human-readable lines for a bonus map. */
export function describeBonuses(bonuses) {
  return Object.entries(bonuses)
    .filter(([k, v]) => v && BONUS_LABELS[k])
    .map(([k, v]) => BONUS_LABELS[k](Math.round(v * 100) / 100));
}

/**
 * Three distinct perks, each with its own rarity roll. A perk that does not exist at the
 * rolled rarity is skipped in favour of one that does.
 */
export function rollOffer(rnd, size = COMMANDER.offerSize) {
  const offer = [];
  const used = new Set();
  for (let n = 0; n < size; n++) {
    const rarity = rollRarity(COMMANDER.offerWeights, rnd);
    const pool = Object.keys(PERKS).filter((id) => !used.has(id) && perkValue(id, rarity) !== null);
    if (!pool.length) break;
    const id = pool[Math.floor(rnd() * pool.length)];
    used.add(id);
    offer.push({ id, rarity });
  }
  return offer;
}

/** Makes sure an offer is waiting when the commander has picks to spend. */
export function ensureOffer(cmd, rnd = Math.random) {
  if (cmd.pendingPicks > 0 && !cmd.offer?.length) cmd.offer = rollOffer(rnd);
  if (cmd.pendingPicks <= 0) cmd.offer = null;
  return cmd.offer;
}

/** Takes option `index` of the current offer. Returns the chosen perk or null. */
export function choosePerk(cmd, index, rnd = Math.random) {
  const choice = cmd.pendingPicks > 0 ? cmd.offer?.[index] : null;
  if (!choice) return null;
  cmd.perks.push({ id: choice.id, rarity: choice.rarity });
  cmd.pendingPicks--;
  cmd.offer = null;
  ensureOffer(cmd, rnd);
  return choice;
}

/**
 * Stores a dropped artifact. A full stash salvages it for XP instead.
 * @returns {{artifact: object|null, salvagedXp: number}}
 */
export function addArtifact(cmd, { id, rarity }) {
  if (!ARTIFACTS[id] || rarityIndex(rarity) < 0) return { artifact: null, salvagedXp: 0 };
  if (cmd.artifacts.length >= COMMANDER.maxStash) {
    const xp = RARITY_INFO[rarity].salvageXp;
    addXp(cmd, xp);
    return { artifact: null, salvagedXp: xp };
  }
  const artifact = { uid: cmd.nextUid++, id, rarity };
  cmd.artifacts.push(artifact);
  // Fill a free slot automatically so a first find is useful straight away.
  if (cmd.equipped.length < slotCount(cmd.level)) cmd.equipped.push(artifact.uid);
  return { artifact, salvagedXp: 0 };
}

export function equip(cmd, uid) {
  if (cmd.equipped.includes(uid) || !cmd.artifacts.some((a) => a.uid === uid)) return false;
  if (cmd.equipped.length >= slotCount(cmd.level)) return false;
  cmd.equipped.push(uid);
  return true;
}

export function unequip(cmd, uid) {
  const i = cmd.equipped.indexOf(uid);
  if (i < 0) return false;
  cmd.equipped.splice(i, 1);
  return true;
}

/** Destroys an artifact for commander XP. Returns levels gained (or -1 if not found). */
export function salvage(cmd, uid) {
  const i = cmd.artifacts.findIndex((a) => a.uid === uid);
  if (i < 0) return -1;
  const [a] = cmd.artifacts.splice(i, 1);
  unequip(cmd, uid);
  return addXp(cmd, RARITY_INFO[a.rarity].salvageXp);
}

/** Sum of every perk and every equipped artifact. */
export function totalBonuses(cmd) {
  const total = {};
  const add = (k, v) => { if (v) total[k] = Math.round(((total[k] ?? 0) + v) * 1000) / 1000; };
  for (const p of cmd.perks) add(PERKS[p.id]?.bonus, perkValue(p.id, p.rarity));
  for (const uid of cmd.equipped) {
    const a = cmd.artifacts.find((x) => x.uid === uid);
    if (a) for (const [k, v] of Object.entries(artifactBonuses(a.id, a.rarity))) add(k, v);
  }
  return total;
}

/** Rolls a drop from a loot table. Returns {id, rarity} or null when nothing drops. */
export function rollLoot(tableKey, rnd, luckPct = 0) {
  const t = LOOT_TABLES[tableKey];
  if (!t || rnd() >= t.chance) return null;
  const rarity = rollRarity(t.weights, rnd, luckPct);
  const ids = Object.keys(ARTIFACTS).filter((id) => Object.keys(artifactBonuses(id, rarity)).length);
  return { id: ids[Math.floor(rnd() * ids.length)], rarity };
}

/** Deep copy that keeps functions (config holds a few formulas). */
function cloneConfig(v) {
  if (Array.isArray(v)) return v.map(cloneConfig);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = cloneConfig(x);
    return o;
  }
  return v;
}

/**
 * Returns a modified copy of the gameplay config (`base` is never changed). Reductions are
 * capped at COMMANDER.maxReductionPct.
 */
export function applyBonuses(base, b = {}) {
  const c = cloneConfig({ ...base });
  const pct = (k) => (b[k] ?? 0) / 100;
  const more = (k) => 1 + pct(k);
  const less = (k) => 1 - Math.min(COMMANDER.maxReductionPct, b[k] ?? 0) / 100;

  // Damage, attack speed and range help every defender: towers and the champion.
  for (const h of Object.values(c.HEROES)) {
    h.damage *= more('heroDamagePct');
    h.attackInterval /= more('heroAttackSpeedPct');
    h.hp = Math.round(h.hp * more('heroHpPct'));
    h.range += b.heroRangeAdd ?? 0;
    h.critChance += pct('heroCritAdd');
    for (const a of Object.values(h.abilities ?? {})) a.cooldown *= less('abilityCooldownPct');
  }
  for (const t of Object.values(c.TOWERS ?? {})) {
    t.damage *= more('heroDamagePct');
    if (t.burn) t.burn.dps *= more('heroDamagePct');
    t.interval /= more('heroAttackSpeedPct');
    t.range += b.heroRangeAdd ?? 0;
    t.cost = Math.max(1, Math.round(t.cost * less('towerCostPct')));
  }
  c.HERO_RULES.xpPerDamage *= more('heroXpPct');

  for (const w of Object.values(c.WALLS)) {
    w.maxHp = Math.round(w.maxHp * more('wallHpPct'));
    w.cost = Math.max(1, Math.round(w.cost * less('wallCostPct')));
    if (w.thorns) w.thorns *= more('thornsPct');
    if (w.arcane) w.arcane.pulseDamage *= more('arcanePct');
  }
  c.FORTRESS.gateMaxHp = Math.round(c.FORTRESS.gateMaxHp * more('gateHpPct'));
  c.ECONOMY.startingGold += Math.round(b.startingGoldAdd ?? 0);
  c.WAVES.clearBonusBase *= more('waveBonusPct');
  c.WAVES.clearBonusPerWave *= more('waveBonusPct');
  c.WAVES.prepTime += b.prepTimeAdd ?? 0;
  c.WAVES.firstPrepTime += b.prepTimeAdd ?? 0;
  c.WANDERERS.chance *= more('wandererChancePct');

  for (const z of Object.values(c.ZOMBIES)) {
    z.xp *= more('heroXpPct');
    z.speed *= less('enemySpeedPct');
    z.hp = Math.max(1, Math.round(z.hp * less('enemyHpPct')));
  }
  c.BONUS = { ...c.BONUS, killGoldPct: b.killGoldPct ?? 0, artifactLuckPct: b.artifactLuckPct ?? 0 };
  return c;
}
