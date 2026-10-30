// Towers on free ground: placement (limited slots), upgrades with a specialisation choice,
// selling, ammo, targeting and firing. Impacts go through CombatSystem.applyPayload.
// A tower without ammo does nothing until the runner brings a crate (see runner.js).
// Spells and perks change towers through timed buffs (t.buffs) and the `extra` hook the
// simulation provides (runner auras, plague clouds, perpetual motion).

import { TERRAIN } from './grid.js';

const ROAD = TERRAIN.ROAD;
const MULT_KEYS = {
  damageMult: 'damage', intervalMult: 'interval', aoeMult: 'aoe', knockMult: 'knock',
};

/** Unit vector of an angle (0 = +z, like facing). */
const dirOf = (a) => ({ dx: Math.sin(a), dz: Math.cos(a) });

/** Pure: a tower's stats at a level and specialisation (`spec` = 'a' | 'b' | null). */
export function towerStats(type, level, spec, rules) {
  const k = level - 1;
  const s = {
    damage: type.damage * rules.damageMult ** k,
    damageType: type.damageType,
    interval: type.interval * rules.intervalMult ** k,
    range: type.range + rules.rangeAdd * k,
    aoe: type.aoe ?? 0,
    armorPen: type.armorPen ?? 0,
    maxAmmo: Math.round(type.ammo * rules.ammoMult ** k),
    targets: type.targets ?? 1,
    burn: type.burn ? { dps: type.burn.dps * rules.burnMult ** k * rules.damageMult ** (k / 2), duration: type.burn.duration } : null,
    slow: type.slow ? { factor: type.slow.factor * rules.slowFactorMult ** k, duration: type.slow.duration } : null,
    stun: type.stun ? type.stun + rules.stunAdd * k : 0,
    knock: type.knock ? type.knock + rules.knockAdd * k : 0,
    lift: 0,
    bossMult: 0,
    freezeChance: 0, freezeTime: 0,
    shred: null, napalm: null, bleed: null,
    balls: 1,
    critChance: rules.critChance ?? 0,
    /** Traits: sees stealth; reveals stealth in range (Watchtower) and marks it; attack tags. */
    detect: !!type.detect,
    reveal: !!type.reveal,
    markPct: 0,
    tags: type.tags ?? null,
    poison: type.poison ? { dps: type.poison.dps * rules.burnMult ** k * rules.damageMult ** (k / 2), duration: type.poison.duration } : null,
    chain: type.chain ? { ...type.chain } : null,
    aimed: !!type.aimed,
  };
  const mods = spec ? type.specs?.[spec]?.mods ?? {} : {};
  for (const [key, v] of Object.entries(mods)) {
    if (MULT_KEYS[key]) s[MULT_KEYS[key]] *= v;
    else if (key === 'burnMult' && s.burn) s.burn.dps *= v;
    else if (key === 'poisonMult' && s.poison) s.poison.dps *= v;
    else if (key === 'jumpsAdd' && s.chain) s.chain.jumps += v;
    else if (key === 'slowFactorMult' && s.slow) s.slow.factor *= v;
    else if (key === 'targetsAdd') s.targets += v;
    else if (key === 'rangeAdd') s.range += v;
    else if (key === 'stunAdd') s.stun += v;
    else if (key === 'napalm') s.napalm = { radius: v.radius, duration: v.duration, dps: (s.burn?.dps ?? s.damage) * (v.dpsMult ?? 1) };
    else s[key] = v;
  }
  return s;
}

export class TowerSystem {
  #towers = new Map();
  #nextId;

  /** @param {{grid, zombies, projectiles, combat, economy, events, types, rules}} deps */
  constructor({ grid, zombies, projectiles, combat, economy, events, types, rules }) {
    Object.assign(this, { grid, zombies, projectiles, combat, economy, events, types, rules });
    this.#nextId = rules.idBase + 1;
    this.time = 0;
    this.priceMultiplier = () => 1;
    /** Highest wave reached (slots grow with it); set by the simulation. */
    this.slotWave = () => 0;
    /** Extra slots from the Commander. */
    this.slotBonus = 0;
    /** Simulation hook: {damagePct, attackSpeedPct, freeAmmo, gunk} from things outside the tower. */
    this.extra = () => null;
  }

