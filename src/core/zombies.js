// Zombie state, movement and attacks. All zombies heading for the gate share one flow
// field (Dijkstra from the gate over the zombie cost function), recomputed only when walls
// are added or removed. Each step a zombie looks at the next cell on the field from its
// current cell: an open cell -> walk to it; a wall -> stop and hit that wall; the gate ->
// stop and hit the gate.
import { computeFlowField } from './pathfinding.js';
import { zombieCostFn } from './walls.js';

export const ZSTATE = { MOVE: 'move', ATTACK_WALL: 'attackWall', ATTACK_GATE: 'attackGate', DEAD: 'dead' };

/** Seconds a dead zombie stays around for its death animation before removal. */
const CORPSE_TIME = 1.6;
/** Max random offset from cell centres so a horde does not walk in single file. */
const SPREAD = 0.28;
/** How far into its own cell a zombie stands when hitting the neighbouring wall/gate. */
const STRIKE_REACH = 0.32;

export class ZombieSystem {
  #nextId = 1;

  /**
   * @param {{grid, walls, fortress, economy, events, rng, types, pathing}} deps
   */
  constructor({ grid, walls, fortress, economy, events, rng, types, pathing }) {
    Object.assign(this, { grid, walls, fortress, economy, events, rng, types, pathing });
    /** All zombies including dying ones (state DEAD) until their corpse time ends. */
    this.list = [];
    /** Alive zombie count per cell, refreshed every step (for placement checks). */
    this.cellCount = new Uint16Array(grid.width * grid.height);
    this.fieldDirty = true;
    this.field = null;
    this.killCount = 0;
    events.on('wallAdded', () => { this.fieldDirty = true; });
    events.on('wallRemoved', () => { this.fieldDirty = true; });
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.list) if (z.alive) n++;
    return n;
  }

  #refreshField() {
    const cost = zombieCostFn(this.grid, this.walls, this.pathing);
    this.field = computeFlowField(this.grid, [this.fortress.gate], {
      cost, isOpen: (x, y) => cost(x, y) === 1,
    });
    this.fieldDirty = false;
  }

  /** Path distance from a world position to the gate (lower = more dangerous). */
  threatDistance(z) {
    if (!this.field) return Infinity;
    return this.field.dist[this.grid.index(Math.floor(z.x), Math.floor(z.z))];
  }

  /**
   * @param {string} typeKey
   * @param {number} x world x
   * @param {number} z world z
   * @param {number} hpMultiplier wave scaling
   */
  spawn(typeKey, x, z, hpMultiplier = 1) {
    const t = this.types[typeKey];
    const hp = Math.round(t.hp * hpMultiplier);
    const zb = {
      id: this.#nextId++,
      type: typeKey,
      x, z,
      hp, maxHp: hp,
      armor: t.armor,
      speed: t.speed * this.rng.range(0.9, 1.1),
      wallDamage: t.wallDamage,
      attackInterval: t.attackInterval,
      attackTimer: this.rng.range(0, t.attackInterval),
      reward: t.reward,
      xp: t.xp,
      alive: true,
      state: ZSTATE.MOVE,
      targetWallId: 0,
      // Per-zombie offset from cell centres, so groups spread out.
      ox: this.rng.range(-SPREAD, SPREAD),
      oz: this.rng.range(-SPREAD, SPREAD),
      facing: 0,
      animTime: this.rng.range(0, 2),
      deadTime: 0,
      /** heroId -> damage dealt, for sharing XP on death. */
      contributors: new Map(),
      lastHitAt: -1,
    };
    this.list.push(zb);
    this.events.emit('zombieSpawned', zb);
    return zb;
  }

  /**
   * Deals damage to a zombie (after armor). Death, gold and XP happen exactly once.
   * @returns {number} damage dealt
   */
  damage(z, amount, sourceHeroId = 0, { crit = false } = {}) {
    if (!z.alive || !(amount > 0)) return 0;
    const dealt = Math.min(z.hp, Math.max(1, amount - z.armor));
    z.hp -= dealt;
    if (sourceHeroId) z.contributors.set(sourceHeroId, (z.contributors.get(sourceHeroId) ?? 0) + dealt);
    this.events.emit('zombieDamaged', { zombie: z, amount: dealt, crit, sourceHeroId });
    if (z.hp <= 0) this.#kill(z, sourceHeroId);
    return dealt;
  }

  #kill(z, killerId) {
    z.alive = false; // set first: nothing below can run twice for this zombie
    z.hp = 0;
    z.state = ZSTATE.DEAD;
    z.deadTime = 0;
    this.killCount++;
    this.economy.earn(z.reward, `kill:${z.type}`);
    this.events.emit('zombieKilled', { zombie: z, killerId });
  }

  step(dt) {
    if (this.fieldDirty || !this.field) this.#refreshField();
    const g = this.grid;
    this.cellCount.fill(0);
    let write = 0;
    for (let i = 0; i < this.list.length; i++) {
      const z = this.list[i];
      z.animTime += dt;
      if (!z.alive) {
        z.deadTime += dt;
        if (z.deadTime < CORPSE_TIME) this.list[write++] = z;
        continue;
      }
      this.#stepZombie(z, dt);
      const cx = Math.floor(z.x), cy = Math.floor(z.z);
      if (g.inBounds(cx, cy)) this.cellCount[g.index(cx, cy)]++;
      this.list[write++] = z;
    }
    this.list.length = write;
  }

  #stepZombie(z, dt) {
    const g = this.grid;
    const cx = Math.floor(z.x), cy = Math.floor(z.z);
    const here = g.index(cx, cy);
    const next = this.field.next[here];
    if (next < 0) return; // unreachable or already at goal (cannot happen for the gate cell)
    const nx = next % g.width, ny = (next / g.width) | 0;
    const gate = this.fortress.gate;
    const isGate = nx === gate.x && ny === gate.y;
    const wallId = isGate ? 0 : g.wallAt(nx, ny);

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
        if (isGate) this.fortress.damage(z.wallDamage, z);
        else this.walls.damage(wallId, z.wallDamage, z);
        this.events.emit('zombieAttack', { zombie: z, gate: isGate, wallId });
      }
      return;
    }
    z.state = ZSTATE.MOVE;
    z.targetWallId = 0;
    this.#moveToward(z, nx + 0.5 + z.ox, ny + 0.5 + z.oz, dt);
  }

  /** Moves toward (tx, tz); returns true when there. Updates facing while moving. */
  #moveToward(z, tx, tz, dt) {
    const dx = tx - z.x, dz = tz - z.z;
    const d = Math.hypot(dx, dz);
    const stepLen = z.speed * dt;
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
    this.fieldDirty = true;
  }
}
