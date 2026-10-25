// Hero combat: basic attacks for every class, active abilities, passive effects (wall
// guard, wall mending) and impact resolution. Projectiles carry a payload describing what
// happens on impact; applyPayload() is the single place that turns payloads into damage,
// damage over time, slows, stuns and ground zones.

const R = Math.hypot;

export class CombatSystem {
  /** @param {{heroes, zombies, walls, projectiles, zones, events, rng, types, rules}} deps */
  constructor(deps) {
    Object.assign(this, deps);
    this.time = 0;
  }

  // --- impacts -------------------------------------------------------------
  /** Called by the projectile system for every impact. */
  impact(p, zombie, x, z) {
    this.applyPayload(p.ownerId, p.payload, zombie, x, z);
  }

  /**
   * @param {{damage?:number, type?:string, armorPen?:number, crit?:boolean, radius?:number,
   *          poison?:{dps,duration}, burn?:{dps,duration}, slow?:{factor,duration}, stun?:number,
   *          zone?:object, fx?:string}} pl
   */
  applyPayload(ownerId, pl, direct, x, z) {
    const zs = this.zombies;
    const victims = pl.radius > 0 ? [...zs.inRange(x, z, pl.radius)] : direct ? [direct] : [];
    for (const v of victims) {
      if (pl.damage) zs.damage(v, pl.damage, ownerId, { type: pl.type, armorPen: pl.armorPen, crit: pl.crit });
      if (!v.alive) continue;
      if (pl.poison) zs.addDot(v, { ...pl.poison, ownerId, type: 'poison' });
      if (pl.burn) zs.addDot(v, { ...pl.burn, ownerId, type: 'fire' });
      if (pl.slow) zs.applySlow(v, pl.slow.factor, pl.slow.duration);
      if (pl.stun) zs.applyStun(v, pl.stun);
    }
    if (pl.zone) this.zones.add({ ...pl.zone, x, z, ownerId });
    if (pl.radius > 0 || pl.fx) this.events.emit('impactFx', { x, z, radius: pl.radius ?? 0, fx: pl.fx ?? 'hit' });
  }

  // --- walls ---------------------------------------------------------------
  /** Damage multiplier for a wall from warriors, paladin auras and timed buffs. */
  wallDamageMultiplier(wall) {
    let m = 1;
    for (const h of this.heroes.active()) {
      const s = h.stats;
      if (s.wallGuard > 0) {
        if (h.wallId === wall.id) m *= 1 - s.wallGuard;
        else if (s.guardAdjacent) {
          const hw = this.walls.get(h.wallId);
          if (hw && Math.abs(hw.x - wall.x) + Math.abs(hw.y - wall.y) === 1) m *= 1 - s.wallGuard / 2;
        }
      }
      if (s.auraGuard > 0) {
        const p = this.heroes.positionOf(h);
        if (R(p.x - wall.x - 0.5, p.z - wall.y - 0.5) <= s.auraRadius) m *= 1 - s.auraGuard;
      }
    }
    let best = 0;
    for (const b of wall.buffs) if (b.until > this.time) best = Math.max(best, b.reduction);
    return m * (1 - best);
  }

