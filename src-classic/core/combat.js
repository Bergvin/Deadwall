// Hero combat: basic attacks by weapon style, active abilities, passive effects (wall
// guard, wall mending) and impact resolution. Projectiles carry a payload describing what
// happens on impact; applyPayload() is the single place that turns payloads into damage,
// damage over time, slows, stuns, shoves and ground zones.
//
// The hero's build (core/heroBuild.js) adds mechanics on top: extra projectiles, bounces,
// splitting shards, pierce, melee reach, whirlwinds that hurl enemies away from the gate,
// knockback and blasts, burns/poison/slows on hit, chain lightning, critical cascades,
// execute/shatter/giant-slayer damage bonuses, frenzy, double strikes, quakes, corpse
// explosions, wildfire, plague bursts, life steal and gold on kill.
import { activeConfig } from './heroBuild.js';

const R = Math.hypot;
/** Seconds between automatic ability checks. */
const AUTO_CAST_INTERVAL = 0.5;
/** After this many seconds ready with enemies in reach, an ability is cast on the best target even without a pack. */
const AUTO_CAST_PATIENCE = 3;
/** Bounce / shard / chain search radius (cells). */
const HOP_RANGE = 5;
/** Never more projectiles than this in flight (bounces and shards are dropped beyond it). */
const PROJECTILE_CAP = 600;
/** How deep corpse explosions may set off more corpse explosions in one go. */
const MAX_BLAST_CHAIN = 8;

export class CombatSystem {
  /** @param {{heroes, zombies, walls, projectiles, zones, events, rng, types, rules, economy?, cfg?, gate?}} deps
   *  cfg: the whole gameplay config; with it heroes use the build system (weapons, abilities). */
  constructor(deps) {
    Object.assign(this, deps);
    this.time = 0;
    this.blastDepth = 0;
    this.events.on('zombieKilled', ({ zombie, killerId }) => this.#onKill(zombie, killerId));
  }

  // --- impacts -------------------------------------------------------------
  /** Called by the projectile system for every impact. */
  impact(p, zombie, x, z) {
    const pl = p.payload;
    // A rolling ball shoves what it rolls over sideways, off its path.
    if (pl.roll && zombie && p.line) {
      const side = (zombie.x - p.x) * p.line.dz - (zombie.z - p.z) * p.line.dx >= 0 ? 1 : -1;
      this.zombies.push(zombie, p.line.dz * side + p.line.dx * 0.4, -p.line.dx * side + p.line.dz * 0.4, pl.roll, pl.rollLift ?? 0);
    }
    this.applyPayload(p.ownerId, pl, zombie, x, z);
    if (pl.hero) this.#afterHit(pl.hero, pl, zombie, x, z, p);
  }

  /** Extra damage from the hero's build against this victim. */
  #bonusMult(h, v) {
    const s = h.stats;
    let m = 1;
    if (s.executePct && v.hp / v.maxHp < 0.35) m += s.executePct;
    if (s.shatterPct && this.zombies.time < v.slowUntil) m += s.shatterPct;
    if (s.eliteDmgPct && (v.elite || v.boss)) m += s.eliteDmgPct;
    if (s.burningDmgPct && this.zombies.time < v.burnUntil) m += s.burningDmgPct;
    return m;
  }

