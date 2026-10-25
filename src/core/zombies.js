// Zombie state, movement, attacks and special behaviour. Zombies route with flow fields
// (Dijkstra from the gate over a zombie cost function) shared by everyone using the same
// routing profile:
//   default - walls are expensive, so the horde goes around short walls and breaks
//             through a closed line at its cheapest point;
//   siege   - walls are cheap, so siege zombies bulldoze the direct line to the gate;
//   charge  - wall cost follows remaining health, so the Gravelord heads for weak walls.
// Fields are recomputed when walls are added or removed (and periodically for 'charge').
// Each step a zombie looks at the next cell on its field: an open cell -> walk to it; a
// wall -> stop and hit that wall; the gate -> stop and hit the gate.
import { computeFlowField } from './pathfinding.js';

export const ZSTATE = { MOVE: 'move', ATTACK_WALL: 'attackWall', ATTACK_GATE: 'attackGate', DEAD: 'dead' };

/** Seconds a dead zombie stays around for its death animation before removal. */
const CORPSE_TIME = 1.6;
/** Max random offset from cell centres so a horde does not walk in single file. */
const SPREAD = 0.28;
/** How far into its own cell a zombie stands when hitting the neighbouring wall/gate. */
const STRIKE_REACH = 0.32;
/** Seconds between damage-over-time ticks. */
const DOT_TICK = 0.5;
/** Seconds between recomputing health-dependent ('charge') fields while needed. */
const CHARGE_REFRESH = 2;

export class ZombieSystem {
  #nextId = 1;

  /**
   * @param {{grid, walls, fortress, economy, events, rng, types, pathing, elite?}} deps
   */
  constructor({ grid, walls, fortress, economy, events, rng, types, pathing, elite = null }) {
    Object.assign(this, { grid, walls, fortress, economy, events, rng, types, pathing, elite });
    /** All zombies including dying ones (state DEAD) until their corpse time ends. */
    this.list = [];
    /** Alive zombie count per cell, refreshed every step (for placement checks). */
    this.cellCount = new Uint16Array(grid.width * grid.height);
    /** profile -> {dist, next}; dirty profiles are recomputed lazily. */
    this.fields = {};
    this.dirty = new Set(['default', 'siege', 'charge']);
    this.chargeTimer = 0;
    this.killCount = 0;
    this.time = 0;
    /** Wave damage multiplier applied to newly spawned zombies (set by the wave system). */
    this.damageMultiplier = 1;
    const invalidate = () => { this.dirty.add('default'); this.dirty.add('siege'); this.dirty.add('charge'); };
    events.on('wallAdded', invalidate);
    events.on('wallRemoved', invalidate);
  }

  /** The default field (kept as a property for callers that only need the horde route). */
  get field() {
    return this.#getField('default');
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

  #costFn(profile) {
    const g = this.grid, walls = this.walls;
    const p = profile === 'siege' ? this.types.siege.siege
      : profile === 'charge' ? this.types.gravelord.charge : this.pathing;
    return (x, y) => {
      if (!g.isWalkableTerrain(x, y)) return Infinity;
      const w = walls.at(x, y);
      if (!w) return 1;
      return 1 + p.wallBaseCost + w.hp * p.wallCostPerHp;
    };
  }

