// One complete run of the game logic, with no rendering. Views, input and HUD read from it
// and call its methods; Node tests and balance simulations drive it directly.
import * as CFG from '../config/game.js';
import { Emitter } from './events.js';
import { Economy } from './economy.js';
import { createMapGrid } from './grid.js';
import { WallSystem } from './walls.js';
import { Fortress } from './fortress.js';
import { ZombieSystem } from './zombies.js';
import { HeroSystem } from './heroes.js';
import { ProjectileSystem } from './projectiles.js';
import { ZoneSystem } from './zones.js';
import { CombatSystem } from './combat.js';
import { WallEffectSystem } from './wallEffects.js';
import { HazardSystem } from './hazards.js';
import { TowerSystem } from './towers.js';
import { WaveSystem, PHASE } from './waves.js';
import { WandererSystem } from './wanderers.js';
import { rollLoot } from './commander.js';
import { createRng } from './rng.js';

export class Simulation {
  /** @param {{seed?:number, config?:object}} opts */
  constructor({ seed = (Math.random() * 2 ** 31) | 0, config = CFG } = {}) {
    const c = config;
    this.config = c;
    this.seed = seed;
    this.rng = createRng(seed);
    this.events = new Emitter();
    this.time = 0;
    this.over = false;
    this.stats = {
      kills: 0, goldEarned: 0, score: 0, wavesCleared: 0, wallsBuilt: 0, wallsLost: 0,
      wanderersSlain: 0, wanderersEscaped: 0, bossesSlain: 0,
    };
    /** Artifacts found this run ({id, rarity}), in drop order. */
    this.artifacts = [];
    // Separate random streams: Wanderer sightings and loot never shift the horde's rolls.
    this.wanderRng = createRng((seed ^ 0x5a17e) >>> 0);
    this.lootRng = createRng((seed ^ 0x10075) >>> 0);
    this.bonus = { killGoldPct: 0, artifactLuckPct: 0, ...(c.BONUS ?? {}) };
    this.killGoldCarry = 0;

    this.grid = createMapGrid(c.MAP);
    this.economy = new Economy(c.ECONOMY.startingGold, this.events);
    this.walls = new WallSystem(this.grid, this.economy, c.WALLS, this.events, c.ECONOMY, c.WALL_UPGRADES);
    this.fortress = new Fortress({ x: c.MAP.gateX, y: c.MAP.castleWallRow }, c.FORTRESS, this.events, this.economy);
    this.zombies = new ZombieSystem({
      grid: this.grid, walls: this.walls, fortress: this.fortress, economy: this.economy,
      events: this.events, rng: this.rng, types: c.ZOMBIES, pathing: c.PATHING, elite: c.ELITE,
    });
    this.heroes = new HeroSystem({
      walls: this.walls, zombies: this.zombies, economy: this.economy,
      events: this.events, rng: this.rng, types: c.HEROES, rules: c.HERO_RULES, economyConfig: c.ECONOMY,
      champion: c.CHAMPION,
    });
    this.zones = new ZoneSystem({ zombies: this.zombies, events: this.events });
    this.projectiles = new ProjectileSystem({
      zombies: this.zombies, onImpact: (p, z, x, zz) => this.combat.impact(p, z, x, zz),
    });
    this.combat = new CombatSystem({
      heroes: this.heroes, zombies: this.zombies, walls: this.walls, projectiles: this.projectiles,
      zones: this.zones, events: this.events, rng: this.rng, types: c.HEROES, rules: c.HERO_RULES,
    });
    this.waves = new WaveSystem({
      zombies: this.zombies, economy: this.economy, events: this.events, rng: this.rng,
      cfg: c.WAVES, table: c.WAVE_TABLE, elite: c.ELITE, map: c.MAP,
    });
    this.towers = new TowerSystem({
      walls: this.walls, zombies: this.zombies, projectiles: this.projectiles, economy: this.economy,
      events: this.events, types: c.TOWERS, rules: c.TOWER_RULES,
    });
    this.wallEffects = new WallEffectSystem({ walls: this.walls, zombies: this.zombies, events: this.events });
    this.hazards = new HazardSystem({ zombies: this.zombies, heroes: this.heroes, events: this.events, types: c.ZOMBIES });
    this.wanderers = c.WANDERERS ? new WandererSystem({
      zombies: this.zombies, events: this.events, rng: this.wanderRng, cfg: c.WANDERERS, map: c.MAP,
      getHpMultiplier: () => this.waves.hpMultiplier,
    }) : null;

    // Cross-system rules.
    this.walls.priceMultiplier = () => (this.waves.phase === PHASE.ACTIVE ? c.ECONOMY.combatBuildMultiplier : 1);
    this.fortress.priceMultiplier = this.walls.priceMultiplier;
    this.towers.priceMultiplier = this.walls.priceMultiplier;
    this.heroes.reviveAllowed = () => this.waves.phase === PHASE.PREP;
    this.walls.damageModifier = (w) => this.combat.wallDamageMultiplier(w);
    this.walls.placementBlocker = (x, y) => (this.zombies.cellCount[this.grid.index(x, y)] ? 'enemy_present' : null);

    const ev = this.events;
    ev.on('zombieKilled', ({ zombie, killerId }) => {
      this.heroes.awardKillXp(zombie);
      const killer = unit(killerId);
      if (killer) killer.kills++;
      this.stats.kills++;
      this.stats.score += zombie.reward * c.SCORE.perKillGold;
      // Commander bonus gold, carried fractionally so small percentages still add up.
      if (this.bonus.killGoldPct > 0) {
        this.killGoldCarry += zombie.reward * this.bonus.killGoldPct / 100;
        const whole = Math.floor(this.killGoldCarry);
        if (whole > 0) { this.killGoldCarry -= whole; this.economy.earn(whole, 'bonus:plunder'); }
      }
      if (zombie.boss) this.stats.bossesSlain++;
      if (zombie.wanderer) this.stats.wanderersSlain++;
      const table = zombie.wanderer ? c.ZOMBIES[zombie.type].wanderer.loot : zombie.boss ? 'boss' : null;
      if (table && c.LOOT_TABLES) {
        const drop = rollLoot(table, () => this.lootRng.next(), this.bonus.artifactLuckPct);
        if (drop) {
          this.artifacts.push(drop);
          ev.emit('artifactDropped', { ...drop, x: zombie.x, z: zombie.z, source: zombie.type });
        }
      }
    });
    ev.on('wandererEscaped', () => { this.stats.wanderersEscaped++; });
    // Per-hero damage statistics: damage this wave, and DPS over the last finished wave.
    this.waveStartTime = 0;
    // Statistics are kept for every damage source: the champion and the towers.
    const unit = (id) => (id ? this.heroes.get(id) ?? this.towers.get(id) : null);
    ev.on('zombieDamaged', ({ amount, sourceHeroId }) => {
      const u = unit(sourceHeroId);
      if (u) { u.waveDamage += amount; u.totalDamage += amount; }
    });
    ev.on('waveStarted', () => {
      this.waveStartTime = this.time;
      for (const u of [...this.heroes.all(), ...this.towers.all()]) u.waveDamage = 0;
    });
    ev.on('goldChanged', ({ delta }) => { if (delta > 0) this.stats.goldEarned += delta; });
    ev.on('waveCleared', () => {
      const duration = Math.max(1, this.time - this.waveStartTime);
      for (const u of [...this.heroes.all(), ...this.towers.all()]) {
        u.lastWaveDamage = u.waveDamage;
        u.lastWaveDps = u.waveDamage / duration;
      }
      this.heroes.healAll();
      this.stats.wavesCleared++;
      this.stats.score += c.SCORE.perWaveCleared;
    });
    ev.on('wallAdded', () => { this.stats.wallsBuilt++; });
    ev.on('wallRemoved', ({ cause }) => { if (cause === 'destroyed') this.stats.wallsLost++; });
    ev.on('gateDestroyed', () => {
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
    this.combat.step(dt);
    this.towers.step(dt);
    this.projectiles.step(dt);
    this.zones.step(dt);
    this.wallEffects.step(dt);
    this.hazards.step(dt);
  }

  /** Runs whole seconds of simulation (tests and balance runs). */
  run(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds && !this.over; t += dt) this.step(dt);
  }

  summary() {
    return {
      wave: this.waves.wave,
      wavesCleared: this.stats.wavesCleared,
      score: this.stats.score,
      kills: this.stats.kills,
      goldEarned: this.stats.goldEarned,
      wallsBuilt: this.stats.wallsBuilt,
      wallsLost: this.stats.wallsLost,
      heroes: this.heroes.count,
      time: this.time,
      bossesSlain: this.stats.bossesSlain,
      wanderersSlain: this.stats.wanderersSlain,
      wanderersEscaped: this.stats.wanderersEscaped,
      artifacts: this.artifacts.map((a) => ({ ...a })),
    };
  }
}
