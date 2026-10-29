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
//
// Physics: hits can shove zombies (push) or launch them into the air. A shoved or flying
// zombie neither walks nor attacks until it lands and slows down; flying ones sail over
// walls, sliding ones bounce off walls and rocks. Zombies also push each other apart so a
// horde never fully overlaps.
import { computeFlowField } from './pathfinding.js';

export const ZSTATE = { MOVE: 'move', ATTACK_WALL: 'attackWall', ATTACK_GATE: 'attackGate', DEAD: 'dead' };

/** Seconds a dead zombie stays around for its death animation before removal. */
const CORPSE_TIME = 1.6;
/** Max random offset from cell centres so a horde does not walk in single file. */
const SPREAD = 0.28;
/** How far into its own cell a zombie stands when hitting the neighbouring wall/gate. */
const STRIKE_REACH = 0.32;
/** How far from its strike point a zombie may stand and still hit (crowds jostle). */
const STRIKE_TOLERANCE = 0.45;
/** Seconds between damage-over-time ticks. */
const DOT_TICK = 0.5;
/** Seconds between recomputing health-dependent ('charge') fields while needed. */
const CHARGE_REFRESH = 2;

export class ZombieSystem {
  #nextId = 1;

  /**
   * @param {{grid, walls, fortress, economy, events, rng, types, pathing, elite?}} deps
   */
  constructor({ grid, walls, fortress, economy, events, rng, types, pathing, elite = null, physics = null }) {
    Object.assign(this, { grid, walls, fortress, economy, events, rng, types, pathing, elite });
    this.physics = physics ?? { gravity: 22, friction: 6, settleSpeed: 0.4, bossResist: 0.2, eliteResist: 0.6, maxSpeed: 14, fallDamagePct: 0.04 };
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
   * @param {{elite?: boolean, rewardMult?: number}} [opts] rewardMult scales gold and XP (wave variants)
   */
  spawn(typeKey, x, z, hpMultiplier = 1, { elite = false, rewardMult = 1 } = {}) {
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
      reward: Math.max(1, Math.round(t.reward * (e ? e.rewardMult : 1) * rewardMult)),
      xp: t.xp * (e ? e.xpMult : 1) * rewardMult,
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
      /** Physics: velocity (cells/s), height above ground and its vertical speed. */
      vx: 0, vz: 0, vy: 0, air: 0, peak: 0,
      /** Collision radius (cells). */
      radius: 0.2 * (t.scale ?? 1) * (e ? e.scaleMult : 1),
      /** Until when the zombie is burning / poisoned (on-death effects read these). */
      burnUntil: 0, poisonUntil: 0,
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
    if (type === 'fire') z.burnUntil = Math.max(z.burnUntil, this.time + duration);
    if (type === 'poison') z.poisonUntil = Math.max(z.poisonUntil, this.time + duration);
  }

  /**
   * Shoves a zombie: horizontal impulse (dx, dz) normalised times `force`, plus `lift`
   * (upward speed) to launch it. Bosses and elites resist.
   */
  push(z, dx, dz, force, lift = 0) {
    if (!z.alive || z.enraged || !(Math.abs(force) > 0 || lift > 0)) return;
    const P = this.physics;
    // Repeated shoves weaken fast (resistance stacks and fades), so knockback can never pin
    // a zombie in place forever.
    const k = (z.boss ? P.bossResist : z.elite ? P.eliteResist : 1) / (1 + (z.shoveStacks ?? 0) * (P.shoveResist ?? 0.6));
    z.shoveStacks = (z.shoveStacks ?? 0) + 1;
    const d = Math.hypot(dx, dz) || 1;
    z.vx += (dx / d) * force * k;
    z.vz += (dz / d) * force * k;
    const sp = Math.hypot(z.vx, z.vz);
    if (sp > P.maxSpeed) { z.vx *= P.maxSpeed / sp; z.vz *= P.maxSpeed / sp; }
    if (lift > 0) z.vy = Math.max(z.vy, lift * k);
    this.events.emit('zombiePushed', { zombie: z, force, lift });
  }

  /** True while the zombie is flying or sliding from a shove (it cannot act). */
  isTumbling(z) {
    return z.air > 0 || z.vy > 0 || Math.hypot(z.vx, z.vz) > this.physics.settleSpeed;
  }

  #stepPhysics(z, dt) {
    const P = this.physics, g = this.grid;
    const nx = z.x + z.vx * dt, nz = z.z + z.vz * dt;
    if (z.air > 0 || z.vy > 0) {
      // Flying: sails over walls; stays inside the map.
      z.x = Math.min(g.width - 0.2, Math.max(0.2, nx));
      z.z = Math.min(g.height - 0.2, Math.max(0.2, nz));
      z.vy -= P.gravity * dt;
      z.air = Math.max(0, z.air + z.vy * dt);
      z.peak = Math.max(z.peak, z.air);
      if (z.air === 0 && z.vy < 0) {
        // Landed: a high fall hurts.
        if (z.peak >= 1) this.damage(z, z.maxHp * P.fallDamagePct * z.peak, 0, { type: 'physical', dot: true });
        this.events.emit('zombieLanded', { zombie: z, height: z.peak });
        z.vy = 0; z.peak = 0;
        z.vx *= 0.5; z.vz *= 0.5;
        // Landing on a wall, a rock or inside the castle: tumble off to the nearest open ground.
        if (!this.#canStand(z.x, z.z)) { const o = this.nearestOpen(z.x, z.z); z.x = o.x; z.z = o.z; z.vx = 0; z.vz = 0; }
      }
    } else {
      // Sliding along the ground: bounces off walls, rocks and the map edge.
      const cx = Math.floor(nx), cy = Math.floor(nz);
      const blocked = !g.inBounds(cx, cy) || !g.isWalkableTerrain(cx, cy) || g.wallAt(cx, cy);
      if (blocked && !(Math.floor(z.x) === cx && Math.floor(z.z) === cy)) {
        if (Math.floor(nx) !== Math.floor(z.x)) z.vx = -z.vx * 0.4;
        if (Math.floor(nz) !== Math.floor(z.z)) z.vz = -z.vz * 0.4;
      } else {
        z.x = nx; z.z = nz;
      }
      z.vy = 0;
      const f = Math.exp(-P.friction * dt);
      z.vx *= f; z.vz *= f;
      if (Math.hypot(z.vx, z.vz) <= P.settleSpeed) { z.vx = 0; z.vz = 0; }
    }
    z.state = ZSTATE.MOVE;
    if (Math.abs(z.vx) + Math.abs(z.vz) > 0.1) z.facing = Math.atan2(-z.vx, -z.vz);
  }

  /** Whether a zombie may stand at world (x, z): open ground, no wall, not the gate. */
  #canStand(x, z) {
    const g = this.grid, cx = Math.floor(x), cy = Math.floor(z);
    if (!g.inBounds(cx, cy) || !g.isWalkableTerrain(cx, cy) || g.wallAt(cx, cy)) return false;
    const gate = this.fortress.gate;
    return !(cx === gate.x && cy === gate.y);
  }

