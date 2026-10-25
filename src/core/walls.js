// Wall placement, ownership of wall state, damage/repair, selling, breaches and
// neighbour connectivity.
import { TERRAIN } from './grid.js';

/** Connection bits for neighbour masks. */
export const DIR = { N: 1, E: 2, S: 4, W: 8 };

export class WallSystem {
  #walls = new Map();
  #nextId = 1;
  /** Cells whose wall was destroyed in combat and not rebuilt yet ("x,y"). */
  #breaches = new Set();

  /**
   * @param {import('./grid.js').Grid} grid
   * @param {import('./economy.js').Economy} economy
   * @param {Record<string, object>} types  wall type configs (config/game.js WALLS)
   * @param {import('./events.js').Emitter} events
   * @param {{sellRefund:number, repairCostFactor?:number}} economyConfig
   */
  constructor(grid, economy, types, events, economyConfig) {
    this.grid = grid;
    this.economy = economy;
    this.types = types;
    this.events = events;
    this.economyConfig = economyConfig;
    /** Multiplier applied to build and repair prices (e.g. during combat). */
    this.priceMultiplier = () => 1;
    /** Extra placement blocker, e.g. enemies standing in the cell. Returns a reason or null. */
    this.placementBlocker = () => null;
    /** Multiplier on incoming damage for a wall (guards, buffs). Set by the simulation. */
    this.damageModifier = () => 1;
  }

  get(id) {
    return this.#walls.get(id) ?? null;
  }

  at(x, y) {
    return this.get(this.grid.wallAt(x, y));
  }

  all() {
    return this.#walls.values();
  }

  get count() {
    return this.#walls.size;
  }

  get breachCount() {
    return this.#breaches.size;
  }

  costOf(typeKey) {
    return Math.ceil(this.types[typeKey].cost * this.priceMultiplier());
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canBuild(typeKey, x, y) {
    const type = this.types[typeKey];
    if (!type) return { ok: false, reason: 'unknown_type' };
    if (!this.grid.inBounds(x, y)) return { ok: false, reason: 'out_of_bounds' };
    if (this.grid.terrainAt(x, y) !== TERRAIN.OPEN) return { ok: false, reason: 'not_buildable' };
    if (this.grid.wallAt(x, y)) return { ok: false, reason: 'occupied' };
    const blocked = this.placementBlocker(x, y);
    if (blocked) return { ok: false, reason: blocked };
    if (!this.economy.canAfford(this.costOf(typeKey))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  /** Validates, charges and places a wall. Returns the wall or null. */
  build(typeKey, x, y) {
    const check = this.canBuild(typeKey, x, y);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'build', reason: check.reason, x, y });
      return null;
    }
    const type = this.types[typeKey];
    const price = this.costOf(typeKey);
    if (!this.economy.trySpend(price, `build:${typeKey}`)) return null;
    const wall = {
      id: this.#nextId++,
      type: typeKey,
      x, y,
      hp: type.maxHp,
      maxHp: type.maxHp,
      level: 1,
      // Refunds are based on the base cost, never on combat surcharges.
      invested: type.cost,
      heroCapacity: type.heroCapacity,
      heroes: [],
      /** Timed damage reductions: {reduction, until, kind}. */
      buffs: [],
    };
    this.#walls.set(wall.id, wall);
    this.grid.wallId[this.grid.index(x, y)] = wall.id;
    this.#breaches.delete(`${x},${y}`);
    this.events.emit('wallAdded', wall);
    return wall;
  }

  /** Applies damage (after guards and buffs); destroys the wall at 0 HP. Returns damage dealt. */
  damage(id, amount, source = null) {
    const w = this.get(id);
    if (!w || !(amount > 0)) return 0;
    amount *= this.damageModifier(w);
    const dealt = Math.min(w.hp, amount);
    w.hp -= dealt;
    this.events.emit('wallDamaged', { wall: w, amount: dealt, source });
    if (w.hp <= 0) this.destroy(id);
    return dealt;
  }

  repairCost(id) {
    const w = this.get(id);
    if (!w || w.hp >= w.maxHp) return 0;
    const missing = (w.maxHp - w.hp) / w.maxHp;
    return Math.max(1, Math.ceil(missing * w.invested * this.economyConfig.repairCostFactor * this.priceMultiplier()));
  }

  /** Restores the wall to full health if affordable. Never exceeds max HP. */
  repair(id) {
    const w = this.get(id);
    const cost = this.repairCost(id);
    if (!w || cost === 0) return false;
    if (!this.economy.trySpend(cost, `repair:${w.type}`)) {
      this.events.emit('actionRejected', { action: 'repair', reason: 'insufficient_gold' });
      return false;
    }
    w.hp = w.maxHp;
    this.events.emit('wallRepaired', { wall: w, cost });
    return true;
  }

  /** Gold returned when selling: refund fraction of what was invested, scaled by health. */
  sellValue(id) {
    const w = this.get(id);
    if (!w) return 0;
    return Math.floor(w.invested * this.economyConfig.sellRefund * (w.hp / w.maxHp));
  }

  sell(id) {
    const w = this.get(id);
    if (!w) return false;
    const value = this.sellValue(id);
    this.#remove(w, 'sold');
    this.economy.earn(value, `sell:${w.type}`);
    return true;
  }

  /** Removes a wall that was destroyed in combat (no refund) and records a breach. */
  destroy(id) {
    const w = this.get(id);
    if (!w) return false;
    w.hp = 0;
    this.#breaches.add(`${w.x},${w.y}`);
    this.#remove(w, 'destroyed');
    return true;
  }

  #remove(w, cause) {
    this.#walls.delete(w.id);
    this.grid.wallId[this.grid.index(w.x, w.y)] = 0;
    this.events.emit('wallRemoved', { wall: w, cause });
  }

  /** Bitmask (DIR.*) of orthogonal neighbours that also hold walls. */
  connectionMask(x, y) {
    const g = this.grid;
    return (g.wallAt(x, y - 1) ? DIR.N : 0)
      | (g.wallAt(x + 1, y) ? DIR.E : 0)
      | (g.wallAt(x, y + 1) ? DIR.S : 0)
      | (g.wallAt(x - 1, y) ? DIR.W : 0);
  }
}

/** Path cost function for zombies: walls are passable at a cost (they attack through them). */
export function zombieCostFn(grid, walls, pathing) {
  return (x, y) => {
    if (!grid.isWalkableTerrain(x, y)) return Infinity;
    const w = walls.at(x, y);
    if (!w) return 1;
    return 1 + pathing.wallBaseCost + w.hp * pathing.wallCostPerHp;
  };
}
