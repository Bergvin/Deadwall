// Endless waves: a preparation phase with a countdown, then an active phase that spawns
// the wave's enemies over time. The wave ends when everything has spawned and died.
export const PHASE = { PREP: 'prep', ACTIVE: 'active' };

/** Enemy list for a wave: [{type, count}] plus the HP multiplier. Pure, for previews/tests. */
export function waveComposition(n, cfg) {
  return {
    groups: [{ type: 'walker', count: cfg.walkerBase + cfg.walkerPerWave * (n - 1) }],
    hpMultiplier: 1 + cfg.hpGrowth * (n - 1),
  };
}

export class WaveSystem {
  /** @param {{zombies, economy, events, rng, cfg, map}} deps */
  constructor({ zombies, economy, events, rng, cfg, map }) {
    Object.assign(this, { zombies, economy, events, rng, cfg, map });
    this.wave = 0; // last started wave
    this.phase = PHASE.PREP;
    this.countdown = cfg.firstPrepTime;
    this.queue = []; // types still to spawn this wave
    this.spawnTimer = 0;
    this.hpMultiplier = 1;
    this.cleared = 0;
  }

  get nextWave() {
    return this.wave + 1;
  }

  get remaining() {
    return this.queue.length + this.zombies.aliveCount;
  }

  /** Starts the next wave now. Only valid during preparation, so it can never double up. */
  startNext() {
    if (this.phase !== PHASE.PREP) return false;
    this.wave++;
    const comp = waveComposition(this.wave, this.cfg);
    this.hpMultiplier = comp.hpMultiplier;
    this.queue = [];
    for (const g of comp.groups) for (let i = 0; i < g.count; i++) this.queue.push(g.type);
    // Shuffle so mixed groups interleave.
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.spawnTimer = 0;
    this.phase = PHASE.ACTIVE;
    this.events.emit('waveStarted', { wave: this.wave, count: this.queue.length });
    return true;
  }

  get spawnInterval() {
    const c = this.cfg;
    return Math.max(c.minSpawnInterval, c.spawnInterval - c.spawnIntervalDecay * (this.wave - 1));
  }

  step(dt) {
    if (this.phase === PHASE.PREP) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.startNext();
      return;
    }
    if (this.queue.length) {
      this.spawnTimer -= dt;
      while (this.spawnTimer <= 0 && this.queue.length) {
        this.spawnTimer += this.spawnInterval;
        const type = this.queue.pop();
        const x = this.rng.range(0.5, this.map.width - 0.5);
        const z = this.rng.range(0.3, this.map.spawnRows - 0.3);
        this.zombies.spawn(type, x, z, this.hpMultiplier);
      }
      return;
    }
    if (this.zombies.aliveCount === 0) {
      const bonus = this.cfg.clearBonusBase + this.cfg.clearBonusPerWave * this.wave;
      this.economy.earn(bonus, `wave:${this.wave}`);
      this.cleared = this.wave;
      this.phase = PHASE.PREP;
      this.countdown = this.cfg.prepTime;
      this.events.emit('waveCleared', { wave: this.wave, bonus });
    }
  }
}
