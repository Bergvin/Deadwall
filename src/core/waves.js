// Endless waves: a preparation phase with a countdown, then an active phase that spawns
// the wave's enemies over time. The wave ends when everything has spawned and died.
// The next wave can also be called early, during an active wave: its enemies join the
// queue and all called waves clear together. A called wave only counts as reached once it
// is cleared (`creditedWave`), so calling a hundred waves and dying scores the wave the
// player was actually fighting.
export const PHASE = { PREP: 'prep', ACTIVE: 'active' };

/**
 * Enemy composition of wave n (pure, used for spawning, previews and tests).
 * @param {object} [variant] a WAVE_VARIANTS entry (normal when omitted)
 * @returns {{groups: {type:string, count:number}[], boss: string|null, hpMultiplier:number,
 *            damageMultiplier:number, eliteChance:number, spawnIntervalMult:number,
 *            rewardMult:number}}
 */
export function waveComposition(n, table, elite, variant = null) {
  const v = variant ?? {};
  const counts = new Map();
  for (const g of table.groups) {
    if (n < g.from) continue;
    const mult = v.countMult ? (v.countMult[g.type] ?? v.countMult.default ?? 1) : 1;
    counts.set(g.type, Math.floor((g.base + g.perWave * (n - g.from)) * mult));
  }
  for (const [type, min] of Object.entries(v.ensure ?? {})) counts.set(type, Math.max(counts.get(type) ?? 0, min));
  const groups = [];
  for (const [type, count] of counts) if (count > 0) groups.push({ type, count });
  const boss = n % table.bossEvery === 0
    ? table.bosses[(n / table.bossEvery - 1) % table.bosses.length] : null;
  const eliteChance = elite && n >= elite.fromWave
    ? Math.min(elite.maxChance, elite.chance + elite.chancePerWave * (n - elite.fromWave)) : 0;
  return {
    groups,
    boss,
    hpMultiplier: (table.hpBase ?? 1) * (1 + table.hpGrowth * (n - 1) + table.hpGrowthLate * (n - 1) ** 2)
      * Math.exp((table.hpGrowthExp ?? 0) * (n - 1)) * (v.hpMult ?? 1),
    damageMultiplier: (table.damageBase ?? 1) * (1 + table.damageGrowth * (n - 1)),
    eliteChance,
    spawnIntervalMult: v.spawnIntervalMult ?? 1,
    rewardMult: v.rewardMult ?? 1,
  };
}

/**
 * Picks the variant of wave n. Boss waves and early waves are normal; a special variant
 * never follows itself. rnd() -> [0, 1).
 */
export function rollVariant(n, variants, table, previous, rnd) {
  if (!variants || n <= variants.normalUntil || n % table.bossEvery === 0) return 'normal';
  const pool = Object.entries(variants.types)
    .filter(([k, t]) => n >= (t.fromWave ?? 1) && (k === 'normal' || k !== previous));
  let r = rnd() * pool.reduce((s, [, t]) => s + t.weight, 0);
  for (const [k, t] of pool) if ((r -= t.weight) < 0) return k;
  return 'normal';
}

export class WaveSystem {
  /** @param {{zombies, economy, events, rng, cfg, table, elite, map, variants?}} deps */
  constructor({ zombies, economy, events, rng, cfg, table, elite, map, variants = null }) {
    Object.assign(this, { zombies, economy, events, rng, cfg, table, elite, map, variants });
    this.wave = 0; // last started wave
    /** Highest wave that counts for records: started normally, or called early and cleared. */
    this.creditedWave = 0;
    this.phase = PHASE.PREP;
    this.countdown = cfg.firstPrepTime;
    this.queue = []; // {type, elite} still to spawn this wave
    this.spawnTimer = 0;
    this.hpMultiplier = 1;
    this.spawnIntervalMult = 1;
    this.rewardMult = 1;
    this.cleared = 0;
    /** Variant of the wave being fought (or last fought) and of the next one. */
    this.variant = 'normal';
    this.nextVariant = rollVariant(1, variants, table, null, () => this.rng.next());
  }

  /** Config entry of a variant key. */
  variantInfo(key = this.nextVariant) {
    return this.variants?.types[key] ?? { name: 'Wave', label: null, banner: '' };
  }

  get nextWave() {
    return this.wave + 1;
  }

  /** Composition of the upcoming wave (for the HUD preview). */
  preview(n = this.nextWave) {
    const key = n === this.nextWave ? this.nextVariant : 'normal';
    return { ...waveComposition(n, this.table, this.elite, this.variants?.types[key]), variant: key };
  }

