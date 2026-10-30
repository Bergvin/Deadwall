// Bots for the balance simulation (tools/simulate.js). A bot plays one run headless: between
// waves (and now and then during a wave) it builds, upgrades, repairs and picks perks; during
// waves it casts spells and may order the runner around.
//
// A BotProfile picks the behaviour (like the AI profiles in the Astromage project):
//   basic  the old scripted player: a fixed tower order, each on the cell that covers the
//          most road, then always the cheapest upgrade, specialisations alternating, the
//          highest-rarity perk. `types` limits it to some tower types.
//   smart  values every option: new towers per type and cell, and upgrades, are rated by how
//          much effective damage they add per gold against the enemies of the next waves
//          (armor, resist, bosses, packs), with the time the dead spend in range and support
//          (slow, stun, push) counted as a share of the whole defence. Picks the better
//          specialisation, rates runner perks by what they do, orders the runner to towers
//          that run dry and keeps gold for house repairs.
// Tuned weights live in the profile so variants (wide, tall, ...) are one line each.
import { PHASE } from '../src/core/waves.js';
import { coverage } from '../src/core/paths.js';
import { towerStats } from '../src/core/towers.js';
import { TERRAIN } from '../src/core/grid.js';

const BASIC_MIX = ['arrow', 'frost', 'fire', 'boulder', 'gale', 'roller', 'arrow', 'fire', 'frost', 'boulder'];

const SMART = {
  kind: 'smart',
  name: 'Smart',
  description: 'Rates every tower, cell, upgrade and perk by the damage it adds per gold against the coming waves.',
  spells: true,
  orders: true,
  /** Waves ahead whose enemies count when choosing (weights fall off with distance). */
  horizon: 3,
  /** Multipliers on the value per gold of a new tower and of an upgrade. */
  newTowerWeight: 1,
  upgradeWeight: 1,
  /** Each tower of the same type already standing makes another one worth this much less
   *  (support even more: slows and stuns do not stack). */
  sameTypeDecay: 0.8,
  supportDecay: 0.5,
  /** Support counts as this share of the defence's damage per unit of effect. */
  slowWeight: 0.9, stunWeight: 0.5, knockWeight: 0.06,
  /** Extra value per enemy hit at once (area, several targets) and for packs on the road. */
  aoeWeight: 0.4,
  /** A tower that runs dry quickly is worth less (seconds of fire one load gives at full value). */
  ammoSeconds: 25,
  /** Save for the best option if it costs at most this many times the gold we have... */
  saveRatio: 2.5,
  /** ...unless something affordable is nearly as good (this share of its value per gold). */
  takeIfWithin: 0.75,
  /** Repair the house below this share of its health, and keep that much gold back for it. */
  repairAt: 0.7,
  /** Roads opening within the horizon count this share; covered road length that halves a road's weight. */
  futureRoad: 0.8,
  spread: 30,
  /** Enemies a line attack (rolling stone, ballista bolt) hits on average. */
  lineHits: 0.8,
  /** How much revealing stealth is worth (share of the defence per share of stealth HP). */
  revealWeight: 1.5,
  /** Tower types it may build (null = all); for testing one type at a time. */
  allowTypes: null,
  /** Orders: send the runner to towers below this ammo share during a wave. */
  orderBelow: 0.2,
};

