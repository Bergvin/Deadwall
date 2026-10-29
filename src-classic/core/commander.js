// Commander progression (pure logic, no DOM, tested in Node): run XP and levels, random
// level-up offers (stat perks and skills) with rarities, the run-end artifact choice,
// artifact stash, equipment and merging, and turning all of it into a modified copy of the
// gameplay config for one run.
//
// A commander record lives in the save (see save.js) and looks like:
//   { level, xp, pendingPicks, offer: [{id, rarity}] | null, perks: [{id, rarity}],
//     artifacts: [{uid, id, rarity, level}], equipped: [uid], nextUid,
//     artifactOffer: [{id, rarity}] | null, autoSalvage: { on, keep: [rarity] } }
// Functions that change a commander mutate the record they are given.
import {
  RARITIES, RARITY_INFO, COMMANDER, PERKS, ARTIFACTS, ARTIFACT_ODDS, ABILITIES, ABILITY_POWER, BONUS_LABELS,
} from '../config/commander.js';

export function commanderDefaults() {
  return {
    level: 1, xp: 0, pendingPicks: 0, offer: null, perks: [], artifacts: [], equipped: [], nextUid: 1, artifactOffer: null,
    autoSalvage: { on: false, keep: RARITIES.slice(1) },
  };
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

// --- perks and skills ----------------------------------------------------------

/** Value of a perk/skill at a rarity, or null when it never comes in that rarity. */
export function perkValue(id, rarity) {
  return PERKS[id]?.values[rarityIndex(rarity)] ?? null;
}

export const isSkill = (id) => !!PERKS[id]?.ability;

/**
 * Three distinct level-up choices, each with its own rarity roll. A choice that does not
 * exist at the rolled rarity is skipped in favour of one that does.
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

// --- artifacts ---------------------------------------------------------------------

/** Strength multiplier of an artifact level (level 1 = 1). */
export const levelFactor = (level = 1) => 1 + COMMANDER.artifactLevelBonus * (Math.max(1, level) - 1);

/** {bonusKey: value} of an artifact at a rarity and level. */
export function artifactBonuses(id, rarity, level = 1) {
  const out = {};
  const i = rarityIndex(rarity);
  for (const [k, vals] of Object.entries(ARTIFACTS[id]?.bonuses ?? {})) {
    if (vals[i]) out[k] = Math.round(vals[i] * levelFactor(level) * 100) / 100;
  }
  return out;
}

/** {id, power} of an artifact's ability, or null (common artifacts have none). */
export function artifactAbility(id, rarity, level = 1) {
  const a = ARTIFACTS[id]?.ability;
  const p = ABILITY_POWER[rarityIndex(rarity)] ?? 0;
  return a && p > 0 ? { id: a, power: Math.round(p * levelFactor(level) * 100) / 100 } : null;
}

/** Run-end rarity weights: better odds the further the run got. */
export function artifactOdds(wave) {
  const w = {};
  for (const r of RARITIES) {
    const o = ARTIFACT_ODDS[r];
    w[r] = Math.min(o.max ?? Infinity, Math.max(o.min ?? 0, o.base + o.perWave * Math.max(0, wave)));
  }
  return w;
}

/** Three distinct artifacts for the end of a run that reached `wave`. */
export function rollArtifactOffer(wave, rnd, luckPct = 0, size = COMMANDER.offerSize) {
  const odds = artifactOdds(wave);
  const ids = Object.keys(ARTIFACTS);
  const offer = [];
  for (let n = 0; n < size && ids.length; n++) {
    const id = ids.splice(Math.floor(rnd() * ids.length), 1)[0];
    offer.push({ id, rarity: rollRarity(odds, rnd, luckPct) });
  }
  return offer;
}

/** The stash artifact a new {id, rarity} would merge into, if any. */
export function mergeTarget(cmd, { id, rarity }) {
  return cmd.artifacts
    .filter((a) => a.id === id && a.rarity === rarity && a.level < COMMANDER.artifactMaxLevel)
    .sort((a, b) => b.level - a.level)[0] ?? null;
}

/**
 * Adds an artifact. An identical one (same kind and rarity, below max level) levels up
 * instead; a full stash salvages it for XP.
 * @returns {{artifact: object|null, merged: boolean, salvagedXp: number}}
 */
export function addArtifact(cmd, { id, rarity }) {
  if (!ARTIFACTS[id] || rarityIndex(rarity) < 0) return { artifact: null, merged: false, salvagedXp: 0 };
  if (autoSalvages(cmd, rarity)) {
    const xp = RARITY_INFO[rarity].salvageXp;
    addXp(cmd, xp);
    return { artifact: null, merged: false, salvagedXp: xp, auto: { id, rarity } };
  }
  const target = mergeTarget(cmd, { id, rarity });
  if (target) {
    target.level++;
    return { artifact: target, merged: true, salvagedXp: 0 };
  }
  if (cmd.artifacts.length >= COMMANDER.maxStash) {
    const xp = RARITY_INFO[rarity].salvageXp;
    addXp(cmd, xp);
    return { artifact: null, merged: false, salvagedXp: xp };
  }
  const artifact = { uid: cmd.nextUid++, id, rarity, level: 1 };
  cmd.artifacts.push(artifact);
  // Fill a free slot automatically so a first find is useful straight away.
  if (cmd.equipped.length < slotCount(cmd.level)) cmd.equipped.push(artifact.uid);
  return { artifact, merged: false, salvagedXp: 0 };
}

/** Takes artifact `index` of the run-end offer. */
export function chooseArtifact(cmd, index) {
  const choice = cmd.artifactOffer?.[index];
  if (!choice) return null;
  cmd.artifactOffer = null;
  return addArtifact(cmd, choice);
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

/** Destroys an artifact for commander XP (more for higher levels). Returns levels gained or -1. */
export function salvage(cmd, uid) {
  const i = cmd.artifacts.findIndex((a) => a.uid === uid);
  if (i < 0) return -1;
  const [a] = cmd.artifacts.splice(i, 1);
  unequip(cmd, uid);
  return addXp(cmd, RARITY_INFO[a.rarity].salvageXp * a.level);
}

/** True when auto-salvage is on and the player does not keep this rarity. */
export function autoSalvages(cmd, rarity) {
  return !!cmd.autoSalvage?.on && !cmd.autoSalvage.keep.includes(rarity);
}

/** Changes the auto-salvage setting: `on` and/or the list of rarities to keep. */
export function setAutoSalvage(cmd, { on, keep }) {
  const cur = cmd.autoSalvage ?? { on: false, keep: RARITIES.slice(1) };
  cmd.autoSalvage = {
    on: typeof on === 'boolean' ? on : cur.on,
    keep: Array.isArray(keep) ? RARITIES.filter((r) => keep.includes(r)) : cur.keep,
  };
  return cmd.autoSalvage;
}

/** Stash artifacts (never equipped ones) that auto-salvage would remove now. */
export function unkeptArtifacts(cmd) {
  return cmd.autoSalvage?.on
    ? cmd.artifacts.filter((a) => !cmd.equipped.includes(a.uid) && autoSalvages(cmd, a.rarity)) : [];
}

/** Salvages every unkept stash artifact. @returns {{count:number, xp:number}} */
export function salvageUnkept(cmd) {
  const list = unkeptArtifacts(cmd);
  let xp = 0;
  for (const a of list) {
    xp += RARITY_INFO[a.rarity].salvageXp * a.level;
    salvage(cmd, a.uid);
  }
  return { count: list.length, xp };
}

// --- totals -------------------------------------------------------------------------

const equippedArtifacts = (cmd) => cmd.equipped.map((u) => cmd.artifacts.find((a) => a.uid === u)).filter(Boolean);

/** Sum of every stat perk and every equipped artifact's bonuses. */
export function totalBonuses(cmd) {
  const total = {};
  const add = (k, v) => { if (k && v) total[k] = Math.round(((total[k] ?? 0) + v) * 1000) / 1000; };
  for (const p of cmd.perks) if (!isSkill(p.id)) add(PERKS[p.id]?.bonus, perkValue(p.id, p.rarity));
  for (const a of equippedArtifacts(cmd)) {
    for (const [k, v] of Object.entries(artifactBonuses(a.id, a.rarity, a.level))) add(k, v);
  }
  return total;
}

/** {abilityId: power} from skills and equipped artifacts (same ability = powers add up). */
export function totalAbilities(cmd) {
  const total = {};
  const add = (id, p) => { if (id && p > 0) total[id] = Math.round(((total[id] ?? 0) + p) * 100) / 100; };
  for (const p of cmd.perks) if (isSkill(p.id)) add(PERKS[p.id].ability, perkValue(p.id, p.rarity));
  for (const a of equippedArtifacts(cmd)) {
    const ab = artifactAbility(a.id, a.rarity, a.level);
    if (ab) add(ab.id, ab.power);
  }
  return total;
}

/** Human-readable lines for a bonus map. */
export function describeBonuses(bonuses) {
  return Object.entries(bonuses)
    .filter(([k, v]) => v && BONUS_LABELS[k])
    .map(([k, v]) => BONUS_LABELS[k](Math.round(v * 100) / 100));
}

/** Human-readable line for an ability at a power. */
export function describeAbility(id, power) {
  const a = ABILITIES[id];
  return a ? `${a.icon} ${a.name}: ${a.text(power)}` : '';
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
 * capped at COMMANDER.maxReductionPct. `abilities` ({id: power}) become COMMANDER_ABILITIES.
 */
export function applyBonuses(base, b = {}, abilities = {}) {
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
  // The hero's active abilities (picked during a run) recharge faster too.
  for (const a of Object.values(c.HERO_ACTIVES ?? {})) a.cooldown *= less('abilityCooldownPct');
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

  for (const z of Object.values(c.ZOMBIES)) {
    z.xp *= more('heroXpPct');
    z.speed *= less('enemySpeedPct');
    z.hp = Math.max(1, Math.round(z.hp * less('enemyHpPct')));
  }
  c.BONUS = { ...c.BONUS, killGoldPct: b.killGoldPct ?? 0 };
  c.COMMANDER_ABILITIES = { ...abilities };
  return c;
}

/** Config for a run with everything this commander has. */
export function runConfig(base, cmd) {
  return applyBonuses(base, totalBonuses(cmd), totalAbilities(cmd));
}