  get remaining() {
    return this.queue.length + this.zombies.aliveCount;
  }

  /**
   * Starts the next wave now. During preparation it starts normally; during an active wave
   * it is called early and its enemies are added to the ones still to come.
   */
  startNext() {
    const early = this.phase === PHASE.ACTIVE;
    const comp = this.preview(this.nextWave);
    this.wave++;
    if (!early) this.creditedWave = this.wave;
    this.variant = comp.variant;
    this.hpMultiplier = comp.hpMultiplier;
    this.spawnIntervalMult = comp.spawnIntervalMult;
    this.rewardMult = comp.rewardMult;
    this.zombies.damageMultiplier = comp.damageMultiplier;
    // Each enemy keeps its own wave's health and bounty, even when waves overlap.
    // Bosses keep their full bounty whatever the wave variant.
    const bossHp = comp.hpMultiplier / (this.variants?.types[comp.variant]?.hpMult ?? 1);
    const queue = [];
    for (const g of comp.groups) {
      for (let i = 0; i < g.count; i++) {
        queue.push({ type: g.type, elite: this.rng.next() < comp.eliteChance, hp: comp.hpMultiplier, rewardMult: comp.rewardMult });
      }
    }
    // Shuffle so mixed groups interleave.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    // The boss arrives two thirds of the way through the wave.
    if (comp.boss) queue.splice(Math.floor(queue.length / 3), 0, { type: comp.boss, elite: false, hp: bossHp, rewardMult: 1 });
    // The queue spawns from its end: a called wave goes behind what is still waiting.
    this.queue = early ? [...queue, ...this.queue] : queue;
    if (!early) this.spawnTimer = 0;
    this.sinceLastSpawn = 0;
    this.enraged = false;
    this.phase = PHASE.ACTIVE;
    this.events.emit('waveStarted', { wave: this.wave, count: queue.length, boss: comp.boss, variant: this.variant, early });
    return true;
  }

  get spawnInterval() {
    const c = this.cfg;
    const base = Math.max(c.minSpawnInterval, c.spawnInterval - c.spawnIntervalDecay * (this.wave - 1));
    return base * this.spawnIntervalMult;
  }

  step(dt) {
    if (this.phase === PHASE.PREP) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.startNext();
      return;
    }
    if (this.queue.length) {
      this.sinceLastSpawn = 0;
      this.spawnTimer -= dt;
      while (this.spawnTimer <= 0 && this.queue.length) {
        this.spawnTimer += this.spawnInterval;
        const { type, elite, hp, rewardMult } = this.queue.pop();
        const boss = this.zombies.types[type].boss;
        const x = boss ? this.map.width / 2 + this.rng.range(-4, 4) : this.rng.range(0.5, this.map.width - 0.5);
        const z = this.rng.range(0.3, this.map.spawnRows - 0.3);
        this.zombies.spawn(type, x, z, hp, { elite, rewardMult });
      }
      return;
    }
    // Stragglers that survive long after the last spawn become enraged (see WAVES.enrageAfter).
    this.sinceLastSpawn = (this.sinceLastSpawn ?? 0) + dt;
    if (this.cfg.enrageAfter && this.sinceLastSpawn >= this.cfg.enrageAfter && !this.enraged) {
      this.enraged = true;
      let n = 0;
      for (const z of this.zombies.list) {
        if (!z.alive || z.enraged) continue;
        z.enraged = true;
        z.speed *= this.cfg.enrageSpeedMult ?? 1.5;
        n++;
      }
      if (n) this.events.emit('hordeEnraged', { count: n });
    }
    if (this.zombies.aliveCount === 0) {
      // Every wave fought together is cleared now (several when waves were called early);
      // each pays its own bonus and counts as reached.
      const first = this.cleared + 1;
      this.cleared = this.wave;
      this.creditedWave = this.wave;
      this.nextVariant = rollVariant(this.wave + 1, this.variants, this.table, this.variant, () => this.rng.next());
      this.phase = PHASE.PREP;
      this.countdown = this.cfg.prepTime;
      for (let n = first; n <= this.wave; n++) {
        const bonus = this.cfg.clearBonusBase + this.cfg.clearBonusPerWave * n;
        this.economy.earn(bonus, `wave:${n}`);
        this.events.emit('waveCleared', { wave: n, bonus });
      }
    }
  }
}