export const BOT_PROFILES = {
  none: { kind: 'none', name: 'None', description: 'Builds nothing (baseline).' },
  basic: { kind: 'basic', name: 'Basic', description: 'The old scripted player.', spells: true, types: BASIC_MIX },
  lazy: { kind: 'basic', name: 'Lazy', description: 'Basic, without spells.', spells: false, types: BASIC_MIX },
  smart: SMART,
  wide: { ...SMART, name: 'Smart wide', description: 'Smart, prefers more towers over upgrades.', newTowerWeight: 1.6 },
  tall: { ...SMART, name: 'Smart tall', description: 'Smart, prefers upgrades over new towers.', upgradeWeight: 1.6 },
  'smart-noorders': { ...SMART, name: 'Smart without orders', description: 'Smart, but never orders the runner.', orders: false },
  'smart-nospells': { ...SMART, name: 'Smart without spells', description: 'Smart, but never casts a spell.', spells: false },
  // Fixed upgrade strategies (smart picks tower types and cells; all fill free slots first,
  // then save for the one upgrade the strategy wants):
  cheapest: { ...SMART, name: 'Cheapest first', description: 'Fills slots, then always the cheapest upgrade.', policy: 'cheapest' },
  focus: { ...SMART, name: 'One to max', description: 'Fills slots, then takes one tower all the way to level 10 before the next.', policy: 'focus' },
  even: { ...SMART, name: 'Even levels', description: 'Fills slots, then upgrades the lowest-level tower (all level up together).', policy: 'even' },
  topdps: { ...SMART, name: 'Best tower first', description: 'Fills slots, then upgrades the tower doing the most damage.', policy: 'topdps' },
  slowfirst: { ...SMART, name: 'Slow first', description: 'Smart, but the first two towers are Frost and Gale.', supportFirst: ['frost', 'gale'] },
  // Tower pools and foresight (smart's judgement, limited choices):
  oldtowers: { ...SMART, name: 'Old towers only', description: 'Smart with the first six tower types only.', allowTypes: ['arrow', 'fire', 'frost', 'boulder', 'gale', 'roller'] },
  newtowers: { ...SMART, name: 'New towers only', description: 'Smart with the five new tower types only.', allowTypes: ['watchtower', 'arcane', 'alchemist', 'tesla', 'ballista'] },
  lookahead: { ...SMART, name: 'Looks further ahead', description: 'Smart, planning for the next 6 waves instead of 3.', horizon: 6 },
  watchfirst: { ...SMART, name: 'Watchtower early', description: 'Smart, but builds a Watchtower as its third tower.', supportFirst: null, earlyWatch: true },
};
// Single tower type strategies: the basic player with one type.
for (const t of ['arrow', 'fire', 'frost', 'boulder', 'gale', 'roller']) {
  BOT_PROFILES[t] = { kind: 'basic', name: `Only ${t}`, description: `Basic, ${t} towers only.`, spells: true, types: [t] };
}

/** Runner perk values for the smart bot (per rank; spells are rated separately). */
const PERK_VALUE = {
  speedPct: 0.5, crates: 6, refillPct: 0.12, cooldownPct: 0.7, radiusAdd: 7, bonkPct: 0.08, bonkImmune: 2,
  auraDamagePct: 0.7, refillHaste: 0.12, recycle: 12, tinker: 10, goldenAmmo: 0.5, stomp: 14, twin: 70,
  perpetual: 90, xpPct: 0.15, durationPct: 0.4, buildPct: 0.1, instantPct: 0.25, buildRefill: 6,
};
const NEW_SPELL_VALUE = 26;
const SPELL_RANK_VALUE = 9;

// --- the basic player -------------------------------------------------------------------

