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
import { CommanderAbilitySystem } from './commanderAbilities.js';
import { createRng } from './rng.js';
import { rollItem } from './heroBuild.js';

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
      bossesSlain: 0,
    };
    this.bonus = { killGoldPct: 0, ...(c.BONUS ?? {}) };
    // Loot rolls use their own random stream so drops never shift the horde's rolls.
    this.lootRng = createRng((seed ^ 0x10075) >>> 0);
    this.stats.itemsFound = 0;
    this.killGoldCarry = 0;

    this.grid = createMapGrid(c.MAP);
    this.economy = new Economy(c.ECONOMY.startingGold, this.events);
    this.walls = new WallSystem(this.grid, this.economy, c.WALLS, this.events, c.ECONOMY, c.WALL_UPGRADES);
    this.fortress = new Fortress({ x: c.MAP.gateX, y: c.MAP.castleWallRow }, c.FORTRESS, this.events, this.economy);
    this.zombies = new ZombieSystem({
      grid: this.grid, walls: this.walls, fortress: this.fortress, economy: this.economy,
      events: this.events, rng: this.rng, types: c.ZOMBIES, pathing: c.PATHING, elite: c.ELITE, physics: c.PHYSICS,
    });
    this.heroes = new HeroSystem({
      walls: this.walls, zombies: this.zombies, economy: this.economy,
      events: this.events, rng: this.rng, types: c.HEROES, rules: c.HERO_RULES, economyConfig: c.ECONOMY,
      champion: c.CHAMPION, cfg: c,
    });
    this.zones = new ZoneSystem({ zombies: this.zombies, events: this.events });
    this.projectiles = new ProjectileSystem({
      zombies: this.zombies, onImpact: (p, z, x, zz) => this.combat.impact(p, z, x, zz),
    });
    this.combat = new CombatSystem({
      heroes: this.heroes, zombies: this.zombies, walls: this.walls, projectiles: this.projectiles,
      zones: this.zones, events: this.events, rng: this.rng, types: c.HEROES, rules: c.HERO_RULES,
      economy: this.economy, cfg: c, gate: this.fortress.gate,
    });
    this.waves = new WaveSystem({
      zombies: this.zombies, economy: this.economy, events: this.events, rng: this.rng,
      cfg: c.WAVES, table: c.WAVE_TABLE, elite: c.ELITE, map: c.MAP, variants: c.WAVE_VARIANTS,
    });
    this.towers = new TowerSystem({
      walls: this.walls, zombies: this.zombies, projectiles: this.projectiles, economy: this.economy,
      events: this.events, types: c.TOWERS, rules: c.TOWER_RULES,
    });
    this.wallEffects = new WallEffectSystem({ walls: this.walls, zombies: this.zombies, events: this.events });
    this.hazards = new HazardSystem({ zombies: this.zombies, heroes: this.heroes, events: this.events, types: c.ZOMBIES });
    // The Commander's automatic abilities (skills and artifacts), when there are any.
    this.abilities = Object.keys(c.COMMANDER_ABILITIES ?? {}).length ? new CommanderAbilitySystem({
      powers: c.COMMANDER_ABILITIES, zombies: this.zombies, walls: this.walls, fortress: this.fortress,
      economy: this.economy, waves: this.waves, combat: this.combat, events: this.events,
    }) : null;

    // Cross-system rules.
    this.walls.priceMultiplier = () => (this.waves.phase === PHASE.ACTIVE ? c.ECONOMY.combatBuildMultiplier : 1);
    this.fortress.priceMultiplier = this.walls.priceMultiplier;
    this.towers.priceMultiplier = this.walls.priceMultiplier;
    this.heroes.reviveAllowed = () => this.waves.phase === PHASE.PREP;
    this.heroes.buildAllowed = () => this.waves.phase === PHASE.PREP;
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
      // Weapons and gear drop for the hero (mostly from elites and bosses).
      if (c.LOOT && this.heroes.count) {
        const kind = zombie.boss ? 'boss' : zombie.elite ? 'elite' : 'normal';
        const r = () => this.lootRng.next();
        if (r() < c.LOOT.chance[kind]) {
          const luck = kind === 'boss' ? c.LOOT.bossLuckPct : kind === 'elite' ? c.LOOT.eliteLuckPct : 0;
          for (let n = 0; n < (kind === 'boss' ? c.LOOT.bossDrops : 1); n++) {
            const item = rollItem(c, this.waves.wave, r, luck);
            const res = this.heroes.addLoot(item);
            this.stats.itemsFound++;
            ev.emit('lootDropped', { item, x: zombie.x, z: zombie.z, ...res });
          }
        }
      }
    });
    // Per-hero damage statistics: damage this wave, and DPS over the last finished wave.
    this.waveStartTime = 0;
    // Statistics are kept for every damage source: the champion and the towers.
    const unit = (id) => (id ? this.heroes.get(id) ?? this.towers.get(id) : null);
    ev.on('zombieDamaged', ({ amount, sourceHeroId }) => {
      const u = unit(sourceHeroId);
      if (u) { u.waveDamage += amount; u.totalDamage += amount; }
    });
    ev.on('waveStarted', ({ early }) => {
      // Called-early waves join the fight in progress, so its statistics keep running.
      if (early) return;
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
      this.heroes.awardWaveXp();
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
    this.abilities?.step(dt);
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
      // Waves called early and not cleared do not count (see WaveSystem.creditedWave).
      wave: this.waves.creditedWave,
      wavesCleared: this.stats.wavesCleared,
      score: this.stats.score,
      kills: this.stats.kills,
      goldEarned: this.stats.goldEarned,
      wallsBuilt: this.stats.wallsBuilt,
      wallsLost: this.stats.wallsLost,
      heroes: this.heroes.count,
      time: this.time,
      bossesSlain: this.stats.bossesSlain,
    };
  }
}