  get(id) { return this.#towers.get(id) ?? null; }
  all() { return this.#towers.values(); }
  get count() { return this.#towers.size; }

  /** Tower slots available now. */
  get slots() {
    const r = this.rules;
    const w = this.slotWave();
    return Math.min(r.maxSlots, r.baseSlots + r.slotWaves.filter((x) => w >= x).length + this.slotBonus);
  }

  /** Wave at which the next slot opens (null when none left). */
  get nextSlotWave() {
    const w = this.slotWave();
    if (this.slots >= this.rules.maxSlots) return null;
    return this.rules.slotWaves.find((x) => x > w) ?? null;
  }

  costOf(typeKey) {
    return Math.ceil(this.types[typeKey].cost * this.priceMultiplier());
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  /** True when another tower stands within `spacing` cells (towers keep a gap between them). */
  tooClose(x, y) {
    const d = this.rules.spacing ?? 0;
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) if ((dx || dy) && this.grid.towerAt(x + dx, y + dy)) return true;
    }
    return false;
  }

  canBuild(typeKey, x, y) {
    if (!this.types[typeKey]) return { ok: false, reason: 'unknown_type' };
    if (!this.grid.isBuildable(x, y)) return { ok: false, reason: 'blocked' };
    if (this.tooClose(x, y)) return { ok: false, reason: 'too_close' };
    if (this.count >= this.slots) return { ok: false, reason: 'no_slots' };
    if (!this.economy.canAfford(this.costOf(typeKey))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  build(typeKey, x, y) {
    const check = this.canBuild(typeKey, x, y);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'tower', reason: check.reason });
      return null;
    }
    if (!this.economy.trySpend(this.costOf(typeKey), `tower:${typeKey}`)) return null;
    const type = this.types[typeKey];
    const t = {
      id: this.#nextId++,
      type: typeKey,
      x, y, cx: x + 0.5, cz: y + 0.5,
      level: 1,
      spec: null,
      // Refunds use the base price, never the combat surcharge.
      invested: type.cost,
      cooldown: 0,
      targetId: 0,
      facing: Math.PI,
      targeting: 'first',
      buffs: [],
      jammedUntil: 0,
      golden: 0,
      kills: 0,
      empty: false,
      waveDamage: 0, lastWaveDamage: 0, lastWaveDps: 0, totalDamage: 0,
    };
    t.stats = towerStats(type, 1, null, this.rules);
    // Aimed towers (Ballista) start pointing along the most road they can cover.
    if (t.stats.aimed) t.aim = this.bestAim(t.cx, t.cz, t.stats.range);
    // A new tower comes with a full load.
    t.ammo = t.stats.maxAmmo;
    this.grid.towerId[this.grid.index(x, y)] = t.id;
    this.#towers.set(t.id, t);
    this.events.emit('towerBuilt', t);
    return t;
  }

  /** Price of the next level (0 at max level). */
  upgradeCost(id) {
    const t = this.get(id);
    if (!t || t.level >= this.rules.maxLevel) return 0;
    return Math.ceil(this.#upgradeBase(t) * this.priceMultiplier());
  }

  #upgradeBase(t) {
    const r = this.rules;
    return this.types[t.type].cost * r.upgradeBase * r.upgradeGrowth ** (t.level - 1);
  }

  /** True when the next upgrade asks for a specialisation. */
  needsSpec(id) {
    const t = this.get(id);
    return !!t && !t.pending && !t.spec && t.level + 1 >= this.rules.specLevel;
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canUpgrade(id, spec = null) {
    const t = this.get(id);
    if (!t) return { ok: false, reason: 'no_tower' };
    if (t.pending) return { ok: false, reason: 'upgrading' };
    if (t.level >= this.rules.maxLevel) return { ok: false, reason: 'max_level' };
    if (this.needsSpec(id) && !this.types[t.type].specs?.[spec]) return { ok: false, reason: 'choose_spec' };
    if (!this.economy.canAfford(this.upgradeCost(id))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  upgrade(id, spec = null) {
    const check = this.canUpgrade(id, spec);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'towerUpgrade', reason: check.reason });
      return false;
    }
    const t = this.get(id);
    if (!this.economy.trySpend(this.upgradeCost(id), `towerUpgrade:${t.type}`)) return false;
    t.invested += this.#upgradeBase(t);
    // Paid now, built by the runner (see RunnerSystem): the tower waits for him.
    const level = t.level + 1;
    t.pending = { level, spec: !t.spec && level >= this.rules.specLevel ? spec : null, work: this.rules.buildTime(level), done: 0, lastWork: -1 };
    this.events.emit('towerUpgradeQueued', t);
    return true;
  }

  /** True while the runner is working on the tower's upgrade (it cannot fire meanwhile). */
  isBuilding(t) {
    return !!t.pending && this.time - t.pending.lastWork < 0.15;
  }

  /** Fraction of the pending upgrade built (0 when there is none). */
  buildProgress(t) {
    return t.pending ? Math.min(1, t.pending.done / t.pending.work) : 0;
  }

  /** The runner works `seconds` on a tower's upgrade. @returns {boolean} true when finished */
  workOn(id, seconds) {
    const t = this.get(id);
    if (!t?.pending) return false;
    t.pending.done += seconds;
    t.pending.lastWork = this.time;
    if (t.pending.done < t.pending.work) return false;
    this.finishUpgrade(id);
    return true;
  }

  /** Completes a tower's pending upgrade now. */
  finishUpgrade(id, { instant = false } = {}) {
    const t = this.get(id);
    if (!t?.pending) return false;
    const p = t.pending;
    t.pending = null;
    t.level = p.level;
    if (p.spec && !t.spec) t.spec = p.spec;
    const before = t.stats.maxAmmo;
    t.stats = towerStats(this.types[t.type], t.level, t.spec, this.rules);
    // The bigger magazine comes filled up by the difference.
    t.ammo = Math.min(t.stats.maxAmmo, t.ammo + (t.stats.maxAmmo - before));
    this.events.emit('towerUpgraded', t);
    if (instant) this.events.emit('towerInstantUpgrade', t);
    return true;
  }

  needsSpecAt(t, spec) {
    return !t.spec && spec && t.level >= this.rules.specLevel;
  }

  sellValue(id) {
    const t = this.get(id);
    return t ? Math.floor(t.invested * this.rules.sellRefund) : 0;
  }

  sell(id) {
    const t = this.get(id);
    if (!t) return false;
    const value = this.sellValue(id);
    this.#towers.delete(id);
    this.grid.towerId[this.grid.index(t.x, t.y)] = 0;
    this.economy.earn(value, `sellTower:${t.type}`);
    this.events.emit('towerRemoved', { tower: t, cause: 'sold' });
    return true;
  }

  setTargeting(id, mode) {
    const t = this.get(id);
    if (t) { t.targeting = mode; t.targetId = 0; }
  }

  /** Fills a tower's ammo (the runner, Tea Break). */
  refill(id, amount = Infinity) {
    const t = this.get(id);
    if (!t) return 0;
    const before = t.ammo;
    t.ammo = Math.min(t.stats.maxAmmo, t.ammo + amount);
    if (t.ammo > 0) t.empty = false;
    if (t.ammo >= this.rules.lowAmmo * t.stats.maxAmmo) t.lowWarned = false;
    return t.ammo - before;
  }

  /** Adds a timed buff: {until, attackSpeedPct, damagePct, rangeAdd, critAdd, freeAmmo, jamAfter, source}. */
  addBuff(id, buff) {
    const t = this.get(id);
    if (!t) return;
    // The same source refreshes instead of stacking.
    t.buffs = t.buffs.filter((b) => b.source !== buff.source);
    t.buffs.push(buff);
  }

  /** A Tower Smasher hits a tower: ammo spills and the tower jams. */
  smash(id, cfg, zombie, mult = 1) {
    const t = this.get(id);
    if (!t) return;
    t.ammo = Math.max(0, t.ammo - t.stats.maxAmmo * cfg.ammoDrain * mult);
    t.jammedUntil = Math.max(t.jammedUntil, this.time + cfg.jam);
    this.events.emit('towerSmashed', { tower: t, zombie });
  }

  /** Effective modifiers on a tower right now (buffs + outside effects). */
  modsOf(t) {
    const m = { attackSpeedPct: 0, damagePct: t.golden, rangeAdd: 0, critAdd: 0, freeAmmo: false, gunk: 1 };
    for (const b of t.buffs) {
      if (b.until <= this.time) continue;
      m.attackSpeedPct += b.attackSpeedPct ?? 0;
      m.damagePct += b.damagePct ?? 0;
      m.rangeAdd += b.rangeAdd ?? 0;
      m.critAdd += b.critAdd ?? 0;
      if (b.freeAmmo) m.freeAmmo = true;
    }
    const e = this.extra(t);
    if (e) {
      m.attackSpeedPct += e.attackSpeedPct ?? 0;
      m.damagePct += e.damagePct ?? 0;
      if (e.freeAmmo) m.freeAmmo = true;
      m.gunk = e.gunk ?? 1;
    }
    return m;
  }

  /** Current range including buffs (for previews and targeting). */
  rangeOf(t) {
    return t.stats.range + this.modsOf(t).rangeAdd;
  }

  /** Can this tower aim at the zombie (stealth needs detection or a Watchtower's light)? */
  sees(t, z) {
    return t.stats.detect || this.zombies.isVisible(z);
  }

  /**
   * Direction (angle) along which a line from (cx, cz) of this length covers the most road.
   * Used to point an aimed tower when it is built; the player can turn it (setAim).
   */
  bestAim(cx, cz, length) {
    let best = 0, bestN = -1;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const { dx, dz } = dirOf(a);
      let n = 0;
      for (let s = 0.5; s <= length; s += 0.5) {
        const x = Math.floor(cx + dx * s), y = Math.floor(cz + dz * s);
        if (this.grid.inBounds(x, y) && this.grid.terrainAt(x, y) === ROAD) n++;
      }
      if (n > bestN) { bestN = n; best = a; }
    }
    return best;
  }