  /**
   * @param {{damage?:number, type?:string, armorPen?:number, crit?:boolean, radius?:number,
   *          poison?:{dps,duration}, burn?:{dps,duration}, slow?:{factor,duration}, stun?:number,
   *          zone?:object, fx?:string}} pl
   */
  applyPayload(ownerId, pl, direct, x, z) {
    const zs = this.zombies;
    const victims = pl.radius > 0 ? [...zs.inRange(x, z, pl.radius)] : direct ? [direct] : [];
    if (direct && pl.radius > 0 && direct.alive && !victims.includes(direct)) victims.push(direct);
    const h = pl.hero;
    for (const v of victims) {
      const slowed = zs.time < v.slowUntil;
      if (pl.damage) zs.damage(v, pl.damage * (h ? this.#bonusMult(h, v) : 1), ownerId, { type: pl.type, armorPen: pl.armorPen, crit: pl.crit });
      // Shoves: knockback away from the source, blasts outward from the impact (negative
      // pulls in), tosses away from the gate. Applied to the dead too, for show.
      const dx = v.x - x, dz = v.z - z;
      if (pl.knock && pl.from) zs.push(v, v.x - pl.from.x, v.z - pl.from.z, pl.knock, pl.knock * 0.25);
      if (pl.blast) {
        const near = pl.radius > 0 ? 1 - 0.5 * Math.min(1, Math.hypot(dx, dz) / pl.radius) : 1;
        zs.push(v, dx || this.rng.range(-1, 1), dz || this.rng.range(-1, 1), pl.blast * near, pl.blast > 0 ? (pl.lift ?? pl.blast * 0.4) * near : 0);
      }
      if (pl.toss && this.gate) zs.push(v, v.x - this.gate.x - 0.5, v.z - this.gate.y - 0.5, pl.toss, pl.lift ?? pl.toss);
      if (!v.alive) continue;
      if (h?.stats.freezeChance && slowed && this.rng.next() < h.stats.freezeChance) zs.applyStun(v, 1.5);
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
        // The champion guards every wall of its 2x2 block (and with Guardian, the ring around it).
        if (h.wallIds.includes(wall.id)) m *= 1 - s.wallGuard;
        else if (s.guardAdjacent && h.block) {
          const dx = wall.x - h.block.x, dy = wall.y - h.block.y;
          if (dx >= -1 && dx <= 2 && dy >= -1 && dy <= 2) m *= 1 - s.wallGuard / 2;
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
    this.autoTimer = (this.autoTimer ?? 0) - dt;
    if (this.autoTimer <= 0) {
      this.autoTimer = AUTO_CAST_INTERVAL;
      for (const h of this.heroes.active()) if (h.autoCast) this.#autoCast(h);
    }
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
      if (!target) { if (h.frenzy) h.frenzy = Math.max(0, h.frenzy - dt * 0.25); continue; }
      h.facing = Math.atan2(target.x - pos.x, target.z - pos.z);
      if (h.cooldown > 0) continue;
      h.cooldown = h.stats.attackInterval / (1 + (h.frenzy ?? 0));
      this.#basicAttack(h, target, pos);
      // Double Strike: sometimes the attack simply happens twice.
      if (h.stats.doubleStrike && this.rng.next() < h.stats.doubleStrike && target.alive) this.#basicAttack(h, target, pos);
      if (h.stats.frenzyMax) h.frenzy = Math.min(h.stats.frenzyMax, (h.frenzy ?? 0) + 0.04);
    }
  }

  /**
   * Automatic ability use: every ready, unlocked ability is cast when it would be worth it.
   * Area abilities wait for a pack (or a boss/elite), single-target abilities pick the
   * toughest enemy in range, wall buffs go to walls that are under attack or badly hurt.
   */
  #autoCast(h) {
    const pos = this.heroes.positionOf(h);
    const zs = this.zombies;
    const big = (z) => z.boss || z.elite;
    h.autoWait ??= {};
    for (const id of this.abilityIds(h)) {
      const a = this.abilityConfig(h, id);
      if (!a || h.level < (a.unlock ?? 0) || (h.abilityCooldowns[id] ?? 0) > 0) continue;
      const reach = this.abilityReach(h, id);
      const near = [...zs.inRange(pos.x, pos.z, reach)];
      if (!near.length && a.target !== 'wall') { h.autoWait[id] = 0; continue; }
      // Wait a little for a better (denser) target, but never hoard a ready ability.
      h.autoWait[id] = (h.autoWait[id] ?? 0) + AUTO_CAST_INTERVAL;
      const impatient = h.autoWait[id] >= AUTO_CAST_PATIENCE;
      const minPack = impatient ? 1 : 2;
      let target = null;
      if (a.target === 'none') {
        if (id === 'rally') {
          // Rally when zombies are hammering walls close to the warrior.
          const attackers = near.filter((z) => z.state === 'attackWall' && R(z.x - pos.x, z.z - pos.z) <= a.radius);
          if (attackers.length < minPack) continue;
        } else {
          const r = a.radius ?? h.stats.range;
          const inside = [...zs.inRange(pos.x, pos.z, r)];
          if (inside.length < minPack && !inside.some(big)) continue;
        }
      } else if (a.target === 'point') {
        const radius = this.abilityRadius(h, id) || 1;
        let best = null, score = 0;
        for (const z of near) {
          const s = [...zs.inRange(z.x, z.z, radius)].length + (big(z) ? 2 : 0);
          if (s > score) { score = s; best = z; }
        }
        // A pack of three normally; when impatient, any single enemy will do.
        if (!best || score < (impatient ? 1 : 3)) continue;
        target = { x: best.x, z: best.z };
      } else if (a.target === 'enemy') {
        const pick = near.filter((z) => R(z.x - pos.x, z.z - pos.z) <= h.stats.range)
          .sort((p, q) => (big(q) - big(p)) || q.hp - p.hp)[0];
        if (!pick) continue;
        target = { zombieId: pick.id };
      } else if (a.target === 'wall') {
        const w = [...this.walls.all()]
          .filter((x) => R(x.x + 0.5 - pos.x, x.y + 0.5 - pos.z) <= a.reach)
          .filter((x) => x.hp < x.maxHp * 0.6 || zs.list.some((z) => z.alive && z.targetWallId === x.id))
          .sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp)[0];
        if (!w || w.buffs.some((b) => b.until > this.time)) continue;
        target = { wallId: w.id };
      }
      if (this.canUse(h.id, id, target).ok && this.use(h.id, id, target).ok) h.autoWait[id] = 0;
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

  /** The payload a hero hit carries: damage plus every on-hit effect of the build. */
  #heroPayload(h, damage, crit, from) {
    const s = h.stats;
    const pl = { damage, type: s.damageType, armorPen: s.armorPen, crit };
    if (!this.cfg?.WEAPON_STYLES) return pl;
    pl.hero = h;
    if (s.aoe > 0) { pl.radius = s.aoe; pl.fx = s.flameAvatar ? 'fire' : 'hit-small'; }
    const poison = (s.poisonDps ?? 0) + damage * (s.poisonPct ?? 0);
    if (poison > 0) pl.poison = { dps: poison, duration: s.poisonDuration || 4 };
    if (s.burnPct > 0) pl.burn = { dps: damage * s.burnPct, duration: 3 };
    if (s.slowPct > 0) pl.slow = { factor: 1 - s.slowPct, duration: 2 };
    if (s.knockback > 0) { pl.knock = s.knockback; pl.from = { x: from.x, z: from.z }; }
    if (s.blastForce) { pl.blast = s.blastForce; pl.radius = Math.max(pl.radius ?? 0, 0.8); pl.fx ??= 'hit-small'; }
    if (s.bounce > 0) pl.bounce = s.bounce;
    if (s.split > 0) { pl.split = s.split; pl.splitGen = s.splitGenerations; }
    pl.hitIds = [];
    return pl;
  }

  /** Living enemies near (x, z), nearest first, excluding ids in `skip`. */
  #nearby(x, z, range, skip = []) {
    return [...this.zombies.inRange(x, z, range)]
      .filter((q) => !skip.includes(q.id))
      .sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
  }

  #fireShot(h, kind, target, from, pl, speed, arc = 0) {
    const s = h.stats;
    if (kind === 'flask') {
      this.projectiles.fire({ ownerId: h.id, kind, from, point: { x: target.x, z: target.z }, speed, arc: 1.2, payload: { ...pl, radius: Math.max(pl.radius ?? 0, s.aoe), fx: 'poison-small' } });
    } else if (s.pierce > 0) {
      const d = Math.hypot(target.x - from.x, target.z - from.z) || 1;
      this.projectiles.fire({
        ownerId: h.id, kind, from, speed, payload: pl,
        line: { dx: (target.x - from.x) / d, dz: (target.z - from.z) / d, length: s.range + 1, width: 0.45, maxHits: 1 + s.pierce },
      });
    } else {
      this.projectiles.fire({ ownerId: h.id, kind, from, target, speed, payload: pl, arc });
    }
  }