/** Free cell with the most road in reach of a tower of this range (closer to the house wins ties). */
function bestCellBasic(sim, range) {
  const covered = new Map();
  for (const t of sim.towers.all()) for (const p of sim.paths) covered.set(p.id, (covered.get(p.id) ?? 0) + coverage(p, t.cx, t.cz, t.stats.range, 0.5) / 4);
  let best = null, bestScore = -1;
  for (let y = 0; y < sim.grid.height; y++) {
    for (let x = 0; x < sim.grid.width; x++) {
      if (!sim.grid.isBuildable(x, y) || sim.towers.tooClose(x, y)) continue;
      let score = 0;
      for (const p of sim.paths) score += Math.sqrt(coverage(p, x + 0.5, y + 0.5, range, 0.5) / (1 + (covered.get(p.id) ?? 0)));
      score -= Math.hypot(x + 0.5 - sim.house.x, y + 0.5 - sim.house.z) * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

function basicAct(sim, profile) {
  const types = profile.types;
  const t = sim.towers;
  while (t.count < t.slots) {
    const type = types[t.count % types.length];
    if (!sim.economy.canAfford(t.costOf(type))) break;
    const c = bestCellBasic(sim, sim.config.TOWERS[type].range);
    if (!c || !t.build(type, c.x, c.y)) break;
  }
  for (let guard = 0; guard < 30 && t.count >= t.slots; guard++) {
    const list = [...t.all()].filter((x) => x.level < sim.config.TOWER_RULES.maxLevel && !x.pending);
    if (!list.length) break;
    const next = list.sort((a, b) => t.upgradeCost(a.id) - t.upgradeCost(b.id))[0];
    if (!sim.economy.canAfford(t.upgradeCost(next.id))) break;
    if (!t.upgrade(next.id, next.id % 2 ? 'a' : 'b')) break;
  }
  if (sim.house.hp < sim.house.maxHp * 0.6) sim.house.repair();
  const r = sim.runner;
  const rank = Object.fromEntries(sim.config.RARITIES.map((x, i) => [x, i]));
  while (r.pendingPicks) {
    const offer = r.currentOffer();
    if (!offer) break;
    let bi = 0;
    offer.forEach((id, i) => { if (rank[sim.config.RUNNER_PERKS[id].rarity] > rank[sim.config.RUNNER_PERKS[offer[bi]].rarity]) bi = i; });
    if (!r.choose(bi)) break;
  }
}

// --- the smart player -------------------------------------------------------------------

/** What the next few waves throw at us: hp-weighted shares of armor, resist, bosses, speed. */
function threat(sim, horizon) {
  const Z = sim.config.ZOMBIES;
  const w = sim.waves;
  const start = w.phase === PHASE.ACTIVE ? w.wave : w.nextWave;
  const mix = { total: 0, types: {}, boss: 0, count: 0, hpPerEnemy: 0 };
  for (let k = 0; k < horizon; k++) {
    const comp = w.preview(start + k);
    const weight = 1 / (1 + k * 0.6);
    const add = (type, n) => {
      const hp = Z[type].hp * comp.hpMultiplier * n * weight;
      mix.types[type] = (mix.types[type] ?? 0) + hp;
      mix.total += hp;
      mix.count += n * weight;
      if (Z[type].boss) mix.boss += hp;
    };
    for (const g of comp.groups) add(g.type, g.count);
    if (comp.boss) add(comp.boss, 1);
  }
  mix.hpPerEnemy = mix.total / Math.max(1, mix.count);
  return mix;
}

/** Effective damage per second of a tower's stats against the coming mix (before range). */
/**
 * Effective damage per second of a tower's stats against the coming mix (before range).
 * Enemies it cannot hurt (immune) or cannot see (stealth without detection or a Watchtower)
 * count as nothing; Rotters count less unless the tower poisons.
 * @param {{reveal: boolean}} ctx whether a Watchtower is already lighting up stealth
 */
function effDps(s, mix, sim, p, type, ctx = { reveal: false }) {
  const Z = sim.config.ZOMBIES;
  let mitig = 0;
  for (const [zt, hp] of Object.entries(mix.types)) {
    const z = Z[zt];
    if (z.immune?.includes(s.damageType) || (s.tags && z.immuneTags?.some((x) => s.tags.includes(x)))) continue;
    if (z.stealth && !s.detect && !ctx.reveal && !s.aoe) continue;
    let m;
    if (s.damageType === 'physical') m = 1 - Math.max(0, z.armor - s.armorPen);
    else if (s.damageType === 'magic' || s.damageType === 'fire') m = 1 - z.resist;
    else m = 1;
    if (s.bossMult && z.boss) m *= 1 + s.bossMult;
    if (z.regen && !s.poison) m *= 0.7;
    mitig += m * hp;
  }
  mitig /= Math.max(1, mix.total);
  // Several victims per shot: extra targets, area, lines (rolling stone, ballista), lightning
  // jumps; never more than the pack.
  const line = type === 'roller' || s.aimed;
  const hits = line ? Math.min(4, p.lineHits * (s.balls ?? 1))
    : s.chain ? Math.min(4, 1 + s.chain.jumps * s.chain.falloff * 0.6)
      : Math.min(4, s.targets + (s.aoe ? s.aoe * p.aoeWeight * 2 : 0));
  let dps = (s.damage / s.interval) * hits * mitig;
  if (s.poison) dps += s.poison.dps * Math.min(3, 1 + (s.aoe ?? 0) * 1.5) * mitig;
  if (s.burn) dps += s.burn.dps * Math.min(3, 1 + (s.aoe ?? 0) * 1.5) * (1 - (mix.types.plague ?? 0) / Math.max(1, mix.total) * 0.6);
  if (s.napalm) dps += s.napalm.dps * 1.5;
  if (s.bleed) dps += s.damage * s.bleed.dps * 2;
  if (s.critChance) dps *= 1 + s.critChance;
  // A tower that empties fast spends time waiting for crates.
  const fireTime = s.maxAmmo * s.interval;
  dps *= Math.min(1, 0.4 + 0.6 * fireTime / p.ammoSeconds);
  return dps;
}

/** Support value of a tower as a share of the defence (slow, stun, push), 0..~1. */
function supportShare(s, p) {
  let v = 0;
  if (s.slow) v += (1 - s.slow.factor) * p.slowWeight * Math.min(1, s.targets + (s.aoe ?? 0));
  if (s.freezeChance) v += s.freezeChance * s.freezeTime * p.stunWeight;
  if (s.stun) v += Math.min(1, s.stun / s.interval) * p.stunWeight * (s.stunAll ? 2 : 1);
  if (s.knock) v += s.knock * p.knockWeight * s.targets / s.interval;
  return v;
}

/**
 * @param {string} name a BOT_PROFILES key
 * @param {object} [overrides] profile fields to change (for tuning sweeps)
 */
export function createBot(name, overrides = null) {
  const base = BOT_PROFILES[name];
  if (!base) throw new Error(`unknown bot profile ${name}`);
  const profile = overrides ? { ...base, ...overrides } : base;
  const covCache = new Map();
  let castTimer = 0, orderTimer = 0, midTimer = 0, lastPrep = -1;

  /** Road length in range of a cell on each road (cached; ranges change with upgrades). */
  function coverPaths(sim, cx, cz, range) {
    const key = `${cx},${cz},${range.toFixed(2)}`;
    let v = covCache.get(key);
    if (!v) {
      v = sim.paths.map((path) => coverage(path, cx, cz, range, 0.5));
      covCache.set(key, v);
    }
    return v;
  }

  /**
   * How much each road matters right now: its share of the spawns (roads opening within the
   * horizon count `futureRoad` of that), lowered the more tower cover it already has, so the
   * bot spreads its towers over every road instead of stacking one.
   */
  function roadWeights(sim) {
    const n = sim.waves.phase === PHASE.ACTIVE ? sim.waves.wave : sim.waves.nextWave;
    const open = (p) => n >= p.from;
    const totalW = sim.paths.reduce((a, p) => a + (open(p) ? p.weight : 0), 0) || 1;
    const covered = sim.paths.map(() => 0);
    for (const t of sim.towers.all()) coverPaths(sim, t.cx, t.cz, t.stats.range).forEach((c, i) => { covered[i] += c; });
    return sim.paths.map((p, i) => {
      const share = open(p) ? p.weight / totalW : n + profile.horizon >= p.from ? profile.futureRoad * p.weight / totalW : 0;
      return share / (1 + covered[i] / profile.spread);
    });
  }

  /** Weighted road length in range of a cell. */
  function cover(sim, cx, cz, range) {
    const c = coverPaths(sim, cx, cz, range);
    let v = 0;
    for (let i = 0; i < c.length; i++) v += c[i] * weights[i];
    return v;
  }
  let weights = [];

  /** Total damage the defence puts out (for valuing support). */
  function teamDps(sim, mix) {
    let d = 0;
    for (const t of sim.towers.all()) d += effDps(t.stats, mix, sim, profile, t.type, ctx) * coverOf(sim, t.stats, t.cx, t.cz);
    return d;
  }

  /** Road an aimed tower covers: the best straight line from it (cached per cell). */
  function lineCover(sim, cx, cz, length) {
    const key = `line${cx},${cz},${length.toFixed(1)}`;
    let v = covCache.get(key);
    if (v === undefined) {
      v = 0;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        let n = 0;
        for (let s = 0.5; s <= length; s += 0.5) {
          const x = Math.floor(cx + Math.sin(a) * s), y = Math.floor(cz + Math.cos(a) * s);
          if (sim.grid.inBounds(x, y) && sim.grid.terrainAt(x, y) === TERRAIN.ROAD) n++;
        }
        v = Math.max(v, n * 0.5);
      }
      covCache.set(key, v);
    }
    return v;
  }

  function coverOf(sim, s, cx, cz) {
    return s.aimed ? lineCover(sim, cx, cz, s.range) : cover(sim, cx, cz, s.range);
  }

  /** Shared per decision: is a Watchtower already lighting up stealth? */
  const ctx = { reveal: false, stealthShare: 0 };

  /** Value of a tower with these stats at (cx, cz): effective damage over the road in range. */
  function value(sim, type, s, cx, cz, mix, team, sameType) {
    const c = coverOf(sim, s, cx, cz);
    const own = effDps(s, mix, sim, profile, type, ctx) * c;
    let support = supportShare(s, profile) * Math.min(team, own * 6 + 50) * Math.min(1, c / 4);
    // The first tower that reveals stealth unlocks the whole defence against it.
    if (s.reveal && !ctx.reveal) support += ctx.stealthShare * profile.revealWeight * Math.max(team, 50) * Math.min(1, c / 4);
    if (s.markPct) support += (s.markPct / 100) * 0.5 * Math.min(team, own * 6 + 50) * Math.min(1, c / 4);
    return own * profile.sameTypeDecay ** sameType + support * profile.supportDecay ** sameType;
  }

  function bestSpec(sim, t, mix, team, same) {
    const T = sim.config.TOWERS[t.type], R = sim.config.TOWER_RULES;
    let best = null, bv = -1;
    for (const k of Object.keys(T.specs ?? {})) {
      const v = value(sim, t.type, towerStats(T, t.level + 1, k, R), t.cx, t.cz, mix, team, same);
      if (v > bv) { bv = v; best = k; }
    }
    return best;
  }

  function smartAct(sim) {
    const T = sim.config.TOWERS, R = sim.config.TOWER_RULES;
    const towers = sim.towers;
    const mix = threat(sim, profile.horizon);
    // House first: repair below the threshold (between waves only).
    if (sim.house.hp < sim.house.maxHp * profile.repairAt) sim.house.repair();
    const Z = sim.config.ZOMBIES;
    ctx.stealthShare = Object.entries(mix.types).reduce((a, [zt, hp]) => a + (Z[zt].stealth ? hp : 0), 0) / Math.max(1, mix.total);
    for (let guard = 0; guard < 40; guard++) {
      ctx.reveal = [...towers.all()].some((t) => t.stats.reveal);
      weights = roadWeights(sim);
      const team = teamDps(sim, mix);
      const same = {};
      for (const t of towers.all()) same[t.type] = (same[t.type] ?? 0) + 1;
      const options = [];
      // New towers: every type on its best free cell.
      if (towers.count < towers.slots) {
        const cells = [];
        for (let y = 0; y < sim.grid.height; y++) {
          for (let x = 0; x < sim.grid.width; x++) if (sim.grid.isBuildable(x, y) && !towers.tooClose(x, y)) cells.push({ x, y });
        }
        for (const type of Object.keys(T)) {
          if (profile.allowTypes && !profile.allowTypes.includes(type)) continue;
          const s = towerStats(T[type], 1, null, R);
          let best = null, bv = 0;
          for (const c of cells) {
            const v = value(sim, type, s, c.x + 0.5, c.y + 0.5, mix, team, same[type] ?? 0)
              - Math.hypot(c.x + 0.5 - sim.house.x, c.y + 0.5 - sim.house.z) * 0.02;
            if (v > bv) { bv = v; best = c; }
          }
          if (best) options.push({ kind: 'build', type, cell: best, cost: towers.costOf(type), gain: bv * profile.newTowerWeight });
        }
      }
      // Upgrades.
      for (const t of towers.all()) {
        if (t.pending || t.level >= R.maxLevel) continue;
        const spec = towers.needsSpec(t.id) ? bestSpec(sim, t, mix, team, (same[t.type] ?? 1) - 1) : null;
        const now = value(sim, t.type, t.stats, t.cx, t.cz, mix, team, (same[t.type] ?? 1) - 1);
        const next = value(sim, t.type, towerStats(T[t.type], t.level + 1, t.spec ?? spec, R), t.cx, t.cz, mix, team, (same[t.type] ?? 1) - 1);
        // The tower is out of action while the runner builds it.
        const downtime = now * R.buildTime(t.level + 1) / 60;
        options.push({ kind: 'upgrade', tower: t, spec, cost: towers.upgradeCost(t.id), now, gain: (next - now - downtime) * profile.upgradeWeight });
      }
      // Watchtower early: the third tower is a Watchtower.
      if (profile.earlyWatch && towers.count === 2 && !same.watchtower) {
        const o = options.find((x) => x.kind === 'build' && x.type === 'watchtower');
        if (!o || sim.economy.gold < o.cost) break;
        if (!apply(sim, o)) break;
        continue;
      }
      // Slow first: the first support towers come before anything else.
      const support = profile.supportFirst?.find((type) => !same[type]);
      if (support && towers.count < profile.supportFirst.length) {
        const o = options.find((x) => x.kind === 'build' && x.type === support);
        if (!o || sim.economy.gold < o.cost) break;
        if (!apply(sim, o)) break;
        continue;
      }
      // Fixed strategies: fill slots with the best-value tower, then one chosen upgrade.
      if (profile.policy) {
        const builds = options.filter((o) => o.kind === 'build').sort((a, b) => b.gain / b.cost - a.gain / a.cost);
        const ups = options.filter((o) => o.kind === 'upgrade');
        const level = (o) => o.tower.level;
        const order = {
          cheapest: (a, b) => a.cost - b.cost,
          focus: (a, b) => level(b) - level(a) || b.now - a.now,
          even: (a, b) => level(a) - level(b) || a.cost - b.cost,
          topdps: (a, b) => b.now - a.now,
        }[profile.policy];
        const target = builds[0] ?? ups.sort(order)[0];
        if (!target || sim.economy.gold < target.cost) break;
        if (!apply(sim, target)) break;
        continue;
      }
      const usable = options.filter((o) => o.gain > 0 && o.cost > 0);
      if (!usable.length) break;
      usable.sort((a, b) => b.gain / b.cost - a.gain / a.cost);
      const best = usable[0];
      const gold = sim.economy.gold;
      if (gold < best.cost) {
        // Save for it, unless an affordable option is nearly as good (or it is out of reach).
        const alt = usable.find((o) => o.cost <= gold);
        if (!alt) break;
        const close = alt.gain / alt.cost >= (best.gain / best.cost) * profile.takeIfWithin;
        if (!close && best.cost <= gold * profile.saveRatio) break;
        if (!apply(sim, alt)) break;
        continue;
      }
      if (!apply(sim, best)) break;
    }
    pickPerks(sim);
  }

  function apply(sim, o) {
    if (o.kind === 'build') return !!sim.towers.build(o.type, o.cell.x, o.cell.y);
    return sim.towers.upgrade(o.tower.id, o.spec);
  }

  function pickPerks(sim) {
    const r = sim.runner;
    const defs = sim.config.RUNNER_PERKS;
    while (r.pendingPicks) {
      const offer = r.currentOffer();
      if (!offer) break;
      let bi = 0, bv = -Infinity;
      offer.forEach((id, i) => {
        const def = defs[id];
        let v;
        if (def.spell) v = r.spells[def.spell] ? SPELL_RANK_VALUE : NEW_SPELL_VALUE;
        else {
          const rank = r.nextRank(id);
          const now = rank > 1 ? def.mods(rank - 1) : {};
          v = 0;
          for (const [k, x] of Object.entries(def.mods(rank))) v += (x - (now[k] ?? 0)) * (PERK_VALUE[k] ?? 0.5);
        }
        if (v > bv) { bv = v; bi = i; }
      });
      if (!r.choose(bi)) break;
    }
  }

  /** During a wave: send the runner to the most valuable tower that is running dry. */
  function orders(sim) {
    const r = sim.runner;
    const busy = new Set([...r.orders, ...r.units.map((u) => u.job?.towerId).filter(Boolean)]);
    let best = null, bv = 0;
    for (const t of sim.towers.all()) {
      if (busy.has(t.id) || t.pending) continue;
      const share = t.ammo / t.stats.maxAmmo;
      if (share >= profile.orderBelow) continue;
      const v = (t.stats.damage / t.stats.interval) * (1 - share);
      if (v > bv) { bv = v; best = t; }
    }
    if (best) r.orderRefill(best.id);
  }

  const act = (sim) => (profile.kind === 'smart' ? smartAct(sim) : basicAct(sim, profile));

  return {
    profile,
    /** Called before every simulation step. */
    step(sim, dt) {
      if (profile.kind === 'none') return;
      if (sim.waves.phase === PHASE.PREP && sim.waves.wave !== lastPrep) {
        lastPrep = sim.waves.wave;
        covCache.clear();
        act(sim);
        sim.waves.startNext();
      }
      if (profile.spells) {
        castTimer -= dt;
        if (castTimer <= 0) {
          castTimer = 0.5;
          for (const id of Object.keys(sim.runner.spells)) if (sim.runner.canCast(id) && sim.runner.wantsCast(id)) sim.runner.cast(id);
        }
      }
      if (sim.waves.phase !== PHASE.ACTIVE) return;
      if (profile.orders) {
        orderTimer -= dt;
        if (orderTimer <= 0) { orderTimer = 1; orders(sim); }
      }
      // Mid-wave building when gold piles up (a player would too).
      midTimer -= dt;
      if (midTimer <= 0) { midTimer = 10; act(sim); }
    },
  };
}