  #buffWall(wall, reduction, duration, kind) {
    wall.buffs = wall.buffs.filter((b) => b.until > this.time);
    wall.buffs.push({ reduction, until: this.time + duration, kind });
    this.events.emit('wallBuffed', { wall, kind, duration });
  }

  // --- per step ------------------------------------------------------------
  step(dt) {
    this.time += dt;
    for (const h of this.heroes.all()) {
      for (const id of Object.keys(h.abilityCooldowns)) {
        h.abilityCooldowns[id] = Math.max(0, h.abilityCooldowns[id] - dt);
      }
      if (!h.wallId) continue;
      if (h.moving > 0) { h.moving = Math.max(0, h.moving - dt); continue; }
      const pos = this.heroes.positionOf(h);
      if (h.stats.repairPerSec > 0) this.#mendWalls(h, pos, dt);
      h.cooldown = Math.max(0, h.cooldown - dt);
      let target = h.targetId ? this.zombies.list.find((z) => z.id === h.targetId && z.alive) ?? null : null;
      if (target && R(target.x - pos.x, target.z - pos.z) > h.stats.range) target = null;
      if (!target) target = this.heroes.pickTarget(h, pos);
      h.targetId = target ? target.id : 0;
      if (!target) continue;
      h.facing = Math.atan2(target.x - pos.x, target.z - pos.z);
      if (h.cooldown > 0) continue;
      h.cooldown = h.stats.attackInterval;
      this.#basicAttack(h, target, pos);
    }
  }

  #mendWalls(h, pos, dt) {
    const r = h.stats.auraRadius;
    for (const w of this.walls.all()) {
      if (w.hp >= w.maxHp) continue;
      if (R(w.x + 0.5 - pos.x, w.y + 0.5 - pos.z) <= r) w.hp = Math.min(w.maxHp, w.hp + h.stats.repairPerSec * dt);
    }
    // The aura also tends to heroes (including the paladin).
    for (const o of this.heroes.active()) {
      if (o.hp >= o.maxHp) continue;
      const p = this.heroes.positionOf(o);
      if (R(p.x - pos.x, p.z - pos.z) <= r) this.heroes.heal(o, h.stats.healPerSec * dt);
    }
  }

  #roll(h) {
    const crit = this.rng.next() < h.stats.critChance;
    return { crit, damage: h.stats.damage * (crit ? h.stats.critMultiplier : 1) };
  }

  #basicAttack(h, target, pos) {
    const s = h.stats;
    const t = this.types[h.type];
    const { crit, damage } = this.#roll(h);
    const from = { x: pos.x, y: 1.9, z: pos.z };
    const base = { damage, type: s.damageType, armorPen: s.armorPen, crit };
    switch (t.attack.kind) {
      case 'arrow':
        if (s.pierce > 0) {
          const d = R(target.x - pos.x, target.z - pos.z) || 1;
          this.projectiles.fire({
            ownerId: h.id, kind: 'arrow', from, speed: t.attack.speed, payload: base,
            line: { dx: (target.x - pos.x) / d, dz: (target.z - pos.z) / d, length: s.range + 1, width: 0.45, maxHits: 1 + s.pierce },
          });
        } else {
          this.projectiles.fire({ ownerId: h.id, kind: 'arrow', from, target, speed: t.attack.speed, payload: base });
        }
        break;
      case 'bolt':
        this.projectiles.fire({
          ownerId: h.id, kind: 'bolt', from, target, speed: t.attack.speed,
          payload: { ...base, radius: s.aoe, fx: s.aoe ? 'bolt' : undefined },
        });
        break;
      case 'orb':
        this.projectiles.fire({
          ownerId: h.id, kind: 'orb', from, target, speed: t.attack.speed,
          payload: { ...base, radius: s.aoe, fx: 'arcane-small' },
        });
        break;
      case 'flask':
        this.projectiles.fire({
          ownerId: h.id, kind: 'flask', from, point: { x: target.x, z: target.z }, speed: t.attack.speed, arc: 1.2,
          payload: { ...base, radius: s.aoe, poison: { dps: s.poisonDps, duration: s.poisonDuration }, fx: 'poison-small' },
        });
        break;
      case 'melee': {
        this.zombies.damage(target, damage, h.id, base);
        if (s.cleave) {
          for (const z of [...this.zombies.inRange(target.x, target.z, 0.9)]) {
            if (z !== target) this.zombies.damage(z, damage * 0.5, h.id, base);
          }
        }
        this.events.emit('meleeHit', { hero: h, target, crit, holy: s.damageType === 'holy' });
        break;
      }
      default:
        break;
    }
    this.events.emit('heroAttack', { hero: h, target });
  }

  // --- abilities -----------------------------------------------------------
  abilityConfig(h, id) {
    return this.types[h.type].abilities?.[id] ?? null;
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canUse(heroId, id, target = null) {
    const h = this.heroes.get(heroId);
    const a = h && this.abilityConfig(h, id);
    if (!h || !a) return { ok: false, reason: 'unknown_ability' };
    if (!h.wallId) return { ok: false, reason: 'not_deployed' };
    if (h.moving > 0) return { ok: false, reason: 'moving' };
    if (h.level < a.unlock) return { ok: false, reason: 'locked' };
    if ((h.abilityCooldowns[id] ?? 0) > 0) return { ok: false, reason: 'cooldown' };
    if (a.target === 'none') return { ok: true };
    if (!target) return { ok: false, reason: 'no_target' };
    const pos = this.heroes.positionOf(h);
    const reach = a.reach ?? h.stats.range + this.rules.abilityRangeBonus;
    if (a.target === 'point') {
      if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) return { ok: false, reason: 'no_target' };
      if (R(target.x - pos.x, target.z - pos.z) > reach) return { ok: false, reason: 'out_of_range' };
    } else if (a.target === 'enemy') {
      const z = this.zombies.list.find((q) => q.id === target.zombieId && q.alive);
      if (!z) return { ok: false, reason: 'no_target' };
      if (R(z.x - pos.x, z.z - pos.z) > h.stats.range) return { ok: false, reason: 'out_of_range' };
    } else if (a.target === 'wall') {
      const w = this.walls.get(target.wallId);
      if (!w) return { ok: false, reason: 'no_target' };
      if (R(w.x + 0.5 - pos.x, w.y + 0.5 - pos.z) > a.reach) return { ok: false, reason: 'out_of_range' };
    }
    return { ok: true };
  }

  /** Reach used for targeting previews (point/enemy/wall). */
  abilityReach(h, id) {
    const a = this.abilityConfig(h, id);
    if (!a) return 0;
    if (a.target === 'enemy') return h.stats.range;
    return a.reach ?? h.stats.range + this.rules.abilityRangeBonus;
  }

  /** Effect radius for targeting previews. */
  abilityRadius(h, id) {
    const a = this.abilityConfig(h, id);
    const m = h.stats.mods;
    switch (id) {
      case 'fireball': return a.radius + (m.fireballRadiusAdd ?? 0);
      case 'consecration': return a.radius + (m.consecrationRadiusAdd ?? 0);
      case 'toxicFlask': return a.radius + (m.cloudRadiusAdd ?? 0);
      case 'explosiveMixture': return a.radius + (m.explosiveRadiusAdd ?? 0);
      default: return a?.radius ?? 0;
    }
  }

  use(heroId, id, target = null) {
    const check = this.canUse(heroId, id, target);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'ability', reason: check.reason });
      return check;
    }
    const h = this.heroes.get(heroId);
    const a = this.abilityConfig(h, id);
    const s = h.stats, m = s.mods;
    const pos = this.heroes.positionOf(h);
    const from = { x: pos.x, y: 1.9, z: pos.z };
    const adm = s.abilityDamageMult;
    const t = this.types[h.type];
    switch (id) {
      case 'multishot': {
        const n = a.arrows + (m.multishotAdd ?? 0);
        const targets = [...this.zombies.inRange(pos.x, pos.z, s.range)]
          .sort((p, q) => this.zombies.threatDistance(p) - this.zombies.threatDistance(q)).slice(0, n);
        if (!targets.length) return this.#reject('no_target');
        for (const z of targets) {
          const { crit, damage } = this.#roll(h);
          this.projectiles.fire({
            ownerId: h.id, kind: 'arrow', from, target: z, speed: t.attack.speed,
            payload: { damage: damage * a.damageMult, type: 'physical', armorPen: s.armorPen, crit },
          });
        }
        break;
      }
      case 'piercing': {
        const d = R(target.x - pos.x, target.z - pos.z) || 1;
        this.projectiles.fire({
          ownerId: h.id, kind: 'piercing', from, speed: a.speed,
          line: { dx: (target.x - pos.x) / d, dz: (target.z - pos.z) / d, length: s.range + a.extraLength, width: a.width, maxHits: 99 },
          payload: { damage: s.damage * a.damageMult * adm, type: 'physical', armorPen: s.armorPen },
        });
        break;
      }
      case 'fireball':
        this.projectiles.fire({
          ownerId: h.id, kind: 'fireball', from, point: target, speed: a.speed, arc: 0.8,
          payload: {
            damage: a.damage * adm, type: 'fire', radius: this.abilityRadius(h, id),
            burn: { dps: a.burnDps * adm, duration: a.burnDuration }, fx: 'fire',
          },
        });
        break;
      case 'frostNova':
        this.applyPayload(h.id, {
          damage: a.damage * adm, type: 'magic', radius: a.radius, fx: 'frost',
          slow: { factor: m.slowFactor ?? a.slow, duration: a.slowDuration + (m.slowDurationAdd ?? 0) },
        }, null, pos.x, pos.z);
        break;
      case 'arcaneBlast':
        this.applyPayload(h.id, { damage: a.damage * adm, type: 'magic', radius: a.radius, fx: 'arcane' }, null, target.x, target.z);
        break;
      case 'shieldBash':
        this.applyPayload(h.id, {
          damage: a.damage * adm, type: 'physical', radius: a.radius, stun: a.stun + (m.stunAdd ?? 0), fx: 'bash',
        }, null, pos.x, pos.z);
        break;
      case 'rally': {
        const dur = a.duration + (m.rallyDurationAdd ?? 0);
        for (const w of this.walls.all()) {
          if (R(w.x + 0.5 - pos.x, w.y + 0.5 - pos.z) <= a.radius) this.#buffWall(w, a.reduction, dur, 'rally');
        }
        this.events.emit('impactFx', { x: pos.x, z: pos.z, radius: a.radius, fx: 'rally' });
        break;
      }
      case 'apBolt': {
        const z = this.zombies.list.find((q) => q.id === target.zombieId);
        this.projectiles.fire({
          ownerId: h.id, kind: 'apbolt', from, target: z, speed: a.speed,
          payload: { damage: s.damage * a.damageMult * adm, type: 'physical', armorPen: 1, crit: true, fx: 'bolt' },
        });
        break;
      }
      case 'holyShield': {
        const w = this.walls.get(target.wallId);
        const dur = a.duration + (m.shieldDurationAdd ?? 0);
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.walls.at(w.x + dx, w.y + dy);
          if (n) this.#buffWall(n, a.reduction, dur, 'holy');
        }
        break;
      }
      case 'consecration':
        this.zones.add({
          x: target.x, z: target.z, radius: this.abilityRadius(h, id), duration: a.duration,
          dps: a.dps * adm, type: 'holy', ownerId: h.id, kind: 'holy',
        });
        break;
      case 'toxicFlask':
        this.projectiles.fire({
          ownerId: h.id, kind: 'flask', from, point: target, speed: a.speed, arc: 1.4,
          payload: {
            fx: 'poison',
            zone: {
              radius: this.abilityRadius(h, id), duration: a.duration + (m.cloudDurationAdd ?? 0),
              dps: a.dps * (m.poisonMult ?? 1) * adm, type: 'poison', kind: 'poison',
            },
          },
        });
        break;
      case 'explosiveMixture':
        this.projectiles.fire({
          ownerId: h.id, kind: 'bomb', from, point: target, speed: a.speed, arc: 1.4,
          payload: {
            damage: a.damage * (m.explosiveDamageMult ?? 1) * adm, type: 'physical',
            radius: this.abilityRadius(h, id), fx: 'explosion',
          },
        });
        break;
      default:
        return this.#reject('unknown_ability');
    }
    h.abilityCooldowns[id] = a.cooldown * s.cooldownMult;
    if (target?.x !== undefined) h.facing = Math.atan2(target.x - pos.x, target.z - pos.z);
    this.events.emit('abilityUsed', { hero: h, abilityId: id, target });
    return { ok: true };
  }

  #reject(reason) {
    this.events.emit('actionRejected', { action: 'ability', reason });
    return { ok: false, reason };
  }
}
