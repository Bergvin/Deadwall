// The fortress gate: the run ends when it falls.
export class Fortress {
  /**
   * @param {{x:number, y:number}} gateCell
   * @param {typeof import('../config/game.js').FORTRESS} cfg
   * @param {import('./events.js').Emitter} events
   */
  constructor(gateCell, cfg, events) {
    this.gate = { ...gateCell };
    this.cfg = cfg;
    this.events = events;
    this.maxHp = cfg.gateMaxHp;
    this.hp = cfg.gateMaxHp;
    this.destroyed = false;
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
}
