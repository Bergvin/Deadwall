// Wall placement, ownership of wall state, selling and neighbour connectivity.
import { TERRAIN } from './grid.js';

/** Connection bits for neighbour masks. */
export const DIR = { N: 1, E: 2, S: 4, W: 8 };

export class WallSystem {
  #walls = new Map();
  #nextId = 1;

  /**
   * @param {import('./grid.js').Grid} grid
   * @param {import('./economy.js').Economy} economy
   * @param {Record<string, object>} types  wall type configs (config/game.js WALLS)
   * @param {import('./events.js').Emitter} events
   * @param {{sellRefund:number}} economyConfig
   */
  constructor(grid, economy, types, events, economyConfig) {
    this.grid = grid;
    this.economy = economy;
    this.types = types;
    this.events = events;
    this.economyConfig = economyConfig;
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

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canBuild(typeKey, x, y) {
    const type = this.types[typeKey];
    if (!type) return { ok: false, reason: 'unknown_type' };
    if (!this.grid.inBounds(x, y)) return { ok: false, reason: 'out_of_bounds' };
    if (this.grid.terrainAt(x, y) !== TERRAIN.OPEN) return { ok: false, reason: 'not_buildable' };
    if (this.grid.wallAt(x, y)) return { ok: false, reason: 'occupied' };
    if (!this.economy.canAfford(type.cost)) return { ok: false, reason: 'insufficient_gold' };
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
    if (!this.economy.trySpend(type.cost, `build:${typeKey}`)) return null;
    const wall = {
      id: this.#nextId++,
      type: typeKey,
      x, y,
      hp: type.maxHp,
      maxHp: type.maxHp,
      level: 1,
      invested: type.cost,
      heroCapacity: type.heroCapacity,
      heroes: [],
    };
    this.#walls.set(wall.id, wall);
    this.grid.wallId[this.grid.index(x, y)] = wall.id;
    this.events.emit('wallAdded', wall);
    return wall;
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

  /** Removes a wall that was destroyed in combat (no refund). */
  destroy(id) {
    const w = this.get(id);
    if (!w) return false;
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

  clear() {
    for (const w of [...this.#walls.values()]) this.#remove(w, 'reset');
    this.#nextId = 1;
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
