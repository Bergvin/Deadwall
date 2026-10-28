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
import { TowerView } from '../render/towerView.js';
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
    this.sim = new Simulation({ seed: shared.seed, ...(shared.config ? { config: shared.config } : {}) });
    const sim = this.sim;
    this.wallView = new WallView(scene, assets, sim.walls, sim.events);
    this.heroView = new HeroView(scene, assets, sim.heroes, sim.events, sim.config.HEROES);
    this.towerView = new TowerView(scene, assets, sim.towers, sim.events, sim.config.TOWERS);

    const loop = shared.loop;
    this.hud = new Hud(document.body, sim, {
      build: (type) => this.input.enterBuild(type),
      buildTower: (type) => this.input.enterTowerBuild(type),
      deploy: (heroId) => this.input.enterDeploy(heroId),
      useAbility: (heroId, id) => this.input.useAbility(heroId, id),
      select: (sel) => this.input.select(sel),
      focus: (sel) => {
        const h = sel.kind === 'hero' ? sim.heroes.get(sel.id) : null;
        const t = sel.kind === 'tower' ? sim.towers.get(sel.id) : null;
        const p = h ? sim.heroes.positionOf(h) : t ? { x: t.x, z: t.z } : null;
        if (p) { cam.target.set(p.x, 0, p.z + 1); cam.update(0); }
        this.input.select(sel);
      },
      startWave: () => sim.waves.startNext(),
      togglePause: () => shared.togglePause(),
      /** Stops/starts game time without the pause menu (the ability picker uses it). */
      holdTime: (on) => { loop.paused = on; },
      setSpeed: (s) => { loop.speed = s; },
      isPaused: () => loop.paused,
      getSpeed: () => loop.speed,
      toggleMute: () => shared.setSetting('muted', !shared.settings.muted),
      isMuted: () => shared.settings.muted,
    });
    this.input = new Interaction({
      canvas, cam, sim, wallView: this.wallView, heroView: this.heroView, towerView: this.towerView, overlay,
      hud: this.hud, cameraCfg: CAMERA, signal: this.abort.signal,
    });
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); shared.togglePause(); }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') sim.waves.startNext();
    }, { signal: this.abort.signal });

    this.lastHeroPos = new Map();
    this.#wireFeedback();
    this.#recruitChampion(shared.heroType ?? 'archer');
    this.showPath = shared.settings?.showPath ?? true;
    this.pathDirty = true;
    sim.events.on('wallAdded', () => { this.pathDirty = true; });
    sim.events.on('wallRemoved', () => { this.pathDirty = true; });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) shared.setSetting('showPath', !this.showPath);
    }, { signal: this.abort.signal });
  }

  /** The run's champion joins at the start and waits in reserve until placed on a 2x2 block. */
  #recruitChampion(type) {
    const hero = this.sim.heroes.recruitChampion(type);
    this.hud.toast(`${hero.name} takes up the ${hero.weapon?.name ?? type}. Build a 2×2 block of walls and place your hero on it.`, 'good');
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
    ev.on('abilityUsed', ({ hero, abilityId }) => {
      const p = this.sim.heroes.positionOf(hero);
      if (p) fx.ring(p.x, p.z, 0.8, CLASS_COLOR[hero.type] ?? 0xffffff, 0.4, 1.25);
      // Name the ability above the hero so automatic casts are easy to notice.
      const name = this.sim.config.HEROES[hero.type].abilities[abilityId]?.name;
      if (p && name) floaters.spawn({ x: p.x, y: 2.5, z: p.z }, name, 'cast');
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
    // Hero build feedback: loot, lightning, quakes, landings, phoenix.
    ev.on('lootDropped', ({ item, x, z }) => {
      const c = parseInt(this.sim.config.RARITY_INFO[item.rarity].color.slice(1), 16);
      floaters.spawn({ x, y: 1.6, z }, item.name, 'cmdab');
      fx.ring(x, z, 1, c, 0.9, 1.25);
      effects.burst({ x, y: 0.8, z }, { count: 24, color: c, size: 0.08, speed: 1.2, up: 3, life: 1.2, spread: 0.3 });
    });
    ev.on('chainLightning', ({ from, to, crit }) => {
      const c = crit ? 0xffe08a : 0xb8d8ff;
      for (const t of to) {
        fx.ring(t.x, t.z, 0.45, c, 0.25);
        // A few sparks along the arc.
        for (let k = 1; k <= 3; k++) {
          const f = k / 4;
          effects.burst({ x: from.x + (t.x - from.x) * f, y: 0.8, z: from.z + (t.z - from.z) * f }, { count: 1, color: c, size: 0.06, speed: 0.2, up: 0.3, life: 0.2, spread: 0.05 });
        }
      }
    });
    ev.on('heroQuake', ({ x, z }) => {
      fx.ring(x, z, 3.5, 0xa07848, 0.8, 1.25);
      effects.burst({ x, y: 0.3, z }, { count: 40, color: 0x8a7050, size: 0.12, speed: 3, up: 2.5, life: 1, spread: 1.5 });
    });
    ev.on('zombieLanded', ({ zombie, height }) => {
      if (height < 0.6) return;
      effects.burst({ x: zombie.x, y: 0.1, z: zombie.z }, { count: 8, color: 0x6a6050, size: 0.07, speed: 1.2, up: 0.8, life: 0.5, spread: 0.3 });
    });
    ev.on('heroPhoenix', (hero) => {
      const p = this.sim.heroes.positionOf(hero);
      if (!p) return;
      fx.ring(p.x, p.z, 3, 0xff7a20, 1.2, 1.25);
      effects.burst({ x: p.x, y: 2, z: p.z }, { count: 60, color: 0xff9a40, size: 0.12, speed: 2.5, up: 4, life: 1.4, spread: 0.8 });
      floaters.spawn({ x: p.x, y: 3, z: p.z }, 'PHOENIX', 'level');
    });
    // Commander abilities: their name floats where they strike.
    ev.on('commanderAbility', ({ icon, name, x, z, extra }) => {
      floaters.spawn({ x, y: 2.2, z }, `${icon} ${name}${extra ? ` ${extra}` : ''}`, 'cmdab');
    });
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
    this.#wireSound();
  }

  /** Maps simulation events to sound effects. */
  #wireSound() {
    const sfx = this.shared.sfx;
    if (!sfx) return;
    const ev = this.sim.events;
    const ATTACK = { archer: 'bow', crossbowman: 'crossbow', mage: 'magic', alchemist: 'poison' };
    const IMPACT = {
      fire: 'fire', explosion: 'explosion', frost: 'frost', arcane: 'arcane', holy: 'holy',
      rally: 'holy', bash: 'bash', poison: 'poison', bolt: 'crossbow',
    };
    ev.on('heroAttack', ({ hero }) => { const s = ATTACK[hero.type]; if (s) sfx.play(s, 0.8); });
    ev.on('meleeHit', () => sfx.play('melee'));
    const TOWER_SOUND = { fire: 'magic', earth: 'crossbow', wind: 'bow', water: 'magic' };
    ev.on('towerAttack', ({ tower }) => sfx.play(TOWER_SOUND[tower.type], 0.6));
    for (const t of ['towerBuilt']) ev.on(t, () => sfx.play('build', 1.2));
    ev.on('towerUpgraded', () => sfx.play('repair', 1.3));
    ev.on('impactFx', ({ fx }) => { const s = IMPACT[fx]; if (s) sfx.play(s); });
    ev.on('zombieAttack', ({ zombie, gate }) => sfx.play(gate ? 'gateHit' : 'wallHit', zombie.boss ? 1.5 : zombie.scale));
    ev.on('zombieKilled', ({ zombie }) => { sfx.play('death', zombie.scale); sfx.play('gold'); });
    ev.on('thornsHit', () => sfx.play('thorns'));
    ev.on('wallAdded', () => sfx.play('build'));
    ev.on('wallRemoved', ({ cause }) => { if (cause === 'destroyed') sfx.play('wallDestroy'); });
    for (const t of ['wallRepaired', 'gateRepaired']) ev.on(t, () => sfx.play('repair'));
    for (const t of ['wallUpgraded', 'gateReinforced', 'talentBought', 'heroRevived']) ev.on(t, () => sfx.play('repair', 1.3));
    ev.on('heroLevelUp', () => sfx.play('levelUp'));
    ev.on('waveStarted', ({ boss }) => sfx.play(boss ? 'boss' : 'waveStart'));
    ev.on('waveCleared', () => sfx.play('waveCleared'));
    ev.on('bossSpawned', () => sfx.play('boss'));
    ev.on('lootDropped', () => sfx.play('levelUp', 1.4));
    ev.on('heroAbilityChosen', () => sfx.play('levelUp', 1.2));
    ev.on('chainLightning', () => sfx.play('arcane', 1.3));
    ev.on('heroQuake', () => sfx.play('explosion', 0.8));
    ev.on('heroPhoenix', () => sfx.play('fire'));
    ev.on('commanderAbility', ({ id }) => sfx.play({ meteor: 'explosion', frost: 'frost', judgement: 'holy', rot: 'poison', storm: 'arcane' }[id] ?? 'repair', 1.2));
    ev.on('bossAbility', () => sfx.play('boss', 0.6));
    for (const t of ['heroEndangered', 'heroFell']) ev.on(t, () => sfx.play('alarm'));
    ev.on('gateDamaged', () => { if (this.sim.fortress.endangered) sfx.play('alarm'); });
    ev.on('gameOver', () => sfx.play('gameOver'));
    ev.on('actionRejected', () => sfx.play('deny'));
    ev.on('heroRecruited', () => sfx.play('ui', 1.5));
  }

  /** Per-frame rendering sync (real time, independent of game speed). */
  frame(realDt) {
    const { zombieView, projectileView, effects, bars, floaters, cam, canvas, gateNode, fx } = this.shared;
    const sim = this.sim;
    zombieView.sync(sim.zombies.list, sim.zombies.time);
    fx.update(realDt, sim.time, [...sim.zones.list, ...sim.hazards.puddles], sim.walls.all());
    this.shared.breaches.update(realDt, sim.walls.breachCells());
    // A failing gate smokes.
    this.smokeTimer = (this.smokeTimer ?? 0) - realDt;
    if (sim.fortress.endangered && !sim.fortress.destroyed && this.smokeTimer <= 0) {
      this.smokeTimer = 0.25;
      const m = sim.config.MAP;
      effects.burst({ x: m.gateX + 0.5, y: 1.4, z: m.castleWallRow + 0.3 }, { count: 2, color: 0x3a3632, size: 0.18, speed: 0.15, up: 1.2, life: 1.6, spread: 0.6 });
    }
    projectileView.sync(sim.projectiles.list);
    this.wallView.update(realDt);
    this.heroView.update(this.shared.loop.paused ? 0 : realDt * this.shared.loop.speed, sim.walls);
    this.towerView.update(realDt);
    effects.update(realDt);
    floaters.update(realDt, cam.camera, canvas);
    if (gateNode) {
      this.gateShake = Math.max(0, (this.gateShake ?? 0) - realDt);
      gateNode.position.x = sim.config.MAP.gateX + 0.5 + (this.gateShake > 0 ? (Math.random() - 0.5) * 0.05 : 0);
    }

    // Health bars: damaged zombies, damaged walls.
    bars.begin(cam.camera);
    for (const z of sim.zombies.list) {
      if (z.alive && z.hp < z.maxHp) bars.add(z.x, 1.15 + (z.air ?? 0), z.z, z.hp / z.maxHp, healthColor(z.hp / z.maxHp), 0.6);
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
    this.towerView.dispose();
    this.hud.dispose();
    const s = this.shared;
    s.zombieView.clear();
    s.projectileView.sync([]);
    s.effects.clear();
    s.fx.clear();
    s.breaches.clear();
    s.floaters.clear();
    s.bars.begin(s.cam.camera);
    s.bars.end();
    s.overlay.reset();
    if (s.gateNode) s.gateNode.visible = true;
    s.gateNode?.traverse((o) => { if (o.isMesh && o.userData.ownMat) o.material.color.set(0xffffff); });
  }
}
