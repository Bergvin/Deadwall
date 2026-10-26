// Wanderer sightings: after a wave is cleared there is a chance that one Wanderer starts
// crossing the field from the west edge. Uses its own random stream so sightings never
// change the order of anything else in a seeded run.
export class WandererSystem {
  /** @param {{zombies, events, rng, cfg, map, getHpMultiplier: () => number}} deps */
  constructor({ zombies, events, rng, cfg, map, getHpMultiplier }) {
    Object.assign(this, { zombies, events, rng, cfg, map, getHpMultiplier });
    this.sightings = 0;
    events.on('waveCleared', ({ wave }) => this.maybeSpawn(wave));
  }

  /** Probability that a Wanderer appears after clearing `wave`. */
  chanceAfter(wave) {
    if (wave < this.cfg.fromWave) return 0;
    return Math.min(this.cfg.maxChance, this.cfg.chance);
  }

  /** Types that may appear after `wave`, with weights. */
  eligible(wave) {
    return this.cfg.types.filter((t) => wave >= t.fromWave);
  }

  maybeSpawn(wave) {
    if (this.rng.next() >= this.chanceAfter(wave)) return null;
    return this.spawn(wave);
  }

  /** Spawns a Wanderer now (random eligible type unless `type` is given). */
  spawn(wave, type = null) {
    const pool = this.eligible(wave);
    if (!type) {
      if (!pool.length) return null;
      let r = this.rng.next() * pool.reduce((s, t) => s + t.weight, 0);
      type = pool.find((t) => (r -= t.weight) < 0)?.type ?? pool[pool.length - 1].type;
    }
    const row = this.rng.range(this.cfg.minRow, this.cfg.maxRow) + 0.5;
    const z = this.zombies.spawn(type, 0.2, row, this.getHpMultiplier(), { rng: this.rng });
    this.sightings++;
    this.events.emit('wandererSpawned', z);
    return z;
  }
}
