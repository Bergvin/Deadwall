// One complete run of the game logic on one map, with no rendering. Views, input and HUD
// read from it and call its methods; Node tests and balance simulations drive it directly.
import * as CFG from '../config/game.js';
import { Emitter } from './events.js';
import { Economy } from './economy.js';
import { buildMap } from './grid.js';
import { House } from './house.js';
import { ZombieSystem } from './zombies.js';
import { ProjectileSystem } from './projectiles.js';
import { ZoneSystem } from './zones.js';
import { CombatSystem } from './combat.js';
import { TowerSystem } from './towers.js';
import { RunnerSystem } from './runner.js';
import { WaveSystem, PHASE } from './waves.js';
import { CommanderAbilitySystem } from './commanderAbilities.js';
import { createRng } from './rng.js';

export class Simulation {
  /** @param {{seed?:number, config?:object, mapId?:string}} opts */
  constructor({ seed = (Math.random() * 2 ** 31) | 0, config = CFG, mapId } = {}) {
    const c = config;
    this.config = c;
    this.seed = seed;
    this.map = c.mapById(mapId);
    this.rng = createRng(seed);
    this.events = new Emitter();
    this.time = 0;
    this.over = false;
    this.stats = { kills: 0, goldEarned: 0, score: 0, wavesCleared: 0, towersBuilt: 0, bossesSlain: 0 };
    this.bonus = { killGoldPct: 0, ...(c.BONUS ?? {}) };
    this.killGoldCarry = 0;
    const mods = this.map.mods ?? {};

    const { grid, paths, house } = buildMap(this.map, c.MAP_RULES);
    this.grid = grid;
    this.paths = paths;
    // A map can change the starting gold; commander bonuses come on top.
    const mapGold = mods.startingGold != null ? mods.startingGold - CFG.ECONOMY.startingGold : 0;
    this.economy = new Economy(c.ECONOMY.startingGold + mapGold, this.events);
    this.house = new House(house, c.HOUSE, this.events, this.economy);
    this.house.cells = house.cells;
    this.zombies = new ZombieSystem({
      paths, house: this.house, economy: this.economy, events: this.events, rng: this.rng,
      types: c.ZOMBIES, elite: c.ELITE, physics: c.PHYSICS, laneHalfWidth: c.MAP_RULES.laneHalfWidth,
      speedMult: mods.enemySpeedMult ?? 1,
      // New zombies step out of the road's portal.
      spawnS: c.MAP_RULES.portalS ?? 0,
    });
    this.zones = new ZoneSystem({ zombies: this.zombies, events: this.events });
    this.combat = new CombatSystem({ zombies: this.zombies, zones: this.zones, events: this.events, rng: this.rng });
    this.projectiles = new ProjectileSystem({
      zombies: this.zombies, onImpact: (p, z, x, zz) => this.combat.impact(p, z, x, zz),
    });
    this.towers = new TowerSystem({
      grid, zombies: this.zombies, projectiles: this.projectiles, combat: this.combat,
      economy: this.economy, events: this.events, types: c.TOWERS, rules: c.TOWER_RULES,
    });
    this.zombies.towers = this.towers;
    this.waves = new WaveSystem({
      zombies: this.zombies, economy: this.economy, events: this.events, rng: this.rng,
      cfg: c.WAVES, table: c.WAVE_TABLE, elite: c.ELITE, paths, variants: c.WAVE_VARIANTS,
      hpMult: mods.enemyHpMult ?? 1,
    });
    this.runner = new RunnerSystem({
      grid, house: this.house, towers: this.towers, zombies: this.zombies, zones: this.zones,
      events: this.events, rng: this.rng, cfg: c.RUNNER, spells: c.SPELLS, spellRank: c.SPELL_RANK, perks: c.RUNNER_PERKS,
    });
    // The Commander's automatic abilities (skills and artifacts), when there are any.
    this.abilities = Object.keys(c.COMMANDER_ABILITIES ?? {}).length ? new CommanderAbilitySystem({
      powers: c.COMMANDER_ABILITIES, zombies: this.zombies, towers: this.towers, house: this.house,
      economy: this.economy, waves: this.waves, combat: this.combat, events: this.events, size: c.MAP_RULES,
    }) : null;

    // Cross-system rules.
    const inWave = () => this.waves.phase === PHASE.ACTIVE;
    this.towers.priceMultiplier = () => (inWave() ? c.ECONOMY.combatBuildMultiplier : 1);
    this.towers.slotWave = () => this.waves.wave;
    this.towers.slotBonus = this.bonus.towerSlotAdd ?? 0;
    this.towers.extra = (t) => {
      const r = this.runner.towerExtra(t);
      // Plague clouds gum up towers inside them.
      let gunk = 1;
      for (const zn of this.zones.list) {
        if (zn.kind === 'plague' && Math.hypot(zn.x - t.cx, zn.z - t.cz) <= zn.radius) gunk = Math.min(gunk, zn.towerSlow);
      }
      return { ...r, gunk };
    };
    this.runner.slowAt = (x, z) => {
      let f = 1;
      for (const zn of this.zones.list) {
        if (zn.kind === 'plague' && Math.hypot(zn.x - x, zn.z - z) <= zn.radius) f = Math.min(f, zn.runnerSlow);
      }
      return f;
    };
    this.runner.buildAllowed = () => this.waves.phase === PHASE.PREP;
    this.house.repairAllowed = () => this.waves.phase === PHASE.PREP;

    const ev = this.events;
    ev.on('plagueCloud', (cl) => {
      this.zones.add({ x: cl.x, z: cl.z, radius: cl.radius, duration: cl.duration, dps: 0, kind: 'plague', towerSlow: cl.towerSlow, runnerSlow: cl.runnerSlow });
    });
    ev.on('zombieKilled', ({ zombie, killerId }) => {
      this.runner.awardKill(zombie);
      const killer = killerId ? this.towers.get(killerId) : null;
      if (killer) {
        killer.kills++;
        // Ammo Recycler: kills give the killing tower part of a shot back.
        const rec = this.runner.mods.recycle;
        if (rec) this.towers.refill(killer.id, rec);
      }
      this.stats.kills++;
      this.stats.score += zombie.reward * c.SCORE.perKillGold;
      if (this.bonus.killGoldPct > 0) {
        this.killGoldCarry += zombie.reward * this.bonus.killGoldPct / 100;
        const whole = Math.floor(this.killGoldCarry);
        if (whole > 0) { this.killGoldCarry -= whole; this.economy.earn(whole, 'bonus:plunder'); }
      }
      if (zombie.boss) this.stats.bossesSlain++;
    });
    // Per-tower damage statistics: damage this wave, and DPS over the last finished wave.
    this.waveStartTime = 0;
    ev.on('zombieDamaged', ({ amount, sourceId }) => {
      const t = sourceId ? this.towers.get(sourceId) : null;
      if (t) { t.waveDamage += amount; t.totalDamage += amount; }
    });
    let slots = this.towers.slots;
    ev.on('waveStarted', ({ early }) => {
      if (this.towers.slots > slots) {
        slots = this.towers.slots;
        ev.emit('towerSlotOpened', { slots });
      }
      if (early) return;
      this.waveStartTime = this.time;
      for (const t of this.towers.all()) t.waveDamage = 0;
    });
    ev.on('goldChanged', ({ delta }) => { if (delta > 0) this.stats.goldEarned += delta; });
    ev.on('waveCleared', () => {
      const duration = Math.max(1, this.time - this.waveStartTime);
      for (const t of this.towers.all()) {
        t.lastWaveDamage = t.waveDamage;
        t.lastWaveDps = t.waveDamage / duration;
      }
      this.runner.awardWave();
      this.stats.wavesCleared++;
      this.stats.score += c.SCORE.perWaveCleared;
    });
    ev.on('towerBuilt', () => { this.stats.towersBuilt++; });
    ev.on('houseDestroyed', () => {
      this.over = true;
      ev.emit('gameOver', this.summary());
    });
  }

  /** Advances the simulation by one fixed step. */
  step(dt) {
    if (this.over) return;
    this.time += dt;
    this.waves.step(dt);
    this.zombies.step(dt);
    this.runner.step(dt);
    this.abilities?.step(dt);
    this.towers.step(dt);
    this.projectiles.step(dt);
    this.zones.step(dt);
  }

  /** Runs whole seconds of simulation (tests and balance runs). */
  run(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds && !this.over; t += dt) this.step(dt);
  }

  summary() {
    return {
      map: this.map.id,
      // Waves called early and not cleared do not count (see WaveSystem.creditedWave).
      wave: this.waves.creditedWave,
      wavesCleared: this.stats.wavesCleared,
      score: this.stats.score,
      kills: this.stats.kills,
      goldEarned: this.stats.goldEarned,
      towersBuilt: this.stats.towersBuilt,
      runnerLevel: this.runner.level,
      refills: this.runner.stats.refills,
      bonks: this.runner.stats.bonks,
      time: this.time,
      bossesSlain: this.stats.bossesSlain,
    };
  }
}
