// Elemental towers on walls: building, upgrading, selling, targeting and firing. A wall can
// carry one tower, unless it is part of the champion's 2x2 block. A tower falls with its
// wall. Impacts reuse the combat payload system, so damage, burn, slow and stun behave the
// same as hero attacks.

export function towerStats(type, level, rules) {
  const k = level - 1;
  return {
    damage: type.damage * rules.damageMult ** k,
    range: type.range + rules.rangeAdd * k,
    interval: type.interval,
    aoe: type.aoe ?? 0,
    armorPen: type.armorPen ?? 0,
    burn: type.burn ? { dps: type.burn.dps * rules.burnMult ** k, duration: type.burn.duration } : null,
    stun: type.stun ? type.stun + rules.stunAdd * k : 0,
    targets: type.targets ? type.targets + rules.targetsAdd * k : 1,
    slow: type.slow ? { factor: type.slow.factor * rules.slowFactorMult ** k, duration: type.slow.duration } : null,
  };
}

export class TowerSystem {
  #towers = new Map();
  #nextId;

  /** @param {{walls, zombies, projectiles, economy, events, types, rules}} deps */
  constructor({ walls, zombies, projectiles, economy, events, types, rules }) {
    Object.assign(this, { walls, zombies, projectiles, economy, events, types, rules });
    this.#nextId = rules.idBase + 1;
    this.priceMultiplier = () => 1;
    events.on('wallRemoved', ({ wall, cause }) => {
      const t = wall.towerId ? this.get(wall.towerId) : null;
      if (!t) return;
      // Selling a wall sells its tower too; a destroyed wall takes the tower with it.
      if (cause === 'sold') this.sell(t.id);
      else this.#remove(t, 'destroyed');
    });
  }

  get(id) { return this.#towers.get(id) ?? null; }
  all() { return this.#towers.values(); }
  get count() { return this.#towers.size; }

  /** Base price of the next tower of this type: grows with every tower already standing. */
  priceOf(typeKey) {
    return Math.round(this.types[typeKey].cost * (1 + this.rules.costGrowth * this.#towers.size));
  }

  /** What the player pays now (includes the combat surcharge). */
  costOf(typeKey) {
    return Math.ceil(this.priceOf(typeKey) * this.priceMultiplier());
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canBuild(typeKey, wallId) {
    const w = this.walls.get(wallId);
    if (!this.types[typeKey]) return { ok: false, reason: 'unknown_type' };
    if (!w) return { ok: false, reason: 'no_wall' };
    if (w.towerId) return { ok: false, reason: 'has_tower' };
    if (w.heroes.length) return { ok: false, reason: 'hero_there' };
    if (!this.economy.canAfford(this.costOf(typeKey))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  build(typeKey, wallId) {
    const check = this.canBuild(typeKey, wallId);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'tower', reason: check.reason });
      return null;
    }
    const price = this.costOf(typeKey);
    if (!this.economy.trySpend(price, `tower:${typeKey}`)) return null;
    const w = this.walls.get(wallId);
    const t = {
      id: this.#nextId++,
      type: typeKey,
      wallId,
      x: w.x + 0.5, z: w.y + 0.5,
      level: 1,
      // Refunds use the base price paid, never the combat surcharge.
      invested: this.priceOf(typeKey),
      cooldown: 0,
      targetId: 0,
      facing: Math.PI,
      targeting: 'threat',
      kills: 0,
      waveDamage: 0, lastWaveDamage: 0, lastWaveDps: 0, totalDamage: 0,
    };
    t.stats = towerStats(this.types[typeKey], 1, this.rules);
    w.towerId = t.id;
    this.#towers.set(t.id, t);
    this.events.emit('towerBuilt', t);
    return t;
  }

  upgradeCost(id) {
    const t = this.get(id);
    if (!t || t.level >= this.rules.maxLevel) return 0;
    return Math.ceil(this.types[t.type].cost * this.rules.costMult[t.level - 1] * this.priceMultiplier());
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canUpgrade(id) {
    const t = this.get(id);
    if (!t) return { ok: false, reason: 'no_tower' };
    if (t.level >= this.rules.maxLevel) return { ok: false, reason: 'max_level' };
    if (!this.economy.canAfford(this.upgradeCost(id))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  upgrade(id) {
    const check = this.canUpgrade(id);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'towerUpgrade', reason: check.reason });
      return false;
    }
    const t = this.get(id);
    const cost = this.upgradeCost(id);
    if (!this.economy.trySpend(cost, `towerUpgrade:${t.type}`)) return false;
    t.invested += this.types[t.type].cost * this.rules.costMult[t.level - 1];
    t.level++;
    t.stats = towerStats(this.types[t.type], t.level, this.rules);
    this.events.emit('towerUpgraded', t);
    return true;
  }

  sellValue(id) {
    const t = this.get(id);
    return t ? Math.floor(t.invested * this.rules.sellRefund) : 0;
  }

  sell(id) {
    const t = this.get(id);
    if (!t) return false;
    const value = this.sellValue(id);
    this.#remove(t, 'sold');
    this.economy.earn(value, `sellTower:${t.type}`);
    return true;
  }

  setTargeting(id, mode) {
    const t = this.get(id);
    if (t) { t.targeting = mode; t.targetId = 0; }
  }

  #remove(t, cause) {
    this.#towers.delete(t.id);
    const w = this.walls.get(t.wallId);
    if (w && w.towerId === t.id) w.towerId = 0;
    this.events.emit('towerRemoved', { tower: t, cause });
  }

  #pick(t, exclude) {
    let best = null, bestScore = Infinity;
    for (const z of this.zombies.inRange(t.x, t.z, t.stats.range)) {
      if (exclude?.has(z)) continue;
      let score;
      switch (t.targeting) {
        case 'nearest': score = Math.hypot(z.x - t.x, z.z - t.z); break;
        case 'strongest': score = -z.hp; break;
        case 'weakest': score = z.hp; break;
        default: score = this.zombies.threatDistance(z);
      }
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  step(dt) {
    for (const t of this.#towers.values()) {
      t.cooldown = Math.max(0, t.cooldown - dt);
      if (t.cooldown > 0) continue;
      const first = this.#pick(t);
      t.targetId = first ? first.id : 0;
      if (!first) continue;
      t.facing = Math.atan2(first.x - t.x, first.z - t.z);
      t.cooldown = t.stats.interval;
      const type = this.types[t.type];
      const s = t.stats;
      const targets = [first];
      const used = new Set(targets);
      while (targets.length < s.targets) {
        const next = this.#pick(t, used);
        if (!next) break;
        targets.push(next);
        used.add(next);
      }
      for (const z of targets) {
        this.projectiles.fire({
          ownerId: t.id, kind: type.projectile.kind,
          from: { x: t.x, y: 2.1, z: t.z },
          target: z,
          arc: type.projectile.arc ?? 0,
          speed: type.projectile.speed,
          payload: {
            damage: s.damage, type: type.damageType, armorPen: s.armorPen,
            radius: s.aoe, burn: s.burn, slow: s.slow, stun: s.stun,
            fx: s.aoe ? `${t.type}-small` : undefined,
          },
        });
      }
      this.events.emit('towerAttack', { tower: t, targets });
    }
  }
}