  /** Points an aimed tower towards (x, z). */
  setAim(id, x, z) {
    const t = this.get(id);
    if (!t?.stats.aimed) return false;
    t.aim = Math.atan2(x - t.cx, z - t.cz);
    this.events.emit('towerAimed', t);
    return true;
  }

  /** Zombies an aimed tower's line would cross (in range, within the bolt's width). */
  #onLine(t, range, width) {
    const { dx, dz } = dirOf(t.aim);
    const out = [];
    for (const z of this.zombies.inRange(t.cx, t.cz, range)) {
      const rx = z.x - t.cx, rz = z.z - t.cz;
      const along = rx * dx + rz * dz;
      if (along <= 0) continue;
      if (Math.abs(rx * dz - rz * dx) <= width && this.sees(t, z)) out.push(z);
    }
    return out;
  }

  #pick(t, range, exclude) {
    let best = null, bestScore = Infinity;
    for (const z of this.zombies.inRange(t.cx, t.cz, range)) {
      if (exclude?.has(z) || !this.sees(t, z)) continue;
      let score;
      switch (t.targeting) {
        case 'last': score = -this.zombies.threatDistance(z); break;
        case 'strongest': score = -z.hp; break;
        case 'nearest': score = Math.hypot(z.x - t.cx, z.z - t.cz); break;
        default: score = this.zombies.threatDistance(z);
      }
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  step(dt) {
    this.time += dt;
    for (const t of this.#towers.values()) {
      // Overclocked towers jam once the buff runs out.
      for (const b of t.buffs) {
        if (b.jamAfter && b.until <= this.time) {
          t.jammedUntil = Math.max(t.jammedUntil, this.time + b.jamAfter);
          b.jamAfter = 0;
          this.events.emit('towerJammed', { tower: t });
        }
      }
      if (t.buffs.length && t.buffs.every((b) => b.until <= this.time)) t.buffs.length = 0;
      t.cooldown = Math.max(0, t.cooldown - dt);
      if (t.cooldown > 0 || this.time < t.jammedUntil || this.isBuilding(t)) continue;
      if (t.ammo < 1) {
        const m = this.modsOf(t);
        if (!m.freeAmmo) {
          if (!t.empty) { t.empty = true; this.events.emit('towerEmpty', t); }
          continue;
        }
      }
      const m = this.modsOf(t);
      const s = t.stats;
      const range = s.range + m.rangeAdd;
      // Watchtowers light up stealthy enemies in range (and mark them), firing or not.
      if (s.reveal) for (const z of this.zombies.inRange(t.cx, t.cz, range)) if (z.stealth || s.markPct) this.zombies.reveal(z, 0.6, s.markPct);
      const first = s.aimed ? this.#onLine(t, range, this.types[t.type].projectile.width)[0] : this.#pick(t, range);
      t.targetId = first ? first.id : 0;
      if (!first) continue;
      t.facing = s.aimed ? t.aim : Math.atan2(first.x - t.cx, first.z - t.cz);
      t.cooldown = (s.interval / (1 + m.attackSpeedPct / 100)) / m.gunk;
      if (!m.freeAmmo) {
        t.ammo = Math.max(0, t.ammo - 1);
        if (t.ammo < this.rules.lowAmmo * s.maxAmmo && !t.lowWarned) {
          t.lowWarned = true;
          this.events.emit('towerLowAmmo', t);
        }
      }
      this.#fire(t, first, range, m);
    }
  }

  #fire(t, first, range, m) {
    const type = this.types[t.type];
    const s = t.stats;
    const payload = {
      damage: s.damage * (1 + m.damagePct / 100), type: s.damageType, armorPen: s.armorPen,
      radius: s.aoe, burn: s.burn, slow: s.slow, stun: s.stun, stunAll: s.stunAll, knock: s.knock, lift: s.lift,
      bossMult: s.bossMult, freezeChance: s.freezeChance, freezeTime: s.freezeTime,
      shred: s.shred, napalm: s.napalm, bleed: s.bleed,
      critChance: s.critChance + m.critAdd / 100,
      poison: s.poison, tags: s.tags,
      fx: s.aoe ? `${t.type}-small` : undefined,
    };
    // Ballista: a bolt straight along its aim that goes through everything on the line.
    if (s.aimed) {
      const { dx, dz } = dirOf(t.aim);
      const P = type.projectile;
      this.projectiles.fire({
        ownerId: t.id, kind: P.kind,
        from: { x: t.cx + dx * 0.5, y: 1.3, z: t.cz + dz * 0.5 },
        speed: P.speed,
        line: { dx, dz, length: range, width: P.width, maxHits: s.pierce ?? 999 },
        payload: { ...payload, radius: 0 },
      });
      this.events.emit('towerAttack', { tower: t, targets: [first] });
      return;
    }
    // Tesla: lightning jumps from the target to the nearest enemies it can see, weaker each jump.
    if (s.chain) {
      const hit = [first];
      let from = first;
      for (let j = 0; j < s.chain.jumps; j++) {
        let next = null, nd = Infinity;
        for (const z of this.zombies.inRange(from.x, from.z, s.chain.range)) {
          if (hit.includes(z) || !this.sees(t, z)) continue;
          const d = Math.hypot(z.x - from.x, z.z - from.z);
          if (d < nd) { nd = d; next = z; }
        }
        if (!next) break;
        hit.push(next);
        from = next;
      }
      hit.forEach((z, j) => this.combat.applyPayload(t.id, { ...payload, damage: payload.damage * s.chain.falloff ** j, stun: j ? 0 : payload.stun }, z, z.x, z.z));
      this.events.emit('teslaArc', { from: { x: t.cx, z: t.cz }, to: hit.map((z) => ({ x: z.x, z: z.z })) });
      this.events.emit('towerAttack', { tower: t, targets: hit });
      return;
    }
    if (type.projectile.kind === 'roller') {
      // Rolling stones: dropped at the tower's foot, they roll straight on past the target.
      const dx = first.x - t.cx, dz = first.z - t.cz, d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      const P = type.projectile;
      for (let b = 0; b < s.balls; b++) {
        const off = s.balls > 1 ? (b - (s.balls - 1) / 2) * 0.9 : 0;
        this.projectiles.fire({
          ownerId: t.id, kind: 'roller',
          from: { x: t.cx + ux * 0.6 - uz * off, y: 0.35, z: t.cz + uz * 0.6 + ux * off },
          speed: P.speed,
          line: { dx: ux, dz: uz, length: range + P.extraLength, width: P.width, maxHits: 999 },
          payload: { ...payload, radius: 0, knock: P.roll, lift: P.rollLift, fx: 'earth-small' },
        });
      }
      this.events.emit('towerAttack', { tower: t, targets: [first] });
      return;
    }
    const targets = [first];
    const used = new Set(targets);
    while (targets.length < s.targets) {
      const next = this.#pick(t, range, used);
      if (!next) break;
      targets.push(next);
      used.add(next);
    }
    for (const z of targets) {
      this.projectiles.fire({
        ownerId: t.id, kind: type.projectile.kind,
        from: { x: t.cx, y: 1.6, z: t.cz },
        target: z,
        arc: type.projectile.arc ?? 0,
        speed: type.projectile.speed,
        payload,
      });
    }
    this.events.emit('towerAttack', { tower: t, targets });
  }
}
