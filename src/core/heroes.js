// Hero recruitment, deployment on walls, repositioning, dismissal, targeting and attacks.
// A hero is either in reserve (wallId 0), walking to a wall (moving > 0) or deployed.

export class HeroSystem {
  #heroes = new Map();
  #nextId = 1;

  /**
   * @param {{walls, zombies, projectiles, economy, events, rng, types, rules, economyConfig}} deps
   */
  constructor({ walls, zombies, projectiles, economy, events, rng, types, rules, economyConfig }) {
    Object.assign(this, { walls, zombies, projectiles, economy, events, rng, types, rules, economyConfig });
    this.usedNames = new Set();
    // A destroyed wall drops its heroes back into reserve so they can be redeployed.
    events.on('wallRemoved', ({ wall, cause }) => {
      for (const id of [...wall.heroes]) {
        const h = this.get(id);
        if (!h) continue;
        h.wallId = 0;
        h.moving = 0;
        this.events.emit('heroUnseated', { hero: h, cause });
      }
      wall.heroes.length = 0;
    });
  }

  get(id) { return this.#heroes.get(id) ?? null; }
  all() { return this.#heroes.values(); }
  get count() { return this.#heroes.size; }

  get deployedCount() {
    let n = 0;
    for (const h of this.#heroes.values()) if (h.wallId) n++;
    return n;
  }

  #pickName() {
    const free = this.rules.names.filter((n) => !this.usedNames.has(n));
    const name = free.length ? this.rng.pick(free) : `${this.rng.pick(this.rules.names)} ${this.#nextId}`;
    this.usedNames.add(name);
    return name;
  }

  canRecruit(typeKey) {
    const t = this.types[typeKey];
    if (!t) return { ok: false, reason: 'unknown_type' };
    if (!this.economy.canAfford(t.cost)) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  /** Pays and creates a hero in reserve. Returns the hero or null. */
  recruit(typeKey) {
    const check = this.canRecruit(typeKey);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'recruit', reason: check.reason });
      return null;
    }
    const t = this.types[typeKey];
    if (!this.economy.trySpend(t.cost, `recruit:${typeKey}`)) return null;
    const hero = {
      id: this.#nextId++,
      type: typeKey,
      name: this.#pickName(),
      level: 1,
      xp: 0,
      hp: t.hp, maxHp: t.hp,
      damage: t.damage,
      attackInterval: t.attackInterval,
      range: t.range,
      critChance: t.critChance,
      critMultiplier: t.critMultiplier,
      invested: t.cost,
      wallId: 0,
      moving: 0, // seconds left walking to the assigned wall
      cooldown: 0,
      targetId: 0,
      facing: Math.PI, // face north
      lastAttackAt: -1,
      kills: 0,
    };
    this.#heroes.set(hero.id, hero);
    this.events.emit('heroRecruited', hero);
    return hero;
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canDeploy(heroId, wallId) {
    const h = this.get(heroId);
    const w = this.walls.get(wallId);
    if (!h) return { ok: false, reason: 'no_hero' };
    if (!w) return { ok: false, reason: 'no_wall' };
    if (h.wallId === wallId) return { ok: false, reason: 'already_there' };
    if (w.heroes.length >= w.heroCapacity) return { ok: false, reason: 'wall_full' };
    return { ok: true };
  }

  /**
   * Assigns a hero to a wall. From reserve the hero appears at once; moving between walls
   * takes rules.repositionTime seconds during which the hero cannot attack.
   */
  deploy(heroId, wallId) {
    const check = this.canDeploy(heroId, wallId);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'deploy', reason: check.reason });
      return false;
    }
    const h = this.get(heroId);
    const from = h.wallId ? this.walls.get(h.wallId) : null;
    if (from) from.heroes.splice(from.heroes.indexOf(h.id), 1);
    const w = this.walls.get(wallId);
    w.heroes.push(h.id);
    h.wallId = wallId;
    h.moving = from ? this.rules.repositionTime : 0;
    h.targetId = 0;
    this.events.emit('heroDeployed', { hero: h, wall: w, from });
    return true;
  }

  refundValue(heroId) {
    const h = this.get(heroId);
    return h ? Math.floor(h.invested * this.economyConfig.heroRefund) : 0;
  }

  dismiss(heroId) {
    const h = this.get(heroId);
    if (!h) return false;
    const refund = this.refundValue(heroId);
    const w = h.wallId ? this.walls.get(h.wallId) : null;
    if (w) w.heroes.splice(w.heroes.indexOf(h.id), 1);
    this.#heroes.delete(h.id);
    this.usedNames.delete(h.name);
    this.economy.earn(refund, `dismiss:${h.type}`);
    this.events.emit('heroDismissed', h);
    return true;
  }

  /** World position (x, z) of a deployed hero: the centre of its wall cell. */
  positionOf(h) {
    const w = this.walls.get(h.wallId);
    return w ? { x: w.x + 0.5, z: w.y + 0.5 } : null;
  }

  /** Default targeting: the living zombie in range that is closest to the gate by path. */
  pickTarget(h, pos) {
    let best = null, bestDist = Infinity;
    for (const z of this.zombies.inRange(pos.x, pos.z, h.range)) {
      const d = this.zombies.threatDistance(z);
      if (d < bestDist) { bestDist = d; best = z; }
    }
    return best;
  }

  step(dt, simTime) {
    for (const h of this.#heroes.values()) {
      if (!h.wallId) continue;
      if (h.moving > 0) { h.moving = Math.max(0, h.moving - dt); continue; }
      h.cooldown = Math.max(0, h.cooldown - dt);
      const pos = this.positionOf(h);
      let target = this.zombies.list.find((z) => z.id === h.targetId && z.alive) ?? null;
      if (target && Math.hypot(target.x - pos.x, target.z - pos.z) > h.range) target = null;
      if (!target) target = this.pickTarget(h, pos);
      h.targetId = target ? target.id : 0;
      if (!target) continue;
      h.facing = Math.atan2(target.x - pos.x, target.z - pos.z);
      if (h.cooldown > 0) continue;
      h.cooldown = h.attackInterval;
      h.lastAttackAt = simTime;
      const crit = this.rng.next() < h.critChance;
      this.projectiles.fire({
        ownerId: h.id,
        kind: 'arrow',
        from: { x: pos.x, y: 1.9, z: pos.z },
        target,
        speed: this.types[h.type].projectileSpeed,
        damage: h.damage * (crit ? h.critMultiplier : 1),
        crit,
      });
      this.events.emit('heroAttack', { hero: h, target });
    }
  }

  /** Gives XP to heroes that damaged a dead zombie, split by damage share. */
  awardKillXp(zombie) {
    let total = 0;
    for (const v of zombie.contributors.values()) total += v;
    if (!total) return;
    for (const [id, dmg] of zombie.contributors) {
      const h = this.get(id);
      if (!h) continue;
      h.xp += zombie.xp * (dmg / total) + dmg * this.rules.xpPerDamage;
    }
  }
}