  #getField(profile) {
    if (this.dirty.has(profile) || !this.fields[profile]) {
      const cost = this.#costFn(profile);
      this.fields[profile] = computeFlowField(this.grid, [this.fortress.gate], {
        cost, isOpen: (x, y) => cost(x, y) === 1,
      });
      this.dirty.delete(profile);
    }
    return this.fields[profile];
  }

  /** Path distance from a zombie to the gate on the horde route (lower = more dangerous). */
  threatDistance(z) {
    return this.field.dist[this.grid.index(Math.floor(z.x), Math.floor(z.z))];
  }

  /**
   * @param {string} typeKey
   * @param {number} x world x
   * @param {number} z world z
   * @param {number} hpMultiplier wave scaling
   * @param {{elite?: boolean}} [opts]
   */
  spawn(typeKey, x, z, hpMultiplier = 1, { elite = false } = {}) {
    const t = this.types[typeKey];
    const e = elite && this.elite ? this.elite : null;
    const hp = Math.round(t.hp * hpMultiplier * (e ? e.hpMult : 1));
    const dmg = t.wallDamage * this.damageMultiplier * (e ? e.damageMult : 1);
    const zb = {
      id: this.#nextId++,
      type: typeKey,
      boss: !!t.boss,
      elite: !!e,
      x, z,
      hp, maxHp: hp,
      armor: t.armor,
      resist: t.resist ?? 0,
      speed: t.speed * this.rng.range(0.9, 1.1),
      wallDamage: dmg,
      attackInterval: t.attackInterval,
      attackTimer: this.rng.range(0, t.attackInterval),
      reward: Math.round(t.reward * (e ? e.rewardMult : 1)),
      xp: t.xp * (e ? e.xpMult : 1),
      scale: (t.scale ?? 1) * (e ? e.scaleMult : 1),
      profile: t.siege ? 'siege' : t.charge ? 'charge' : 'default',
      alive: true,
      state: ZSTATE.MOVE,
      targetWallId: 0,
      slowUntil: 0, slowFactor: 1,
      stunUntil: 0,
      empoweredUntil: 0, empowerSpeed: 1, empowerDamage: 1,
      /** Damage-over-time effects: {dps, until, ownerId, type, timer}. */
      dots: [],
      // Per-zombie offset from cell centres, so groups spread out (bosses walk centred).
      ox: t.boss ? 0 : this.rng.range(-SPREAD, SPREAD),
      oz: t.boss ? 0 : this.rng.range(-SPREAD, SPREAD),
      facing: 0,
      animTime: this.rng.range(0, 2),
      deadTime: 0,
      abilityTimer: t.summon?.interval ?? t.empower?.interval ?? 0,
      /** heroId -> damage dealt, for sharing XP on death. */
      contributors: new Map(),
    };
    this.list.push(zb);
    this.events.emit('zombieSpawned', zb);
    if (zb.boss) this.events.emit('bossSpawned', zb);
    return zb;
  }

  /**
   * Deals damage after mitigation: physical is reduced by armor (minus armor penetration),
   * magic and fire by resist; holy and poison ignore both. Death, gold and XP happen once.
   * @param {{type?: 'physical'|'magic'|'holy'|'poison'|'fire', armorPen?: number, crit?: boolean, dot?: boolean}} opts
   * @returns {number} damage dealt
   */
  damage(z, amount, sourceHeroId = 0, { type = 'physical', armorPen = 0, crit = false, dot = false } = {}) {
    if (!z.alive || !(amount > 0)) return 0;
    let mult = 1;
    if (type === 'physical') mult = 1 - Math.max(0, z.armor - armorPen);
    else if (type === 'magic' || type === 'fire') mult = 1 - z.resist;
    const dealt = Math.min(z.hp, Math.max(1, amount * mult));
    z.hp -= dealt;
    if (sourceHeroId) z.contributors.set(sourceHeroId, (z.contributors.get(sourceHeroId) ?? 0) + dealt);
    this.events.emit('zombieDamaged', { zombie: z, amount: dealt, crit, dot, type, sourceHeroId });
    if (z.hp <= 0) this.#kill(z, sourceHeroId);
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
  }

  /** Slows movement to `factor` of normal speed; the strongest active slow wins. */
  applySlow(z, factor, duration) {
    if (!z.alive) return;
    // Bosses shrug off half of any slow.
    if (z.boss) factor = 1 - (1 - factor) / 2;
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

  /** Adds damage over time. Re-applying the same type from the same hero refreshes it. */
  addDot(z, { dps, duration, ownerId = 0, type = 'poison' }) {
    if (!z.alive || !(dps > 0)) return;
    const existing = z.dots.find((d) => d.ownerId === ownerId && d.type === type);
    if (existing) {
      existing.dps = Math.max(existing.dps, dps);
      existing.until = Math.max(existing.until, this.time + duration);
      return;
    }
    z.dots.push({ dps, until: this.time + duration, ownerId, type, timer: DOT_TICK });
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
    if (this.list.some((z) => z.alive && z.profile === 'charge')) {
      this.chargeTimer -= dt;
      if (this.chargeTimer <= 0) { this.chargeTimer = CHARGE_REFRESH; this.dirty.add('charge'); }
    }
    const g = this.grid;
    this.cellCount.fill(0);
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
      if (!z.alive) { this.list[write++] = z; continue; }
      if (this.time >= z.stunUntil) {
        if (z.boss) this.#bossAbilities(z, dt);
        this.#stepZombie(z, dt);
      }
      const cx = Math.floor(z.x), cy = Math.floor(z.z);
      if (g.inBounds(cx, cy)) this.cellCount[g.index(cx, cy)]++;
      this.list[write++] = z;
    }
    for (let i = n; i < this.list.length; i++) this.list[write++] = this.list[i];
    this.list.length = write;
  }

  #bossAbilities(z, dt) {
    const t = this.types[z.type];
    if (!t.summon && !t.empower) return;
    z.abilityTimer -= dt;
    if (z.abilityTimer > 0) return;
    if (t.summon) {
      z.abilityTimer = t.summon.interval;
      for (let k = 0; k < t.summon.count; k++) {
        const a = (k / t.summon.count) * Math.PI * 2;
        const at = this.nearestOpen(z.x + Math.cos(a) * 0.8, z.z + Math.sin(a) * 0.8 - 0.3);
        this.spawn(t.summon.type, at.x, at.z, 1);
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

  #stepZombie(z, dt) {
    const g = this.grid;
    const field = this.#getField(z.profile);
    const cx = Math.floor(z.x), cy = Math.floor(z.z);
    if (!g.inBounds(cx, cy)) return;
    const here = g.index(cx, cy);
    const next = field.next[here];
    if (next < 0 || !g.isWalkableTerrain(cx, cy) || g.wallAt(cx, cy)) {
      // Never stay stuck: anything that ends up in a rock, a wall or an unreachable cell
      // walks to the neighbouring cell with the best route to the gate.
      const out = this.#escapeCell(field, cx, cy);
      if (out) { z.state = ZSTATE.MOVE; this.#moveToward(z, out.x + 0.5, out.y + 0.5, dt); }
      return;
    }
    const nx = next % g.width, ny = (next / g.width) | 0;
    const gate = this.fortress.gate;
    const isGate = nx === gate.x && ny === gate.y;
    const wallId = isGate ? 0 : g.wallAt(nx, ny);
    const empowered = this.time < z.empoweredUntil;

    if (isGate || wallId) {
      // Close in on the shared edge, then strike on the attack timer.
      const tx = cx + 0.5 + (nx - cx) * STRIKE_REACH + z.ox * 0.5;
      const tz = cy + 0.5 + (ny - cy) * STRIKE_REACH + z.oz * 0.3;
      const arrived = this.#moveToward(z, tx, tz, dt);
      z.facing = Math.atan2(nx - cx, ny - cy);
      z.state = isGate ? ZSTATE.ATTACK_GATE : ZSTATE.ATTACK_WALL;
      z.targetWallId = wallId;
      if (!arrived) return;
      z.attackTimer -= dt;
      if (z.attackTimer <= 0) {
        z.attackTimer += z.attackInterval;
        const dmg = z.wallDamage * (empowered ? z.empowerDamage : 1);
        if (isGate) this.fortress.damage(dmg, z);
        else this.#hitWall(z, wallId, dmg, cx, cy);
        this.events.emit('zombieAttack', { zombie: z, gate: isGate, wallId, x: nx, y: ny });
      }
      return;
    }
    z.state = ZSTATE.MOVE;
    z.targetWallId = 0;
    this.#moveToward(z, nx + 0.5 + z.ox, ny + 0.5 + z.oz, dt);
  }

  /** Neighbouring open cell with the smallest distance to the gate, or null. */
  #escapeCell(field, cx, cy) {
    const g = this.grid;
    let best = null, bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if ((!dx && !dy) || !g.inBounds(x, y) || !g.isWalkableTerrain(x, y) || g.wallAt(x, y)) continue;
        const d = field.dist[g.index(x, y)];
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    return best;
  }

  /** Nearest walkable, wall-free cell centre to (x, z) (spirals outward). */
  nearestOpen(x, z) {
    const g = this.grid;
    const cx = Math.floor(x), cy = Math.floor(z);
    for (let r = 0; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx, ny = cy + dy;
          if (g.inBounds(nx, ny) && g.isWalkableTerrain(nx, ny) && !g.wallAt(nx, ny)) {
            return r === 0 ? { x, z } : { x: nx + 0.5, z: ny + 0.5 };
          }
        }
      }
    }
    return { x, z };
  }

  #hitWall(z, wallId, dmg, cx, cy) {
    const t = this.types[z.type];
    const wall = this.walls.get(wallId);
    if (t.siege && wall?.type === 'reinforced') dmg *= t.siege.reinforcedBonus;
    const { x, y } = wall;
    this.walls.damage(wallId, dmg, z);
    if (t.smashSplash) {
      // Sweeping blow: also hits the wall's neighbours (not back toward the boss).
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (x + dx === cx && y + dy === cy) continue;
        const n = this.walls.at(x + dx, y + dy);
        if (n) this.walls.damage(n.id, dmg * t.smashSplash, z);
      }
    }
  }

  /** Moves toward (tx, tz); returns true when there. Updates facing while moving. */
  #moveToward(z, tx, tz, dt) {
    const dx = tx - z.x, dz = tz - z.z;
    const d = Math.hypot(dx, dz);
    const t = this.types[z.type];
    let speed = z.speed;
    if (this.time < z.slowUntil) speed *= z.slowFactor;
    if (this.time < z.empoweredUntil) speed *= z.empowerSpeed;
    if (t.charge) speed *= t.charge.speedMult;
    const stepLen = speed * dt;
    if (d <= stepLen || d < 1e-4) {
      z.x = tx; z.z = tz;
      return true;
    }
    z.x += (dx / d) * stepLen;
    z.z += (dz / d) * stepLen;
    z.facing = Math.atan2(dx, dz);
    return false;
  }

  /** Alive zombies within `range` of (x, z). */
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
    this.cellCount.fill(0);
    this.dirty = new Set(['default', 'siege', 'charge']);
  }
}
