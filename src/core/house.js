// The house the player protects. Zombies at the end of a road hit it; if it falls, the
// run is over. It can be repaired for gold between waves.
export class House {
  /** @param {{x:number, z:number}} at world centre @param {{maxHp, warnAt, repairCostPerHp}} cfg */
  constructor(at, cfg, events, economy) {
    this.x = at.x;
    this.z = at.z;
    this.cfg = cfg;
    this.events = events;
    this.economy = economy;
    this.maxHp = cfg.maxHp;
    this.hp = this.maxHp;
    this.destroyed = false;
    /** Set by the simulation: whether repairs are allowed right now. */
    this.repairAllowed = () => true;
  }

  get endangered() {
    return !this.destroyed && this.hp / this.maxHp < this.cfg.warnAt;
  }

  damage(amount, source = null) {
    if (this.destroyed || !(amount > 0)) return;
    this.hp = Math.max(0, this.hp - amount);
    this.events.emit('houseDamaged', { hp: this.hp, amount, source });
    if (this.hp <= 0) {
      this.destroyed = true;
      this.events.emit('houseDestroyed', {});
    }
  }

  heal(amount) {
    if (this.destroyed) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  repairCost() {
    return Math.ceil((this.maxHp - this.hp) * this.cfg.repairCostPerHp);
  }

  repair() {
    const cost = this.repairCost();
    if (this.destroyed || !cost || !this.repairAllowed()) return false;
    if (!this.economy.trySpend(cost, 'repair:house')) return false;
    this.hp = this.maxHp;
    this.events.emit('houseRepaired', { cost });
    return true;
  }
}
