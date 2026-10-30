// Zombies walk the roads to the house. Each zombie follows one road path by distance `s`
// along it, at its own lane offset left or right of the centre line, so a horde spreads
// across the road. At the end of the road it bursts into the house: one blow (its `damage`)
// and it is gone, without a bounty. The house is the player's lives.
//
// Special behaviour: Tower Smashers stop beside towers near the road and smash them (ammo
// spills, the tower jams); Plague Carriers die in a toxic cloud; bosses summon or empower.
// Physics: the Gale tower and rolling stones shove zombies back down the road (velocity
// along the path) or throw them into the air; a high fall hurts.
import { pointAt } from './paths.js';

export const ZSTATE = { MOVE: 'move', ATTACK_HOUSE: 'attackHouse', ATTACK_TOWER: 'attackTower', DEAD: 'dead' };

/** Seconds a dead zombie stays around for its death animation before removal. */
const CORPSE_TIME = 1.6;
/** Seconds between damage-over-time ticks. */
const DOT_TICK = 0.5;
/** Below this speed along the road a shove is over. */
const SETTLE = 0.25;
/** Seconds a zombie at the door winds up before it breaks in. */
const LEAK_WINDUP = 0.6;

export class ZombieSystem {
  #nextId = 1;

  /** @param {{paths, house, economy, events, rng, types, elite?, physics, laneHalfWidth, speedMult?, spawnS?}} deps */
  constructor({ paths, house, economy, events, rng, types, elite = null, physics, laneHalfWidth = 0.45, speedMult = 1, spawnS = 0 }) {
    Object.assign(this, { paths, house, economy, events, rng, types, elite, physics, laneHalfWidth, speedMult, spawnS });
    /** All zombies including dying ones (state DEAD) until their corpse time ends. */
    this.list = [];
    this.killCount = 0;
    this.time = 0;
    /** Wave damage multiplier applied to newly spawned zombies (set by the wave system). */
    this.damageMultiplier = 1;
    /** Set by the simulation: the tower system (for Tower Smashers). */
    this.towers = null;
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.list) if (z.alive) n++;
    return n;
  }

  /** Living bosses (for the HUD boss bar). */
  get bosses() {
    return this.list.filter((z) => z.alive && z.boss);
  }

  /** Road left to the house (lower = more dangerous). */
  threatDistance(z) {
    return z.path.length - z.s;
  }

  /**
   * @param {string} typeKey
   * @param {number} pathId road index
   * @param {number} hpMultiplier wave scaling
   * @param {{elite?: boolean, rewardMult?: number, s?: number, lane?: number}} [opts]
   */
  spawn(typeKey, pathId, hpMultiplier = 1, { elite = false, rewardMult = 1, s = this.spawnS, lane } = {}) {
    const t = this.types[typeKey];
    const path = this.paths[pathId] ?? this.paths[0];
    const e = elite && this.elite ? this.elite : null;
    const hp = Math.round(t.hp * hpMultiplier * (e ? e.hpMult : 1));
    const L = this.laneHalfWidth;
    const zb = {
      id: this.#nextId++,
      type: typeKey,
      boss: !!t.boss,
      elite: !!e,
      path, pathId: path.id ?? pathId,
      s,
      lane: lane ?? (t.boss ? 0 : this.rng.range(-L, L)),
      /** Where along the road it stops to hit the house (a crowd does not stack on one spot). */
      endS: path.length - (t.boss ? 0 : this.rng.range(0, 0.7)),
      x: 0, z: 0,
      hp, maxHp: hp, hpMult: hpMultiplier,
      armor: t.armor,
      resist: t.resist ?? 0,
      speed: t.speed * this.speedMult * this.rng.range(0.9, 1.1),
      damage: t.damage * this.damageMultiplier * (e ? e.damageMult : 1),
      attackInterval: t.attackInterval,
      attackTimer: this.rng.range(0, t.attackInterval),
      reward: Math.max(1, Math.round(t.reward * (e ? e.rewardMult : 1) * rewardMult)),
      xp: t.xp * (e ? e.xpMult : 1) * rewardMult,
      scale: (t.scale ?? 1) * (e ? e.scaleMult : 1),
      alive: true,
      state: ZSTATE.MOVE,
      slowUntil: 0, slowFactor: 1,
      stunUntil: 0,
      empoweredUntil: 0, empowerSpeed: 1, empowerDamage: 1,
      shredUntil: 0, shred: 0,
      /** Damage-over-time effects: {dps, until, ownerId, type, timer}. */
      dots: [],
      facing: 0,
      animTime: this.rng.range(0, 2),
      deadTime: 0,
      abilityTimer: t.summon?.interval ?? t.empower?.interval ?? 0,
      /** Physics: speed along the road (negative = shoved back), height and vertical speed. */
      vs: 0, vy: 0, air: 0, peak: 0, shoveStacks: 0,
      burnUntil: 0, poisonUntil: 0,
      /** Tower Smashers: the tower being smashed, hits on it, towers already smashed. */
      smashTarget: 0, smashHits: 0, smashed: null,
      enraged: false,
      /** Traits (see config/enemies.js): stealth until revealed, regeneration timer. */
      stealth: !!t.stealth, revealedUntil: 0, markedUntil: 0, markPct: 0,
      lastHurt: 0,
    };
    this.#place(zb);
    this.list.push(zb);
    this.events.emit('zombieSpawned', zb);
    if (zb.boss) this.events.emit('bossSpawned', zb);
    return zb;
  }

  #place(z) {
    const p = pointAt(z.path, z.s);
    z.x = p.x - p.dz * z.lane;
    z.z = p.z + p.dx * z.lane;
    return p;
  }

  /**
   * Deals damage after mitigation: physical is reduced by armor (minus armor penetration and
   * shred), magic and fire by resist; poison and true damage ignore both. Death happens once.
   * @returns {number} damage dealt
   */
  damage(z, amount, sourceId = 0, { type = 'physical', armorPen = 0, crit = false, dot = false, tags = null } = {}) {
    if (!z.alive || !(amount > 0)) return 0;
    if (this.isImmune(z, type, tags)) return 0;
    let mult = 1;
    // Hunter's Mark (Watchtower): marked enemies take more from everything.
    if (this.time < z.markedUntil) mult *= 1 + z.markPct / 100;
    const armor = this.time < z.shredUntil ? z.armor * (1 - z.shred) : z.armor;
    if (type === 'physical') mult = 1 - Math.max(0, armor - armorPen);
    else if (type === 'magic' || type === 'fire') mult = 1 - z.resist;
    const dealt = Math.min(z.hp, Math.max(1, amount * mult));
    z.hp -= dealt;
    z.lastHurt = this.time;
    this.events.emit('zombieDamaged', { zombie: z, amount: dealt, crit, dot, type, sourceId });
    if (z.hp <= 0) this.#kill(z, sourceId);
    return dealt;
  }

  #kill(z, killerId) {
    z.alive = false; // set first: nothing below can run twice for this zombie
    z.hp = 0;
    z.state = ZSTATE.DEAD;
    z.deadTime = 0;
    z.dots.length = 0;
    this.killCount++;
    this.economy.earn(z.reward, `kill:${z.type}`);
    this.events.emit('zombieKilled', { zombie: z, killerId });
    const cloud = this.types[z.type].cloud;
    if (cloud) this.events.emit('plagueCloud', { x: z.x, z: z.z, ...cloud });
  }

  /** A zombie that reached the house: it hurts the house and is gone (no gold, no XP). */
  #leak(z, mult) {
    z.alive = false;
    z.hp = 0;
    z.state = ZSTATE.DEAD;
    z.deadTime = 0;
    z.dots.length = 0;
    this.events.emit('zombieAttack', { zombie: z, house: true });
    this.events.emit('zombieLeaked', { zombie: z, damage: z.damage * mult });
    this.house.damage(z.damage * mult, z);
  }

  /** Slows movement to `factor` of normal speed; the strongest active slow wins. */
  applySlow(z, factor, duration) {
    if (!z.alive) return;
    if (z.boss) factor = 1 - (1 - factor) / 2; // bosses shrug off half of any slow
    if (this.time >= z.slowUntil || factor <= z.slowFactor) z.slowFactor = factor;
    z.slowUntil = Math.max(z.slowUntil, this.time + duration);
  }

  /** Stunned zombies neither move nor attack. Bosses are stunned for a third as long. */
  applyStun(z, duration) {
    if (!z.alive) return;
    if (z.boss) duration /= 3;
    z.stunUntil = Math.max(z.stunUntil, this.time + duration);
    this.events.emit('zombieStunned', { zombie: z, duration });
  }

  /** Strips a fraction of the armor for a while. */
  applyShred(z, amount, duration) {
    if (!z.alive) return;
    z.shred = Math.max(this.time < z.shredUntil ? z.shred : 0, amount);
    z.shredUntil = Math.max(z.shredUntil, this.time + duration);
  }

  /** Adds damage over time. Re-applying the same type from the same source refreshes it. */
  addDot(z, { dps, duration, ownerId = 0, type = 'poison' }) {
    if (!z.alive || !(dps > 0)) return;
    const existing = z.dots.find((d) => d.ownerId === ownerId && d.type === type);
    if (existing) {
      existing.dps = Math.max(existing.dps, dps);
      existing.until = Math.max(existing.until, this.time + duration);
    } else {
      z.dots.push({ dps, until: this.time + duration, ownerId, type, timer: DOT_TICK });
    }
    if (type === 'fire') z.burnUntil = Math.max(z.burnUntil, this.time + duration);
    if (type === 'poison') z.poisonUntil = Math.max(z.poisonUntil, this.time + duration);
  }

  /**
   * Shoves a zombie back down the road by `force` (cells/s) and/or throws it up with `lift`
   * (upward speed). Bosses and elites resist; repeated shoves weaken; enraged ones ignore it.
   */
  push(z, force, lift = 0) {
    if (!z.alive || z.enraged || !(force > 0 || lift > 0)) return;
    const P = this.physics;
    const k = (z.boss ? P.bossResist : z.elite ? P.eliteResist : 1) / (1 + z.shoveStacks * P.shoveResist);
    z.shoveStacks++;
    z.vs = Math.min(z.vs, -force * k);
    if (lift > 0) z.vy = Math.max(z.vy, lift * k);
    if (z.state === ZSTATE.ATTACK_TOWER) z.smashTarget = 0;
    this.events.emit('zombiePushed', { zombie: z, force, lift });
  }

  /** True while flying or sliding back from a shove (it cannot act). */
  isTumbling(z) {
    return z.air > 0 || z.vy > 0 || Math.abs(z.vs) > SETTLE;
  }

  #stepPhysics(z, dt) {
    const P = this.physics;
    z.s = Math.max(0, z.s + z.vs * dt);
    z.vs *= Math.exp(-P.friction * dt);
    if (Math.abs(z.vs) <= SETTLE) z.vs = 0;
    if (z.air > 0 || z.vy > 0) {
      z.vy -= P.gravity * dt;
      z.air = Math.max(0, z.air + z.vy * dt);
      z.peak = Math.max(z.peak, z.air);
      if (z.air === 0 && z.vy < 0) {
        if (z.peak >= 1) this.damage(z, z.maxHp * P.fallDamagePct * z.peak, 0, { type: 'physical', dot: true });
        this.events.emit('zombieLanded', { zombie: z, height: z.peak });
        z.vy = 0; z.peak = 0;
      }
    }
    z.state = ZSTATE.MOVE;
    this.#place(z);
  }

  #stepDots(z, dt) {
    for (let i = z.dots.length - 1; i >= 0 && z.alive; i--) {
      const d = z.dots[i];
      d.timer -= dt;
      if (d.timer <= 0) {
        d.timer += DOT_TICK;
        this.damage(z, d.dps * DOT_TICK, d.ownerId, { type: d.type, dot: true });
      }
      if (this.time >= d.until) z.dots.splice(i, 1);
    }
  }

  step(dt) {
    this.time += dt;
    let write = 0;
    // Iterate a snapshot length: summons appended during the loop act from next step.
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const z = this.list[i];
      z.animTime += dt;
      if (!z.alive) {
        z.deadTime += dt;
        if (z.deadTime < CORPSE_TIME) this.list[write++] = z;
        continue;
      }
      if (z.dots.length) this.#stepDots(z, dt);
      // Rotters grow back when left alone (poison stops it).
      const regen = this.types[z.type].regen;
      if (regen && z.alive && z.hp < z.maxHp && this.time - z.lastHurt >= regen.delay && this.time >= z.poisonUntil) {
        z.hp = Math.min(z.maxHp, z.hp + z.maxHp * regen.pct * dt);
      }
      if (z.shoveStacks) z.shoveStacks = Math.max(0, z.shoveStacks - dt * this.physics.shoveRecovery);
      if (z.alive) {
        if (this.isTumbling(z)) this.#stepPhysics(z, dt);
        else if (this.time >= z.stunUntil) {
          if (z.boss) this.#bossAbilities(z, dt);
          this.#stepZombie(z, dt);
        }
      }
      this.list[write++] = z;
    }
    for (let i = n; i < this.list.length; i++) this.list[write++] = this.list[i];
    this.list.length = write;
  }

  #speed(z) {
    let speed = z.speed;
    if (this.time < z.slowUntil) speed *= z.slowFactor;
    if (this.time < z.empoweredUntil) speed *= z.empowerSpeed;
    return speed;
  }

  #stepZombie(z, dt) {
    const t = this.types[z.type];
    const empowered = this.time < z.empoweredUntil;
    // Tower Smashers stop beside towers near the road.
    if (t.smasher && this.towers) {
      if (this.#stepSmasher(z, t.smasher, dt, empowered)) return;
    }
    if (z.s >= z.endS) {
      // Wind up one blow at the door, then break in.
      if (z.state !== ZSTATE.ATTACK_HOUSE) { z.state = ZSTATE.ATTACK_HOUSE; z.attackTimer = LEAK_WINDUP; z.animTime = 0; }
      const p = this.#place(z);
      z.facing = Math.atan2(p.dx, p.dz);
      z.attackTimer -= dt;
      if (z.attackTimer <= 0) this.#leak(z, empowered ? z.empowerDamage : 1);
      return;
    }
    z.state = ZSTATE.MOVE;
    z.s = Math.min(z.endS, z.s + this.#speed(z) * dt);
    const p = this.#place(z);
    z.facing = Math.atan2(p.dx, p.dz);
  }

  /** Returns true while the smasher is busy with a tower. */
  #stepSmasher(z, cfg, dt, empowered) {
    let tower = z.smashTarget ? this.towers.get(z.smashTarget) : null;
    if (!tower) {
      z.smashTarget = 0;
      z.smashed ??= new Set();
      let best = null, bestD = cfg.range;
      for (const tw of this.towers.all()) {
        if (z.smashed.has(tw.id)) continue;
        const d = Math.hypot(tw.cx - z.x, tw.cz - z.z);
        if (d <= bestD) { bestD = d; best = tw; }
      }
      if (!best) return false;
      tower = best;
      z.smashTarget = best.id;
      z.smashHits = 0;
    }
    z.state = ZSTATE.ATTACK_TOWER;
    z.facing = Math.atan2(tower.cx - z.x, tower.cz - z.z);
    z.attackTimer -= dt;
    if (z.attackTimer <= 0) {
      z.attackTimer += z.attackInterval;
      this.towers.smash(tower.id, cfg, z, empowered ? z.empowerDamage : 1);
      this.events.emit('zombieAttack', { zombie: z, towerId: tower.id });
      if (++z.smashHits >= cfg.hits) {
        z.smashed.add(tower.id);
        z.smashTarget = 0;
      }
    }
    return true;
  }

  #bossAbilities(z, dt) {
    const t = this.types[z.type];
    if (!t.summon && !t.empower) return;
    z.abilityTimer -= dt;
    if (z.abilityTimer > 0) return;
    if (t.summon) {
      z.abilityTimer = t.summon.interval;
      for (let k = 0; k < t.summon.count; k++) {
        this.spawn(t.summon.type, z.pathId, z.hpMult, { s: Math.max(0, z.s - 0.3 - k * 0.25) });
      }
      this.events.emit('bossAbility', { zombie: z, kind: 'summon', radius: 1.5 });
    } else {
      const e = t.empower;
      z.abilityTimer = e.interval;
      for (const o of this.inRange(z.x, z.z, e.radius)) {
        if (o === z) continue;
        o.empoweredUntil = this.time + e.duration;
        o.empowerSpeed = e.speedMult;
        o.empowerDamage = e.damageMult;
      }
      this.events.emit('bossAbility', { zombie: z, kind: 'empower', radius: e.radius });
    }
  }

  /** Alive zombies within `range` of (x, z). */
  /** True when hits of this damage type (or with one of these tags) do nothing to it. */
  isImmune(z, type, tags) {
    const t = this.types[z.type];
    if (t.immune?.includes(type)) return true;
    return !!(tags && t.immuneTags?.some((x) => tags.includes(x)));
  }

  /** True when a tower without detection can see it (not stealthy, or revealed right now). */
  isVisible(z) {
    return !z.stealth || this.time < z.revealedUntil;
  }

  /** A Watchtower lights it up for `seconds` (and may mark it to take more damage). */
  reveal(z, seconds, markPct = 0) {
    z.revealedUntil = Math.max(z.revealedUntil, this.time + seconds);
    if (markPct) { z.markedUntil = this.time + seconds; z.markPct = Math.max(z.markPct, markPct); }
  }

  *inRange(x, z, range) {
    const r2 = range * range;
    for (const zb of this.list) {
      if (!zb.alive) continue;
      const dx = zb.x - x, dz = zb.z - z;
      if (dx * dx + dz * dz <= r2) yield zb;
    }
  }

  clear() {
    this.list.length = 0;
  }
}
