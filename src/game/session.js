// One run: the Simulation plus everything that only lives for that run (wall and hero
// views, input, HUD, event wiring). Shared, persistent pieces (renderer, camera, assets,
// horde/projectile/effect renderers) are passed in and only reset. dispose() removes
// every trace of the run so a restart starts clean.
import { Simulation } from '../core/simulation.js';
import { PATHING, CAMERA } from '../config/game.js';
import { findPath } from '../core/pathfinding.js';
import { zombieCostFn } from '../core/walls.js';
import { WallView } from '../render/wallView.js';
import { HeroView } from '../render/heroView.js';
import { healthColor } from '../render/healthBars.js';
import { FX_COLORS } from '../render/fx.js';
import { Interaction } from '../input/interaction.js';
import { Hud } from '../ui/hud.js';

export class Session {
  /**
   * @param {{scene, canvas, cam, assets, overlay, zombieView, projectileView, effects, bars,
   *          floaters, gateNode, loop, onGameOver, seed?}} shared
   */
  constructor(shared) {
    this.shared = shared;
    const { scene, canvas, cam, assets, overlay } = shared;
    this.abort = new AbortController();
    this.sim = new Simulation({ seed: shared.seed });
    const sim = this.sim;
    this.wallView = new WallView(scene, assets, sim.walls, sim.events);
    this.heroView = new HeroView(scene, assets, sim.heroes, sim.events, sim.config.HEROES);

    const loop = shared.loop;
    this.hud = new Hud(document.body, sim, {
      build: (type) => this.input.enterBuild(type),
      recruit: (type) => this.recruit(type),
      deploy: (heroId) => this.input.enterDeploy(heroId),
      useAbility: (heroId, id) => this.input.useAbility(heroId, id),
      select: (sel) => this.input.select(sel),
      startWave: () => sim.waves.startNext(),
      togglePause: () => shared.togglePause(),
      setSpeed: (s) => { loop.speed = s; },
      isPaused: () => loop.paused,
      getSpeed: () => loop.speed,
    });
    this.input = new Interaction({
      canvas, cam, sim, wallView: this.wallView, heroView: this.heroView, overlay,
      hud: this.hud, cameraCfg: CAMERA, signal: this.abort.signal,
    });
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); shared.togglePause(); }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') sim.waves.startNext();
    }, { signal: this.abort.signal });

    this.lastHeroPos = new Map();
    this.#wireFeedback();
    this.showPath = true;
    this.pathDirty = true;
    sim.events.on('wallAdded', () => { this.pathDirty = true; });
    sim.events.on('wallRemoved', () => { this.pathDirty = true; });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) { this.showPath = !this.showPath; this.pathDirty = true; }
    }, { signal: this.abort.signal });
  }

  recruit(type) {
    const hero = this.sim.heroes.recruit(type);
    if (!hero) { this.hud.toast('Not enough gold'); return; }
    this.hud.toast(`${hero.name} the ${this.sim.config.HEROES[type].name} joins the defense`);
    this.input.enterDeploy(hero.id);
  }

  /** Visual and text feedback for simulation events. */
  #wireFeedback() {
    const { effects, floaters, gateNode, fx } = this.shared;
    const ev = this.sim.events;
    const CLASS_COLOR = { archer: 0x9fd86a, mage: 0xb57aff, warrior: 0xf0e6d0, crossbowman: 0x9fe8ff, paladin: 0xffe08a, alchemist: 0x7cff5a };
    ev.on('impactFx', ({ x, z, radius, fx: kind }) => {
      const color = FX_COLORS[kind.split('-')[0]] ?? FX_COLORS.hit;
      if (radius > 0) fx.ring(x, z, radius, color, kind.endsWith('small') ? 0.35 : 0.6);
      const big = !kind.endsWith('small') && radius > 1;
      effects.burst({ x, y: 0.4, z }, {
        count: big ? 24 : 6, color, size: big ? 0.1 : 0.06, speed: big ? 2.5 : 1.2, up: big ? 2.5 : 1.5,
        life: big ? 0.9 : 0.5, spread: Math.min(1, radius),
      });
    });
    ev.on('abilityUsed', ({ hero }) => {
      const p = this.sim.heroes.positionOf(hero);
      if (p) fx.ring(p.x, p.z, 0.8, CLASS_COLOR[hero.type] ?? 0xffffff, 0.4, 1.25);
    });
    ev.on('meleeHit', ({ target, holy, crit }) => {
      effects.burst({ x: target.x, y: 0.7, z: target.z }, {
        count: crit ? 8 : 4, color: holy ? FX_COLORS.holy : 0xd8d0c0, size: 0.06, speed: 1.4, up: 1.2, life: 0.35, spread: 0.2,
      });
    });
    ev.on('heroLevelUp', (hero) => {
      const p = this.sim.heroes.positionOf(hero);
      if (!p) return;
      floaters.spawn({ x: p.x, y: 2.4, z: p.z }, `Level ${hero.level}!`, 'level');
      fx.ring(p.x, p.z, 1.2, FX_COLORS.level, 0.8, 1.25);
      effects.burst({ x: p.x, y: 1.8, z: p.z }, { count: 16, color: FX_COLORS.level, size: 0.06, speed: 1, up: 2.5, life: 0.9, spread: 0.3 });
    });
    ev.on('bossAbility', ({ zombie, kind, radius }) => {
      const color = kind === 'summon' ? 0x7cff5a : 0xd060ff;
      fx.ring(zombie.x, zombie.z, radius, color, 0.9);
      effects.burst({ x: zombie.x, y: 1.2, z: zombie.z }, { count: 20, color, size: 0.08, speed: 1.8, up: 2.2, life: 0.9, spread: 0.6 });
    });
    ev.on('bossSpawned', (z) => fx.ring(z.x, z.z, 2.5, 0xd0453a, 1.2));
    ev.on('thornsHit', ({ zombie }) => {
      effects.burst({ x: zombie.x, y: 0.6, z: zombie.z }, { count: 2, color: 0x8a1a14, size: 0.05, speed: 0.8, up: 1, life: 0.35, spread: 0.15 });
    });
    ev.on('heroDamaged', ({ hero, amount }) => {
      const p = this.sim.heroes.positionOf(hero);
      if (p && amount >= 1) floaters.spawn({ x: p.x, y: 2.3, z: p.z }, `-${Math.round(amount)}`, 'wall');
    });
    ev.on('heroFell', (hero) => {
      const w = this.lastHeroPos.get(hero.id);
      if (w) effects.burst({ x: w.x, y: 1.5, z: w.z }, { count: 18, color: 0x6a1a14, size: 0.08, speed: 1.4, up: 2, life: 1, spread: 0.3 });
    });
    ev.on('wallUpgraded', ({ wall }) => {
      fx.ring(wall.x + 0.5, wall.y + 0.5, 0.9, FX_COLORS.level, 0.6, 1.25);
      effects.burst({ x: wall.x + 0.5, y: 1.3, z: wall.y + 0.5 }, { count: 10, color: FX_COLORS.level, size: 0.05, speed: 0.8, up: 2, life: 0.7, spread: 0.4 });
    });
    ev.on('zombieDamaged', ({ zombie, amount, crit, dot }) => {
      if (dot) return; // damage over time is shown by the zombie's tint, not numbers

      floaters.spawn({ x: zombie.x, y: 1.1, z: zombie.z }, crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`, crit ? 'crit' : 'dmg');
      effects.burst({ x: zombie.x, y: 0.6, z: zombie.z }, { count: crit ? 6 : 3, color: 0x6a1a14, size: 0.06, speed: 1, up: 1.5, life: 0.5, spread: 0.2 });
    });
    ev.on('zombieKilled', ({ zombie }) => {
      floaters.spawn({ x: zombie.x, y: 1.4, z: zombie.z }, `+${zombie.reward}`, 'gold');
    });
    ev.on('wallDamaged', ({ wall, amount }) => {
      floaters.spawn({ x: wall.x + 0.5, y: 1.5, z: wall.y + 0.5 }, `-${Math.round(amount)}`, 'wall');
      effects.burst({ x: wall.x + 0.5, y: 0.8, z: wall.y + 0.2 }, { count: 2, color: 0x9a9080, size: 0.05, speed: 0.8, up: 1, life: 0.5 });
    });
    ev.on('wallRemoved', ({ wall, cause }) => {
      if (cause !== 'destroyed') return;
      const at = { x: wall.x + 0.5, y: 0.6, z: wall.y + 0.5 };
      effects.burst(at, { count: 28, color: 0x8f8678, size: 0.14, speed: 2.2, up: 3, life: 1.2, spread: 0.7 });
      effects.burst(at, { count: 18, color: 0x5a5048, size: 0.22, speed: 1.2, up: 1.5, life: 1.6, spread: 0.6 });
    });
    ev.on('gateDamaged', ({ hp, amount }) => {
      const g = this.sim.config.MAP;
      floaters.spawn({ x: g.gateX + 0.5, y: 1.8, z: g.castleWallRow + 0.3 }, `-${Math.round(amount)}`, 'wall');
      effects.burst({ x: g.gateX + 0.5, y: 0.8, z: g.castleWallRow }, { count: 3, color: 0x6a4a30, size: 0.06, life: 0.5 });
      this.gateShake = 0.15;
      // Darken the gate as it takes damage.
      const r = hp / this.sim.fortress.maxHp;
      gateNode?.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.userData.ownMat) { o.material = o.material.clone(); o.userData.ownMat = true; }
        o.material.color.setRGB(1 - 0.5 * (1 - r), 1 - 0.65 * (1 - r), 1 - 0.7 * (1 - r));
      });
    });
    ev.on('gateDestroyed', () => {
      const g = this.sim.config.MAP;
      const at = { x: g.gateX + 0.5, y: 0.8, z: g.castleWallRow + 0.5 };
      effects.burst(at, { count: 40, color: 0x6a4a30, size: 0.16, speed: 2.5, up: 3.5, life: 1.6, spread: 0.8 });
      effects.burst(at, { count: 30, color: 0x8f8678, size: 0.2, speed: 1.6, up: 2, life: 2, spread: 0.9 });
      if (gateNode) gateNode.visible = false;
    });
    ev.on('gameOver', (summary) => this.shared.onGameOver(summary));
  }

  /** Per-frame rendering sync (real time, independent of game speed). */
  frame(realDt) {
    const { zombieView, projectileView, effects, bars, floaters, cam, canvas, gateNode, fx } = this.shared;
    const sim = this.sim;
    zombieView.sync(sim.zombies.list, sim.zombies.time);
    fx.update(realDt, sim.time, [...sim.zones.list, ...sim.hazards.puddles], sim.walls.all());
    projectileView.sync(sim.projectiles.list);
    this.wallView.update(realDt);
    this.heroView.update(this.shared.loop.paused ? 0 : realDt * this.shared.loop.speed, sim.walls);
    effects.update(realDt);
    floaters.update(realDt, cam.camera, canvas);
    if (gateNode) {
      this.gateShake = Math.max(0, (this.gateShake ?? 0) - realDt);
      gateNode.position.x = sim.config.MAP.gateX + 0.5 + (this.gateShake > 0 ? (Math.random() - 0.5) * 0.05 : 0);
    }

    // Health bars: damaged zombies, damaged walls.
    bars.begin(cam.camera);
    for (const z of sim.zombies.list) {
      if (z.alive && z.hp < z.maxHp) bars.add(z.x, 1.15, z.z, z.hp / z.maxHp, healthColor(z.hp / z.maxHp), 0.6);
    }
    for (const w of sim.walls.all()) {
      if (w.hp < w.maxHp) bars.add(w.x + 0.5, 1.75, w.y + 0.5, w.hp / w.maxHp, healthColor(w.hp / w.maxHp), 0.8);
    }
    for (const h of sim.heroes.active()) {
      const p = sim.heroes.positionOf(h);
      this.lastHeroPos.set(h.id, p);
      if (h.hp < h.maxHp) bars.add(p.x, 2.25, p.z, h.hp / h.maxHp, 0x6fa8ff, 0.5);
    }
    bars.end();

    if (this.pathDirty) {
      this.pathDirty = false;
      this.shared.overlay.setPath(this.showPath ? this.computeZombiePath() : null);
    }
    this.hud.tick();
  }

  computeZombiePath() {
    const sim = this.sim;
    const cost = zombieCostFn(sim.grid, sim.walls, PATHING);
    return findPath(sim.grid, { x: sim.fortress.gate.x, y: 1 }, sim.fortress.gate,
      { cost, isOpen: (x, y) => cost(x, y) === 1 });
  }

  dispose() {
    this.abort.abort();
    this.sim.events.clear();
    this.wallView.dispose();
    this.heroView.dispose();
    this.hud.dispose();
    const s = this.shared;
    s.zombieView.clear();
    s.projectileView.sync([]);
    s.effects.clear();
    s.fx.clear();
    s.floaters.clear();
    s.bars.begin(s.cam.camera);
    s.bars.end();
    s.overlay.reset();
    if (s.gateNode) s.gateNode.visible = true;
    s.gateNode?.traverse((o) => { if (o.isMesh && o.userData.ownMat) o.material.color.set(0xffffff); });
  }
}