  /** Pushes overlapping zombies apart (spatial hash, one cell buckets). */
  #separate() {
    const g = this.grid, W = g.width;
    const buckets = new Map();
    for (const z of this.list) {
      if (!z.alive || z.air > 0) continue;
      const k = Math.floor(z.z) * W + Math.floor(z.x);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(z);
    }
    for (const [k, b] of buckets) {
      const bx = k % W, by = (k / W) | 0;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx < 0) continue;
          const o = dx === 0 && dy === 0 ? b : buckets.get((by + dy) * W + bx + dx);
          if (!o) continue;
          for (let i = 0; i < b.length; i++) {
            const a = b[i];
            for (let j = o === b ? i + 1 : 0; j < o.length; j++) {
              const c = o[j];
              const ex = c.x - a.x, ez = c.z - a.z;
              const min = a.radius + c.radius;
              const d2 = ex * ex + ez * ez;
              if (d2 >= min * min) continue;
              const d = Math.sqrt(d2) || 0.001;
              const overlap = (min - d) / 2;
              // Heavier (bigger) zombies are moved less.
              const ma = a.radius * a.radius * (a.boss ? 6 : 1), mc = c.radius * c.radius * (c.boss ? 6 : 1);
              const ta = mc / (ma + mc), tc = ma / (ma + mc);
              const ux = d2 ? ex / d : 1, uz = d2 ? ez / d : 0;
              // Never shove anyone into a wall, rock, the gate or the castle.
              const ax = a.x - ux * overlap * 2 * ta, az = a.z - uz * overlap * 2 * ta;
              const cx2 = c.x + ux * overlap * 2 * tc, cz2 = c.z + uz * overlap * 2 * tc;
              if (this.#canStand(ax, az)) { a.x = ax; a.z = az; }
              if (this.#canStand(cx2, cz2)) { c.x = cx2; c.z = cz2; }
            }
          }
        }
      }
    }
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
      if (z.shoveStacks) z.shoveStacks = Math.max(0, z.shoveStacks - dt * (this.physics.shoveRecovery ?? 0.8));
      if (!z.alive) { this.list[write++] = z; continue; }
      if (this.isTumbling(z)) this.#stepPhysics(z, dt);
      else if (this.time >= z.stunUntil) {
        if (z.boss) this.#bossAbilities(z, dt);
        this.#stepZombie(z, dt);
      }
      const cx = Math.floor(z.x), cy = Math.floor(z.z);
      if (g.inBounds(cx, cy)) this.cellCount[g.index(cx, cy)]++;
      this.list[write++] = z;
    }
    for (let i = n; i < this.list.length; i++) this.list[write++] = this.list[i];
    this.list.length = write;
    this.#separate();
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
      // Close enough counts: neighbours pushing each other apart must still be able to strike.
      const arrived = this.#moveToward(z, tx, tz, dt) || Math.hypot(tx - z.x, tz - z.z) < STRIKE_TOLERANCE;
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
