// Endless waves: a preparation phase with a countdown, then an active phase that spawns
// the wave's enemies over time. The wave ends when everything has spawned and died.
export const PHASE = { PREP: 'prep', ACTIVE: 'active' };

/**
 * Enemy composition of wave n (pure, used for spawning, previews and tests).
 * @returns {{groups: {type:string, count:number}[], boss: string|null, hpMultiplier:number,
 *            damageMultiplier:number, eliteChance:number}}
 */
export function waveComposition(n, table, elite) {
  const groups = [];
  for (const g of table.groups) {
    if (n < g.from) continue;
    const count = Math.floor(g.base + g.perWave * (n - g.from));
    if (count > 0) groups.push({ type: g.type, count });
  }
  const boss = n % table.bossEvery === 0
    ? table.bosses[(n / table.bossEvery - 1) % table.bosses.length] : null;
  const eliteChance = elite && n >= elite.fromWave
    ? Math.min(elite.maxChance, elite.chance + elite.chancePerWave * (n - elite.fromWave)) : 0;
  return {
    groups,
    boss,
    hpMultiplier: 1 + table.hpGrowth * (n - 1) + table.hpGrowthLate * (n - 1) ** 2,
    damageMultiplier: 1 + table.damageGrowth * (n - 1),
    eliteChance,
  };
}

export class WaveSystem {
  /** @param {{zombies, economy, events, rng, cfg, table, elite, map}} deps */
  constructor({ zombies, economy, events, rng, cfg, table, elite, map }) {
    Object.assign(this, { zombies, economy, events, rng, cfg, table, elite, map });
    this.wave = 0; // last started wave
    this.phase = PHASE.PREP;
    this.countdown = cfg.firstPrepTime;
    this.queue = []; // {type, elite} still to spawn this wave
    this.spawnTimer = 0;
    this.hpMultiplier = 1;
    this.cleared = 0;
  }

  get nextWave() {
    return this.wave + 1;
  }

  /** Composition of the upcoming wave (for the HUD preview). */
  preview(n = this.nextWave) {
    return waveComposition(n, this.table, this.elite);
  }

  get remaining() {
    return this.queue.length + this.zombies.aliveCount;
  }

  /** Starts the next wave now. Only valid during preparation, so it can never double up. */
  startNext() {
    if (this.phase !== PHASE.PREP) return false;
    this.wave++;
    const comp = this.preview(this.wave);
    this.hpMultiplier = comp.hpMultiplier;
    this.zombies.damageMultiplier = comp.damageMultiplier;
    this.queue = [];
    for (const g of comp.groups) {
      for (let i = 0; i < g.count; i++) this.queue.push({ type: g.type, elite: this.rng.next() < comp.eliteChance });
    }
    // Shuffle so mixed groups interleave.
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    // The boss arrives two thirds of the way through the wave.
    if (comp.boss) this.queue.splice(Math.floor(this.queue.length / 3), 0, { type: comp.boss, elite: false });
    this.spawnTimer = 0;
    this.phase = PHASE.ACTIVE;
    this.events.emit('waveStarted', { wave: this.wave, count: this.queue.length, boss: comp.boss });
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
        const { type, elite } = this.queue.pop();
        const boss = this.zombies.types[type].boss;
        const x = boss ? this.map.width / 2 + this.rng.range(-4, 4) : this.rng.range(0.5, this.map.width - 0.5);
        const z = this.rng.range(0.3, this.map.spawnRows - 0.3);
        this.zombies.spawn(type, x, z, this.hpMultiplier, { elite });
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
