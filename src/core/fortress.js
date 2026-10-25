// The fortress gate: the run ends when it falls. It can be repaired and reinforced for gold
// (reinforcing raises max HP; both cost more than ordinary walls).
export class Fortress {
  /**
   * @param {{x:number, y:number}} gateCell
   * @param {typeof import('../config/game.js').FORTRESS} cfg
   * @param {import('./events.js').Emitter} events
   * @param {import('./economy.js').Economy} [economy]
   */
  constructor(gateCell, cfg, events, economy = null) {
    this.gate = { ...gateCell };
    this.cfg = cfg;
    this.events = events;
    this.economy = economy;
    this.maxHp = cfg.gateMaxHp;
    this.hp = cfg.gateMaxHp;
    this.reinforceLevel = 0;
    this.destroyed = false;
    /** Multiplier on repair prices (combat surcharge), set by the simulation. */
    this.priceMultiplier = () => 1;
  }

  get endangered() {
    return this.hp / this.maxHp <= this.cfg.warnAt;
  }

  damage(amount, source = null) {
    if (this.destroyed || !(amount > 0)) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.events.emit('gateDamaged', { amount: dealt, hp: this.hp, source });
    if (this.hp <= 0) {
      this.destroyed = true;
      this.events.emit('gateDestroyed', {});
    }
    return dealt;
  }

  repairCost() {
    if (this.destroyed || this.hp >= this.maxHp) return 0;
    return Math.max(1, Math.ceil((this.maxHp - this.hp) * this.cfg.repairCostPerHp * this.priceMultiplier()));
  }

  /** Restores the gate to full health if affordable. */
  repair() {
    const cost = this.repairCost();
    if (!cost) return false;
    if (!this.economy.trySpend(cost, 'repair:gate')) {
      this.events.emit('actionRejected', { action: 'repairGate', reason: 'insufficient_gold' });
      return false;
    }
    this.hp = this.maxHp;
    this.events.emit('gateRepaired', { cost });
    return true;
  }

  /** Next reinforcement step ({cost, addHp}) or null when fully reinforced. */
  nextReinforcement() {
    return this.cfg.reinforce[this.reinforceLevel] ?? null;
  }

  reinforce() {
    const step = this.nextReinforcement();
    if (!step || this.destroyed) return false;
    if (!this.economy.trySpend(step.cost, 'reinforce:gate')) {
      this.events.emit('actionRejected', { action: 'reinforceGate', reason: 'insufficient_gold' });
      return false;
    }
    this.reinforceLevel++;
    this.maxHp += step.addHp;
    this.hp += step.addHp;
    this.events.emit('gateReinforced', { level: this.reinforceLevel });
    return true;
  }
}