  #basicAttack(h, target, pos) {
    const s = h.stats;
    const t = this.types[h.type];
    const { crit, damage } = this.#roll(h);
    const from = { x: pos.x, y: 1.9, z: pos.z };
    const kind = t.attack.kind;
    if (kind === 'melee') {
      this.#melee(h, target, pos, damage, crit);
    } else {
      const projKind = { arrow: 'arrow', bolt: 'bolt', orb: 'orb', flask: 'flask' }[kind] ?? 'arrow';
      const base = this.#heroPayload(h, damage, crit, pos);
      if (kind === 'orb' || kind === 'bolt') {
        base.radius = Math.max(base.radius ?? 0, s.aoe ?? 0);
        if (base.radius) base.fx ??= kind === 'orb' ? 'arcane-small' : 'bolt';
      }
      this.#fireShot(h, projKind, target, from, base, t.attack.speed);
      // Extra projectiles go to other enemies in range (or the same one if alone).
      if (s.extraProjectiles > 0) {
        const others = [...this.zombies.inRange(pos.x, pos.z, s.range)].filter((z) => z !== target)
          .sort((p, q) => this.zombies.threatDistance(p) - this.zombies.threatDistance(q));
        for (let i = 0; i < s.extraProjectiles; i++) {
          const o = others[i] ?? target;
          const r = this.#roll(h);
          this.#fireShot(h, projKind, o, from, this.#heroPayload(h, r.damage, r.crit, pos), t.attack.speed);
        }
      }
    }
    this.events.emit('heroAttack', { hero: h, target });
  }

  /** Melee hit: direct, or a whirlwind around the target; cleave; quakes. */
  #melee(h, target, pos, damage, crit) {
    const s = h.stats;
    const pl = this.#heroPayload(h, damage, crit, pos);
    if (s.whirlwind > 0) {
      this.applyPayload(h.id, { ...pl, radius: Math.max(pl.radius ?? 0, s.whirlwind), toss: s.toss, lift: s.toss * 1.3, fx: 'wind' }, target, target.x, target.z);
    } else {
      this.applyPayload(h.id, pl, target, target.x, target.z);
    }
    if (s.cleavePct > 0) {
      for (const z of [...this.zombies.inRange(target.x, target.z, 1.3)]) {
        if (z !== target) this.zombies.damage(z, damage * s.cleavePct, h.id, { type: s.damageType, armorPen: s.armorPen });
      }
    }
    // Earthshaker: every few hits the ground erupts.
    if (s.earthshaker) {
      h.hitCount = (h.hitCount ?? 0) + 1;
      if (h.hitCount % (s.earthshaker > 1 ? 3 : 4) === 0) {
        this.applyPayload(h.id, {
          damage: damage * 2.5, type: 'physical', radius: 3.5, stun: 1, blast: 3, lift: 5, fx: 'bash', hero: h,
        }, null, target.x, target.z);
        this.events.emit('heroQuake', { hero: h, x: target.x, z: target.z });
      }
    }
    this.#afterHit(h, pl, target, target.x, target.z, null);
    this.events.emit('meleeHit', { hero: h, target, crit, holy: s.damageType === 'holy' });
  }

  /** On-hit follow-ups: chain lightning, critical cascade, bounce, split, life steal. */
  #afterHit(h, pl, zombie, x, z, p) {
    const s = h.stats;
    if (!s) return;
    const skip = [...(pl.hitIds ?? []), zombie?.id].filter(Boolean);
    if (s.lifestealPct && pl.damage) this.heroes.heal(h, pl.damage * s.lifestealPct);
    if (s.chainChance && this.rng.next() < s.chainChance) {
      const arcs = this.#nearby(x, z, HOP_RANGE, skip).slice(0, s.chainTargets);
      for (const o of arcs) this.zombies.damage(o, pl.damage * 0.5 * this.#bonusMult(h, o), h.id, { type: 'magic' });
      if (arcs.length) this.events.emit('chainLightning', { hero: h, from: { x, z }, to: arcs.map((o) => ({ x: o.x, z: o.z })) });
    }
    if (pl.crit && s.critChain) {
      const arcs = this.#nearby(x, z, HOP_RANGE, skip).slice(0, s.critChain);
      for (const o of arcs) this.zombies.damage(o, pl.damage * this.#bonusMult(h, o), h.id, { type: pl.type, crit: true });
      if (arcs.length) this.events.emit('chainLightning', { hero: h, from: { x, z }, to: arcs.map((o) => ({ x: o.x, z: o.z })), crit: true });
    }
    if (!p || this.projectiles.list.length >= PROJECTILE_CAP) return;
    const from = { x, y: 0.6, z };
    // Ricochet: hop to the nearest enemy not hit yet.
    if (pl.bounce > 0) {
      const next = this.#nearby(x, z, HOP_RANGE, skip)[0];
      if (next) {
        this.projectiles.fire({
          ownerId: p.ownerId, kind: p.kind === 'flask' ? 'orb' : p.kind, from, target: next, speed: Math.max(10, p.speed),
          payload: { ...pl, damage: pl.damage * 0.85 * (1 + (s.bounceGain ?? 0)), bounce: pl.bounce - 1, hitIds: skip, split: 0 },
        });
      }
    }
    // Split Shot: burst into shards that fly to nearby enemies.
    if (pl.split > 0) {
      const targets = this.#nearby(x, z, HOP_RANGE, skip).slice(0, pl.split);
      for (const o of targets) {
        this.projectiles.fire({
          ownerId: p.ownerId, kind: 'shard', from, target: o, speed: 14,
          payload: {
            ...pl, damage: pl.damage * 0.45, bounce: 0, hitIds: skip, radius: 0, fx: undefined,
            split: pl.splitGen > 0 ? pl.split : 0, splitGen: (pl.splitGen ?? 0) - 1,
          },
        });
      }
    }
  }

  /** On-kill effects of the hero's build. */
  #onKill(zombie, killerId) {
    const h = this.heroes.get(killerId);
    const s = h?.stats;
    if (!s || !this.cfg?.WEAPON_STYLES) return;
    const gold = (s.goldOnKill ?? 0) + ((zombie.elite || zombie.boss) ? s.eliteGold ?? 0 : 0);
    if (gold > 0) this.economy?.earn(gold, 'hero:bounty');
    if (s.healOnKillPct) this.heroes.heal(h, h.maxHp * s.healOnKillPct);
    if (this.blastDepth >= MAX_BLAST_CHAIN) return;
    this.blastDepth++;
    try {
      // Corpse Explosion (Singularity pulls instead of pushing).
      if (s.corpseBlastPct) {
        this.applyPayload(h.id, {
          damage: zombie.maxHp * s.corpseBlastPct, type: 'physical', radius: 1.7,
          blast: s.blastForce < 0 ? s.blastForce : 3, lift: s.blastForce < 0 ? 0 : 3, fx: 'explosion',
        }, null, zombie.x, zombie.z);
      }
      // Wildfire: a burning corpse sets its neighbours alight.
      if (s.burnSpread && this.zombies.time < zombie.burnUntil) {
        const dps = s.damage * Math.max(0.3, s.burnPct ?? 0);
        for (const o of [...this.zombies.inRange(zombie.x, zombie.z, 1.4 * s.burnSpread)]) {
          this.zombies.addDot(o, { dps, duration: 3, ownerId: h.id, type: 'fire' });
        }
        this.events.emit('impactFx', { x: zombie.x, z: zombie.z, radius: 1.4 * s.burnSpread, fx: 'fire' });
      }
      // Plague Bloom: a poisoned corpse bursts into a cloud.
      if (s.poisonBurst && this.zombies.time < zombie.poisonUntil) {
        this.zones.add({
          x: zombie.x, z: zombie.z, radius: 1.2 + 0.4 * s.poisonBurst, duration: 4,
          dps: s.damage * 0.35 * s.poisonBurst, type: 'poison', ownerId: h.id, kind: 'poison',
        });
      }
    } finally {
      this.blastDepth--;
    }
  }

  // --- abilities -----------------------------------------------------------
  /** Active abilities the hero can use: from its build, or (without one) its class. */
  abilityIds(h) {
    if (this.cfg?.HERO_ACTIVES) return Object.keys(h.stats?.actives ?? {});
    return Object.keys(this.types[h.type].abilities ?? {});
  }

  abilityConfig(h, id) {
    if (this.cfg?.HERO_ACTIVES) return activeConfig(this.cfg, id, h.stats?.actives?.[id] ?? 0);
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
            ownerId: h.id, kind: 'arrow', from, target: z, speed: t.attack.speed ?? 16,
            // Every arrow carries the hero's on-hit effects (bounce, split, burn...).
            payload: { ...this.#heroPayload(h, damage * a.damageMult, crit, pos), type: 'physical' },
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
            burn: { dps: a.burnDps * adm, duration: a.burnDuration }, fx: 'fire', blast: a.blast,
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
          damage: a.damage * adm, type: 'physical', radius: a.radius, stun: a.stun + (m.stunAdd ?? 0), fx: 'bash', blast: a.blast,
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
            radius: this.abilityRadius(h, id), fx: 'explosion', blast: a.blast,
          },
        });
        break;
      case 'shockwave':
        // Everything around the hero is launched away from it and lands far off.
        this.applyPayload(h.id, {
          damage: a.damage * adm, type: 'physical', radius: a.radius, blast: a.blast, lift: a.lift, fx: 'bash', hero: h,
        }, null, pos.x, pos.z);
        break;
      case 'hurricane':
        // Thrown back toward where they came from (away from the gate).
        this.applyPayload(h.id, {
          damage: a.damage * adm, type: 'magic', radius: a.radius, toss: a.toss, lift: a.lift, fx: 'wind', hero: h,
        }, null, pos.x, pos.z);
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
