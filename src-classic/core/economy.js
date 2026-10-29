// Gold balance. Every purchase in the game goes through trySpend so the balance is
// validated in one place and can never go negative.
export class Economy {
  #gold;

  /** @param {number} startingGold @param {import('./events.js').Emitter} events */
  constructor(startingGold, events) {
    this.#gold = Math.floor(startingGold);
    this.events = events;
  }

  get gold() {
    return this.#gold;
  }

  canAfford(amount) {
    return Number.isFinite(amount) && amount >= 0 && this.#gold >= amount;
  }

  /** Deducts `amount` if affordable. Returns true on success. */
  trySpend(amount, reason = '') {
    amount = Math.ceil(amount);
    if (!this.canAfford(amount)) return false;
    this.#gold -= amount;
    this.events?.emit('goldChanged', { gold: this.#gold, delta: -amount, reason });
    return true;
  }

  earn(amount, reason = '') {
    amount = Math.floor(amount);
    if (!(amount > 0)) return;
    this.#gold += amount;
    this.events?.emit('goldChanged', { gold: this.#gold, delta: amount, reason });
  }
}
