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
import { WaveSystem, PHASE } from './waves.js';
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
    this.stats = { kills: 0, goldEarned: 0, score: 0, wavesCleared: 0, wallsBuilt: 0, wallsLost: 0 };

    this.grid = createMapGrid(c.MAP);
    this.economy = new Economy(c.ECONOMY.startingGold, this.events);
    this.walls = new WallSystem(this.grid, this.economy, c.WALLS, this.events, c.ECONOMY);
    this.fortress = new Fortress({ x: c.MAP.gateX, y: c.MAP.castleWallRow }, c.FORTRESS, this.events);
    this.zombies = new ZombieSystem({
      grid: this.grid, walls: this.walls, fortress: this.fortress, economy: this.economy,
      events: this.events, rng: this.rng, types: c.ZOMBIES, pathing: c.PATHING,
    });
    this.heroes = new HeroSystem({
      walls: this.walls, zombies: this.zombies, economy: this.economy,
      events: this.events, rng: this.rng, types: c.HEROES, rules: c.HERO_RULES, economyConfig: c.ECONOMY,
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
      cfg: c.WAVES, map: c.MAP,
    });

    // Cross-system rules.
    this.walls.priceMultiplier = () => (this.waves.phase === PHASE.ACTIVE ? c.ECONOMY.combatBuildMultiplier : 1);
    this.walls.damageModifier = (w) => this.combat.wallDamageMultiplier(w);
    this.walls.placementBlocker = (x, y) => (this.zombies.cellCount[this.grid.index(x, y)] ? 'enemy_present' : null);

    const ev = this.events;
    ev.on('zombieKilled', ({ zombie, killerId }) => {
      this.heroes.awardKillXp(zombie);
      const killer = this.heroes.get(killerId);
      if (killer) killer.kills++;
      this.stats.kills++;
      this.stats.score += zombie.reward * c.SCORE.perKillGold;
    });
    ev.on('goldChanged', ({ delta }) => { if (delta > 0) this.stats.goldEarned += delta; });
    ev.on('waveCleared', () => {
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
    this.projectiles.step(dt);
    this.zones.step(dt);
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
    };
  }
}
